export interface PairInfo {
  exchange: string
  pairAddress: string
  baseSymbol: string
  quoteSymbol: string
  liquidityUsd: number
  volume24hUsd: number
  priceUsd: number
  updatedAt?: number
  sourceUrl?: string
}

export interface DexSuiteConfig {
  apis: Array<{ name: string; baseUrl: string; apiKey?: string }>
  timeoutMs?: number
  retries?: number
  /** limit concurrent API calls (per request fan-out) */
  concurrency?: number
}

type ApiDef = { name: string; baseUrl: string; apiKey?: string }

type RawPairResponse = {
  token0?: { symbol?: string }
  token1?: { symbol?: string }
  liquidityUsd?: number | string
  volume24hUsd?: number | string
  priceUsd?: number | string
  updatedAt?: number | string
}

/**
 * Small semaphore to cap concurrency
 */
class Semaphore {
  private queue: Array<() => void> = []
  private active = 0
  constructor(private readonly limit: number) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++
      let released = false
      return () => {
        if (released) return
        released = true
        this.active--
        this.queue.shift()?.()
      }
    }
    return new Promise(resolve => {
      const tryAcquire = () => {
        this.active++
        let released = false
        resolve(() => {
          if (released) return
          released = true
          this.active--
          this.queue.shift()?.()
        })
      }
      this.queue.push(tryAcquire)
    })
  }
}

export class DexSuite {
  private readonly timeoutMs: number
  private readonly retries: number
  private readonly sem?: Semaphore

  constructor(private config: DexSuiteConfig) {
    this.timeoutMs = Math.max(1_000, config.timeoutMs ?? 10_000)
    this.retries = Math.max(0, config.retries ?? 1)
    this.sem = config.concurrency && config.concurrency > 0 ? new Semaphore(config.concurrency) : undefined
  }

  private buildHeaders(api: ApiDef): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" }
    if (api.apiKey) h["Authorization"] = `Bearer ${api.apiKey}`
    return h
  }

  private async fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await fetch(url, { headers, signal: controller.signal as any })
    } finally {
      clearTimeout(timer)
    }
  }

  private async fetchFromApi<T>(api: ApiDef, path: string): Promise<T> {
    const url = `${api.baseUrl}${path}`
    const headers = this.buildHeaders(api)

    let lastErr: unknown
    const attempts = this.retries + 1
    for (let i = 0; i < attempts; i++) {
      const release = this.sem ? await this.sem.acquire() : undefined
      try {
        const res = await this.fetchWithTimeout(url, headers)
        if (!res.ok) throw new Error(`${api.name} ${path} ${res.status} ${res.statusText}`)
        return (await res.json()) as T
      } catch (e) {
        lastErr = e
        if (i < attempts - 1) {
          // basic linear backoff to avoid tight loops on shared endpoints
          await new Promise(r => setTimeout(r, 150 * (i + 1)))
          continue
        }
        throw lastErr
      } finally {
        release?.()
      }
    }
    // unreachable
    throw new Error(`Failed to fetch ${url}`)
  }

  private normalizePair(api: ApiDef, pairAddress: string, data: RawPairResponse): PairInfo | null {
    const baseSymbol = data.token0?.symbol ?? ""
    const quoteSymbol = data.token1?.symbol ?? ""
    const liquidityUsd = Number(data.liquidityUsd ?? 0)
    const volume24hUsd = Number(data.volume24hUsd ?? 0)
    const priceUsd = Number(data.priceUsd ?? 0)
    if (!baseSymbol || !quoteSymbol || !Number.isFinite(priceUsd)) {
      return null
    }
    const updatedAt = data.updatedAt !== undefined ? Number(data.updatedAt) : Date.now()
    return {
      exchange: api.name,
      pairAddress,
      baseSymbol,
      quoteSymbol,
      liquidityUsd: Number.isFinite(liquidityUsd) ? liquidityUsd : 0,
      volume24hUsd: Number.isFinite(volume24hUsd) ? volume24hUsd : 0,
      priceUsd,
      updatedAt,
      sourceUrl: `${api.baseUrl}/pair/${pairAddress}`,
    }
  }

  /**
   * Retrieve aggregated pair info across all configured DEX APIs.
   * @param pairAddress Blockchain address of the trading pair
   */
  async getPairInfo(pairAddress: string): Promise<PairInfo[]> {
    if (!pairAddress) return []

    const tasks = this.config.apis.map(async api => {
      try {
        const data = await this.fetchFromApi<RawPairResponse>(api, `/pair/${encodeURIComponent(pairAddress)}`)
        const normalized = this.normalizePair(api, pairAddress, data)
        return normalized
      } catch {
        return null
      }
    })

    const results = await Promise.all(tasks)
    // Filter nulls and dedupe by exchange name in case of duplicates
    const unique: Record<string, PairInfo> = {}
    for (const r of results) {
      if (r && !unique[r.exchange]) unique[r.exchange] = r
    }
    return Object.values(unique)
  }

  /**
   * Summarize an array of PairInfo into basic aggregates.
   */
  summarize(infos: PairInfo[]): {
    count: number
    medianPriceUsd: number
    totalLiquidityUsd: number
    totalVolume24hUsd: number
  } {
    const count = infos.length
    const prices = infos.map(i => i.priceUsd).sort((a, b) => a - b)
    const medianPriceUsd =
      count === 0 ? 0 : count % 2 ? prices[(count - 1) / 2] : (prices[count / 2 - 1] + prices[count / 2]) / 2
    const totalLiquidityUsd = infos.reduce((s, i) => s + i.liquidityUsd, 0)
    const totalVolume24hUsd = infos.reduce((s, i) => s + i.volume24hUsd, 0)
    return { count, medianPriceUsd, totalLiquidityUsd, totalVolume24hUsd }
  }

  /**
   * Compare a list of pairs across exchanges, returning the best volume and liquidity per pair.
   */
  async comparePairs(
    pairs: string[]
  ): Promise<Record<string, { bestVolume?: PairInfo; bestLiquidity?: PairInfo; summary: ReturnType<DexSuite["summarize"]> }>> {
    const entries = await Promise.all(
      pairs.map(async addr => {
        const infos = await this.getPairInfo(addr)
        if (!infos.length) {
          return [addr, { bestVolume: undefined, bestLiquidity: undefined, summary: this.summarize([]) }] as const
        }
        const bestVolume = infos.reduce((a, b) => (b.volume24hUsd > a.volume24hUsd ? b : a))
        const bestLiquidity = infos.reduce((a, b) => (b.liquidityUsd > a.liquidityUsd ? b : a))
        return [addr, { bestVolume, bestLiquidity, summary: this.summarize(infos) }] as const
      })
    )
    return Object.fromEntries(entries)
  }
}
