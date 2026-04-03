/**
 * Analyze on-chain orderbook depth for a given market.
 * Fetches bids/asks and computes liquidity/price quality metrics.
 */

export interface Order {
  price: number
  size: number
}

export interface RawOrderbook {
  bids: Order[]
  asks: Order[]
}

export interface DepthMetrics {
  averageBidDepth: number
  averageAskDepth: number
  spread: number
  spreadBps: number
  midPrice: number
  bestBid: number
  bestAsk: number
  bidLiquidity: number
  askLiquidity: number
  imbalancePct: number
  vwapBid: number
  vwapAsk: number
}

type AnalyzerOptions = {
  /** Max price levels to include from each side */
  levels?: number
  /** Request timeout in ms */
  timeoutMs?: number
}

export class TokenDepthAnalyzer {
  private readonly levels: number
  private readonly timeoutMs: number

  constructor(
    private rpcEndpoint: string,
    private marketId: string,
    opts: AnalyzerOptions = {}
  ) {
    this.levels = Math.max(1, opts.levels ?? 50)
    this.timeoutMs = Math.max(1_000, opts.timeoutMs ?? 15_000)
  }

  async fetchOrderbook(depth = this.levels): Promise<RawOrderbook> {
    const url = `${this.rpcEndpoint}/orderbook/${encodeURIComponent(this.marketId)}?depth=${depth}`

    // Use AbortController for reliable timeouts
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const res = await fetch(url, { signal: controller.signal as any })
      if (!res.ok) throw new Error(`Orderbook fetch failed: ${res.status} ${res.statusText}`)
      const json = (await res.json()) as RawOrderbook
      return this.normalizeOrderbook(json, depth)
    } catch (e: any) {
      if (e?.name === "AbortError") {
        throw new Error(`Orderbook fetch timed out after ${this.timeoutMs}ms`)
      }
      throw e
    } finally {
      clearTimeout(timer)
    }
  }

  async analyze(depth = this.levels): Promise<DepthMetrics> {
    const { bids, asks } = await this.fetchOrderbook(depth)

    const avg = (arr: Order[]) =>
      arr.length ? arr.reduce((s, o) => s + o.size, 0) / arr.length : 0

    const bestBid = bids[0]?.price ?? 0
    const bestAsk = asks[0]?.price ?? 0
    const midPrice = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : 0
    const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0
    const spreadBps = midPrice > 0 ? (spread / midPrice) * 10_000 : 0

    const bidLiquidity = sumSize(bids)
    const askLiquidity = sumSize(asks)
    const imbalancePct =
      bidLiquidity + askLiquidity > 0
        ? ((bidLiquidity - askLiquidity) / (bidLiquidity + askLiquidity)) * 100
        : 0

    const vwapBid = computeVWAP(bids)
    const vwapAsk = computeVWAP(asks)

    return {
      averageBidDepth: round(avg(bids), 6),
      averageAskDepth: round(avg(asks), 6),
      spread: round(spread, 9),
      spreadBps: round(spreadBps, 4),
      midPrice: round(midPrice, 9),
      bestBid: round(bestBid, 9),
      bestAsk: round(bestAsk, 9),
      bidLiquidity: round(bidLiquidity, 6),
      askLiquidity: round(askLiquidity, 6),
      imbalancePct: round(imbalancePct, 4),
      vwapBid: round(vwapBid, 9),
      vwapAsk: round(vwapAsk, 9),
    }
  }

  // ----------------- internals -----------------

  private normalizeOrderbook(ob: RawOrderbook, depth: number): RawOrderbook {
    const clean = (o: Order) => ({
      price: Number(o.price),
      size: Number(o.size),
    })

    const bids = (ob.bids ?? []).map(clean).filter(validOrder)
    const asks = (ob.asks ?? []).map(clean).filter(validOrder)

    // Sort: bids descending by price, asks ascending by price
    bids.sort((a, b) => b.price - a.price)
    asks.sort((a, b) => a.price - b.price)

    return {
      bids: bids.slice(0, depth),
      asks: asks.slice(0, depth),
    }
  }
}

/* ----------------- helpers ----------------- */

function validOrder(o: Order): boolean {
  return Number.isFinite(o.price) && Number.isFinite(o.size) && o.price > 0 && o.size >= 0
}

function sumSize(orders: Order[]): number {
  let s = 0
  for (const o of orders) s += o.size
  return s
}

function computeVWAP(orders: Order[]): number {
  if (!orders.length) return 0
  let pv = 0
  let v = 0
  for (const o of orders) {
    pv += o.price * o.size
    v += o.size
  }
  return v > 0 ? pv / v : 0
}

function round(n: number, dec = 6): number {
  const f = Math.pow(10, dec)
  return Math.round(n * f) / f
}
