import type { Signal } from "./SignalApiClient"

/**
 * Processes raw signals into actionable events.
 * Includes filtering, aggregation, summarization, and utility helpers.
 */
export class SignalProcessor {
  /**
   * Filter signals by type and recency.
   * @param signals Array of Signal
   * @param type Desired signal type
   * @param sinceTimestamp Only include signals after this time
   */
  filter(signals: Signal[], type: string, sinceTimestamp: number): Signal[] {
    return signals.filter(s => s.type === type && s.timestamp > sinceTimestamp)
  }

  /**
   * Aggregate signals by type, counting occurrences.
   * @param signals Array of Signal
   */
  aggregateByType(signals: Signal[]): Record<string, number> {
    return signals.reduce((acc, s) => {
      acc[s.type] = (acc[s.type] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  }

  /**
   * Transform a signal into a human-readable summary string.
   */
  summarize(signal: Signal): string {
    const time = new Date(signal.timestamp).toISOString()
    return `[${time}] ${signal.type.toUpperCase()}: ${JSON.stringify(signal.payload)}`
  }

  /**
   * Sort signals by timestamp (ascending by default).
   */
  sortByTimestamp(signals: Signal[], descending = false): Signal[] {
    return [...signals].sort((a, b) =>
      descending ? b.timestamp - a.timestamp : a.timestamp - b.timestamp
    )
  }

  /**
   * Group signals into buckets of a given size.
   */
  batch(signals: Signal[], batchSize: number): Signal[][] {
    const out: Signal[][] = []
    for (let i = 0; i < signals.length; i += batchSize) {
      out.push(signals.slice(i, i + batchSize))
    }
    return out
  }

  /**
   * Remove duplicate signals by id, keeping the most recent one if duplicates exist.
   */
  deduplicate(signals: Signal[]): Signal[] {
    const map = new Map<string, Signal>()
    for (const s of signals) {
      const existing = map.get(s.id)
      if (!existing || s.timestamp > existing.timestamp) {
        map.set(s.id, s)
      }
    }
    return Array.from(map.values())
  }

  /**
   * Extract basic statistics across all signals.
   */
  stats(signals: Signal[]): {
    total: number
    byType: Record<string, number>
    earliest?: number
    latest?: number
  } {
    if (signals.length === 0) {
      return { total: 0, byType: {} }
    }
    const byType = this.aggregateByType(signals)
    const timestamps = signals.map(s => s.timestamp)
    return {
      total: signals.length,
      byType,
      earliest: Math.min(...timestamps),
      latest: Math.max(...timestamps),
    }
  }
}
