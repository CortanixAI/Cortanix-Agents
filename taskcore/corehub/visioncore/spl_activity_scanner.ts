/**
 * Analyze on-chain token activity using Solana JSON-RPC (real API).
 * Fetches recent signatures for a mint address and summarizes SPL token transfers.
 */

export interface ActivityRecord {
  timestamp: number
  signature: string
  source: string
  destination: string
  amount: number
}

type JsonRpcRequest = {
  jsonrpc: "2.0"
  id: number
  method: string
  params?: any[]
}

type RpcConfig = {
  commitment?: "processed" | "confirmed" | "finalized"
  timeoutMs?: number
}

type SignatureInfo = {
  signature: string
  blockTime?: number
  err?: unknown
}

type UiTokenBalance = {
  accountIndex: number
  mint: string
  owner?: string
  uiTokenAmount: {
    uiAmount: number | null
    decimals: number
  }
}

type TransactionMeta = {
  preTokenBalances?: UiTokenBalance[]
  postTokenBalances?: UiTokenBalance[]
}

type TransactionResponse = {
  slot: number
  blockTime?: number
  meta: TransactionMeta | null
}

export class TokenActivityAnalyzer {
  private requestId = 1
  private commitment: RpcConfig["commitment"]
  private timeoutMs: number

  constructor(
    private rpcEndpoint: string,
    cfg: RpcConfig = { commitment: "confirmed", timeoutMs: 25_000 }
  ) {
    this.commitment = cfg.commitment ?? "confirmed"
    this.timeoutMs = Math.max(1_000, cfg.timeoutMs ?? 25_000)
  }

