import fetch from "node-fetch"

/*------------------------------------------------------
 * Types
 *----------------------------------------------------*/

interface Candle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
}

export type CandlestickPattern =
  | "Hammer"
  | "ShootingStar"
  | "BullishEngulfing"
  | "BearishEngulfing"
  | "Doji"

export interface PatternSignal {
  timestamp: number
  pattern: CandlestickPattern
  confidence: number
}

/*------------------------------------------------------
 * Detector
 *----------------------------------------------------*/

type DetectorOptions = {
  /** Timeout for HTTP requests in ms (default 10s) */
  timeoutMs?: number
  /** Minimum confidence to include a signal (default 0.6) */
  minConfidence?: number
}

export class CandlestickPatternDetector {
  private readonly timeoutMs: number
  private readonly minConfidence: number

  constructor(private readonly apiUrl: string, opts: DetectorOptions = {}) {
    this.timeoutMs = Math.max(1000, opts.timeoutMs ?? 10_000)
    this.minConfidence = Math.min(1, Math.max(0, opts.minConfidence ?? 0.6))
  }

  /** Fetch recent OHLC candles for a symbol from `${apiUrl}/markets/:symbol/candles` */
  async fetchCandles(symbol: string, limit = 100): Promise<Candle[]> {
    const url = `${this.apiUrl}/markets/${encodeURIComponent(symbol)}/candles?limit=${limit}`

    // Use AbortController for reliable timeouts with node-fetch
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) {
        throw new Error(`Failed to fetch candles ${res.status}: ${res.statusText}`)
      }
      const raw = (await res.json()) as Candle[]
      return this.normalizeCandles(raw)
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`Fetch timed out after ${this.timeoutMs}ms`)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  /* ------------------------- Public analysis APIs ---------------------- */

  /** Detect patterns in already-fetched candles */
  detect(candles: Candle[], minConfidence = this.minConfidence): PatternSignal[] {
    const data = this.normalizeCandles(candles)
    const signals: PatternSignal[] = []

    for (let i = 0; i < data.length; i++) {
      const c = data[i]
      const prev = i > 0 ? data[i - 1] : undefined

      // Single-candle patterns
      const hammer = this.isHammer(c)
      if (hammer >= minConfidence) signals.push({ timestamp: c.timestamp, pattern: "Hammer", confidence: round2(hammer) })

      const shooting = this.isShootingStar(c)
      if (shooting >= minConfidence) signals.push({ timestamp: c.timestamp, pattern: "ShootingStar", confidence: round2(shooting) })

      const doji = this.isDoji(c)
      if (doji >= minConfidence) signals.push({ timestamp: c.timestamp, pattern: "Doji", confidence: round2(doji) })

      // Two-candle patterns (need previous)
      if (prev) {
        const bullEng = this.isBullishEngulfing(prev, c)
        if (bullEng >= minConfidence) {
          signals.push({ timestamp: c.timestamp, pattern: "BullishEngulfing", confidence: round2(bullEng) })
        }
        const bearEng = this.isBearishEngulfing(prev, c)
        if (bearEng >= minConfidence) {
          signals.push({ timestamp: c.timestamp, pattern: "BearishEngulfing", confidence: round2(bearEng) })
        }
      }
    }

    return signals
  }

  /** Convenience method: fetch & detect for a symbol */
  async detectForSymbol(symbol: string, limit = 100, minConfidence = this.minConfidence): Promise<PatternSignal[]> {
    const candles = await this.fetchCandles(symbol, limit)
    return this.detect(candles, minConfidence)
  }

  /* ------------------------- Pattern helpers ---------------------- */

  private isHammer(c: Candle): number {
    const range = this.range(c)
    if (range <= 0) return 0
    const body = this.body(c)
    const lowerWick = Math.min(c.open, c.close) - c.low
    const upperWick = c.high - Math.max(c.open, c.close)

    // Hammer characteristics: small body near high, long lower wick, tiny upper wick
    const lowerToBody = body > 0 ? lowerWick / body : 0
    const bodyToRange = body / range
    const upperToRange = upperWick / range

    if (lowerToBody > 2 && bodyToRange < 0.35 && upperToRange < 0.2) {
      // Confidence scales with lower wick length and smaller body
      const score = clamp01((lowerToBody / 4) * (1 - bodyToRange))
      return score
    }
    return 0
  }

  private isShootingStar(c: Candle): number {
    const range = this.range(c)
    if (range <= 0) return 0
    const body = this.body(c)
    const upperWick = c.high - Math.max(c.open, c.close)
    const lowerWick = Math.min(c.open, c.close) - c.low

    // Shooting star: small body near low, long upper wick, tiny lower wick
    const upperToBody = body > 0 ? upperWick / body : 0
    const bodyToRange = body / range
    const lowerToRange = lowerWick / range

    if (upperToBody > 2 && bodyToRange < 0.35 && lowerToRange < 0.2) {
      const score = clamp01((upperToBody / 4) * (1 - bodyToRange))
      return score
    }
    return 0
  }

  private isBullishEngulfing(prev: Candle, curr: Candle): number {
    const prevBear = prev.close < prev.open
    const currBull = curr.close > curr.open
    const engulf =
      curr.close >= Math.max(prev.open, prev.close) &&
      curr.open <= Math.min(prev.open, prev.close)

    if (!(prevBear && currBull && engulf)) return 0

    const bodyPrev = this.body(prev)
    const bodyCurr = this.body(curr)
    if (bodyPrev <= 0 || bodyCurr <= 0) return 0

    const ratio = bodyCurr / bodyPrev
    // Confidence increases with stronger engulfment and longer current body
    const strength = clamp01(ratio / 2) // ratio 2x -> score ~1
    return Math.max(0.6, strength)
  }

  private isBearishEngulfing(prev: Candle, curr: Candle): number {
    const prevBull = prev.close > prev.open
    const currBear = curr.close < curr.open
    const engulf =
      curr.open >= Math.max(prev.open, prev.close) &&
      curr.close <= Math.min(prev.open, prev.close)

    if (!(prevBull && currBear && engulf)) return 0

    const bodyPrev = this.body(prev)
    const bodyCurr = this.body(curr)
    if (bodyPrev <= 0 || bodyCurr <= 0) return 0

    const ratio = bodyCurr / bodyPrev
    const strength = clamp01(ratio / 2)
    return Math.max(0.6, strength)
  }

  private isDoji(c: Candle): number {
    const range = this.range(c)
    if (range <= 0) return 0
    const body = this.body(c)
    const bodyRatio = body / range
    if (bodyRatio < 0.1) {
      // The closer to zero body, the higher the confidence
      return clamp01(1 - bodyRatio * 10)
    }
    return 0
  }

  /* ------------------------- Utilities ---------------------- */

  private body(c: Candle): number {
    return Math.abs(c.close - c.open)
  }

  private range(c: Candle): number {
    return c.high - c.low
  }

  private normalizeCandles(raw: Candle[]): Candle[] {
    // Ensure numeric coercion and ascending time order
    const cleaned = raw
      .map(c => ({
        timestamp: Number(c.timestamp),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      }))
      .filter(c => Number.isFinite(c.timestamp) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))

    cleaned.sort((a, b) => a.timestamp - b.timestamp)
    return cleaned
  }
}

/*------------------------------------------------------
 * Helpers
 *----------------------------------------------------*/

function clamp01(x: number): number {
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}
