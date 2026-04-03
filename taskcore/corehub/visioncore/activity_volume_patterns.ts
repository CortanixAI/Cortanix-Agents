/**
 * Detect volume-based patterns in a series of activity amounts.
 * Identifies windows where average exceeds threshold, and provides additional context.
 */
export interface PatternMatch {
  index: number
  window: number
  average: number
  max: number
  min: number
  stdDev: number
  zScore?: number
}

function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function stddev(values: number[], avg: number): number {
  if (!values.length) return 0
  const variance = values.reduce((acc, v) => acc + (v - avg) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

/**
 * Detects high-volume activity windows.
 * @param volumes Series of numeric volumes
 * @param windowSize Size of rolling window
 * @param threshold Minimum average volume threshold
 * @param useZScore If true, also compute z-scores vs global distribution
 */
export function detectVolumePatterns(
  volumes: number[],
  windowSize: number,
  threshold: number,
  useZScore = false
): PatternMatch[] {
  const matches: PatternMatch[] = []
  if (windowSize <= 0 || threshold <= 0 || volumes.length < windowSize) return matches

  const globalAvg = mean(volumes)
  const globalStd = stddev(volumes, globalAvg)

  for (let i = 0; i + windowSize <= volumes.length; i++) {
    const slice = volumes.slice(i, i + windowSize)
    const avg = mean(slice)
    if (avg >= threshold) {
      const max = Math.max(...slice)
      const min = Math.min(...slice)
      const std = stddev(slice, avg)
      const zScore = useZScore && globalStd > 0 ? (avg - globalAvg) / globalStd : undefined
      matches.push({
        index: i,
        window: windowSize,
        average: round(avg, 6),
        max: round(max, 6),
        min: round(min, 6),
        stdDev: round(std, 6),
        zScore: zScore !== undefined ? round(zScore, 4) : undefined,
      })
    }
  }
  return matches
}

function round(n: number, dec = 4): number {
  const f = Math.pow(10, dec)
  return Math.round(n * f) / f
}
