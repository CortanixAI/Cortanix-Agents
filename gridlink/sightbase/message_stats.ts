import type { SightCoreMessage } from "./WebSocketClient"

export interface AggregatedSignal {
  topic: string
  count: number
  lastPayload: any
  lastTimestamp: number
}

export class SignalAggregator {
  private counts: Record<string, AggregatedSignal> = {}

  /**
   * Process a new message and update aggregation
   */
  processMessage(msg: SightCoreMessage): AggregatedSignal {
    if (!msg || !msg.topic) {
      throw new Error("Invalid message: missing topic")
    }
    const { topic, payload, timestamp } = msg
    const entry =
      this.counts[topic] || {
        topic,
        count: 0,
        lastPayload: null,
        lastTimestamp: 0,
      }
    entry.count += 1
    entry.lastPayload = payload
    entry.lastTimestamp = timestamp || Date.now()
    this.counts[topic] = entry
    return entry
  }

  /**
   * Get aggregated info for a specific topic
   */
  getAggregated(topic: string): AggregatedSignal | undefined {
    return this.counts[topic]
  }

  /**
   * Get all aggregated signals
   */
  getAllAggregated(): AggregatedSignal[] {
    return Object.values(this.counts)
  }

  /**
   * Return the total number of messages processed across all topics
   */
  getTotalCount(): number {
    return Object.values(this.counts).reduce((sum, entry) => sum + entry.count, 0)
  }

  /**
   * Export a safe snapshot (no references to live objects)
   */
  snapshot(): AggregatedSignal[] {
    return this.getAllAggregated().map(e => ({ ...e }))
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.counts = {}
  }

  /**
   * Reset aggregation for a single topic
   */
  resetTopic(topic: string): void {
    delete this.counts[topic]
  }
}