  /** Core JSON-RPC POST with AbortController timeout */
  private async rpcCall<T>(method: string, params: any[] = []): Promise<T> {
    const body: JsonRpcRequest = { jsonrpc: "2.0", id: this.requestId++, method, params }
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(this.rpcEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal as any,
      })
      if (!res.ok) {
        throw new Error(`RPC HTTP ${res.status}: ${res.statusText}`)
      }
      const json = (await res.json()) as { result?: T; error?: { message?: string } }
      if (!("result" in json) || json.result === undefined) {
        throw new Error(`RPC error: ${json.error?.message ?? "unknown error"}`)
      }
      return json.result as T
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error(`RPC timeout after ${this.timeoutMs}ms`)
      throw e
    } finally {
      clearTimeout(t)
    }
  }

  /**
   * Fetch recent signatures for an address (mint or token account).
   * Uses `getSignaturesForAddress` with pagination until `limit` is reached or no more.
   */
  async fetchRecentSignatures(address: string, limit = 100): Promise<SignatureInfo[]> {
    const all: SignatureInfo[] = []
    let before: string | undefined = undefined

    while (all.length < limit) {
      const pageSize = Math.min(1_000, limit - all.length) // Solana allows up to 1k per page
      const params: any[] = [
        address,
        { limit: pageSize, before, commitment: this.commitment },
      ]
      const page = await this.rpcCall<SignatureInfo[]>("getSignaturesForAddress", params)
      if (!page.length) break
      all.push(...page)
      before = page[page.length - 1].signature
      if (page.length < pageSize) break
    }

    return all.slice(0, limit)
  }

  /**
   * Fetch a parsed transaction by signature.
   */
  private async fetchTransaction(signature: string): Promise<TransactionResponse | null> {
    // encoding: "jsonParsed" to get uiTokenAmount/owner/mint fields
    const params = [
      signature,
      { encoding: "jsonParsed", commitment: this.commitment, maxSupportedTransactionVersion: 0 },
    ]
    const tx = await this.rpcCall<TransactionResponse | null>("getTransaction", params)
    return tx
  }

  /**
   * Compute per-owner delta for a given mint from pre/post token balances.
   */
  private computeOwnerDeltas(
    mint: string,
    meta: TransactionMeta
  ): Map<string, number> {
    const map = new Map<string, number>()
    const pre = (meta.preTokenBalances ?? []).filter(b => b.mint === mint)
    const post = (meta.postTokenBalances ?? []).filter(b => b.mint === mint)

    // Index by owner+accountIndex (owner may be undefined on some accounts)
    const keyOf = (b: UiTokenBalance) => `${b.owner ?? "unknown"}#${b.accountIndex}`

    const preMap = new Map<string, UiTokenBalance>()
    for (const b of pre) preMap.set(keyOf(b), b)

    for (const p of post) {
      const k = keyOf(p)
      const preB = preMap.get(k)
      const preAmt = preB?.uiTokenAmount.uiAmount ?? 0
      const postAmt = p.uiTokenAmount.uiAmount ?? 0
      const delta = postAmt - preAmt
      if (delta !== 0) {
        const owner = p.owner ?? "unknown"
        map.set(owner, (map.get(owner) ?? 0) + delta)
      }
      // remove matched to track pure removals (in case some pre entries have no post)
      preMap.delete(k)
    }

    // Any remaining pre entries not present in post (closed accounts etc.)
    for (const [k, b] of preMap.entries()) {
      const owner = b.owner ?? "unknown"
      const preAmt = b.uiTokenAmount.uiAmount ?? 0
      if (preAmt !== 0) {
        // full outflow
        map.set(owner, (map.get(owner) ?? 0) - preAmt)
      }
    }

    return map
  }

  /**
   * Pair positive and negative owner deltas to produce transfer-like records.
   * If exact pairing by absolute value is not found, produces best-effort records with unknown side.
   */
  private pairDeltasToTransfers(
    deltas: Map<string, number>,
    signature: string,
    blockTime?: number
  ): ActivityRecord[] {
    const ts = (blockTime ?? Math.floor(Date.now() / 1000)) * 1000
    const positives: Array<{ owner: string; amt: number }> = []
    const negatives: Array<{ owner: string; amt: number }> = []

    for (const [owner, delta] of deltas.entries()) {
      if (delta > 0) positives.push({ owner, amt: delta })
      else if (delta < 0) negatives.push({ owner, amt: -delta })
    }

    const out: ActivityRecord[] = []
    // try to match by exact amounts first
    for (let i = 0; i < positives.length; i++) {
      const p = positives[i]
      let j = negatives.findIndex(n => approximatelyEqual(n.amt, p.amt))
      if (j >= 0) {
        const n = negatives.splice(j, 1)[0]
        out.push({
          timestamp: ts,
          signature,
          source: n.owner,
          destination: p.owner,
          amount: roundTo(p.amt, 9),
        })
        positives[i].amt = 0
      }
    }

    // leftover positives -> source unknown
    for (const p of positives) {
      if (p.amt > 0) {
        out.push({
          timestamp: ts,
          signature,
          source: "unknown",
          destination: p.owner,
          amount: roundTo(p.amt, 9),
        })
      }
    }

    // leftover negatives -> destination unknown
    for (const n of negatives) {
      out.push({
        timestamp: ts,
        signature,
        source: n.owner,
        destination: "unknown",
        amount: roundTo(n.amt, 9),
      })
    }

    return out
  }

  /**
   * Analyze activity for an SPL token mint:
   * - get recent signatures for the mint
   * - load transactions (parsed)
   * - compute owner balance deltas per tx
   * - pair deltas into transfer-like ActivityRecord items
   */
  async analyzeActivity(mint: string, limit = 50): Promise<ActivityRecord[]> {
    const sigInfos = await this.fetchRecentSignatures(mint, limit)
    const records: ActivityRecord[] = []

    for (const info of sigInfos) {
      try {
        const tx = await this.fetchTransaction(info.signature)
        if (!tx || !tx.meta) continue
        const deltas = this.computeOwnerDeltas(mint, tx.meta)
        if (deltas.size === 0) continue
        const transfers = this.pairDeltasToTransfers(deltas, info.signature, tx.blockTime ?? info.blockTime)
        records.push(...transfers)
        // small delay to avoid hammering public RPCs
        await sleep(25)
      } catch {
        // ignore single-transaction failures
      }
    }

    // sort ascending by time, stable by signature
    records.sort((a, b) => (a.timestamp - b.timestamp) || a.signature.localeCompare(b.signature))
    return records
  }
}

/* --------------------------- helpers --------------------------- */

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms))
}

function roundTo(n: number, dec = 6): number {
  const f = Math.pow(10, dec)
  return Math.round(n * f) / f
}

function approximatelyEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps
}
