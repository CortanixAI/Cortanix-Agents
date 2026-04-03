export interface PricePoint {
  timestamp: number
  priceUsd: number
}

export interface TrendResult {
  startTime: number
  endTime: number
  trend: "upward" | "downward" | "neutral"
  changePct: number
  duration: number
  volatility: number
}

/**
 * Compute simple moving average for smoothing.
 */
function movingAverage(values: number[], window: number): number[] {
  if (window <= 1) return values.slice()
  const res: number[] = []
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1)
    const slice = values.slice(start, i + 1)
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length
    res.push(avg)
  }
  return res
}

/**
 * Calculate volatility as standard deviation of price changes within a segment.
 */
function calculateVolatility(points: PricePoint[], start: number, end: number): number {
  if (end <= start) return 0
  const changes: number[] = []
  for (let i = start + 1; i <= end; i++) {
    const prev = points[i - 1].priceUsd
    const curr = points[i].priceUsd
    if (prev !== 0) {
      changes.push((curr - prev) / prev)
    }
  }
  if (changes.length === 0) return 0
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length
  const variance = changes.reduce((a, b) => a + (b - mean) ** 2, 0) / changes.length
  return Math.sqrt(variance) * 100
}

/**
 * Analyze a series of price points to determine overall trend segments.
 */
export function analyzePriceTrends(
  points: PricePoint[],
  minSegmentLength: number = 5,
  smoothingWindow: number = 1
): TrendResult[] {
  const results: TrendResult[] = []
  if (points.length < minSegmentLength) return results

  // apply smoothing if requested
  const smoothedPrices = smoothingWindow > 1
    ? movingAverage(points.map(p => p.priceUsd), smoothingWindow)
    : points.map(p => p.priceUsd)

  let segStart = 0
  for (let i = 1; i < points.length; i++) {
    const prev = smoothedPrices[i - 1]
    const curr = smoothedPrices[i]
    const direction = curr > prev ? 1 : curr < prev ? -1 : 0

    const isLastPoint = i === points.length - 1
    const directionReverses =
      (direction === 1 && smoothedPrices[i + 1] < curr) ||
      (direction === -1 && smoothedPrices[i + 1] > curr)

    if (i - segStart >= minSegmentLength && (isLastPoint || directionReverses)) {
      const start = points[segStart]
      const end = points[i]
      const changePct = ((end.priceUsd - start.priceUsd) / start.priceUsd) * 100
      const duration = end.timestamp - start.timestamp
      const volatility = calculateVolatility(points, segStart, i)

      results.push({
        startTime: start.timestamp,
        endTime: end.timestamp,
        trend: changePct > 0 ? "upward" : changePct < 0 ? "downward" : "neutral",
        changePct: Math.round(changePct * 100) / 100,
        duration,
        volatility: Math.round(volatility * 100) / 100,
      })

      segStart = i
    }
  }
  return results
}
