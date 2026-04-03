export interface MetricEntry {
  key: string
  value: number
  updatedAt: number
  tags?: string[]
}

export class MetricsCache {
  private cache = new Map<string, MetricEntry>()

  get(key: string): MetricEntry | undefined {
    return this.cache.get(key)
  }

  set(key: string, value: number, tags?: string[]): void {
    this.cache.set(key, { key, value, updatedAt: Date.now(), tags })
  }

  hasRecent(key: string, maxAgeMs: number): boolean {
    const entry = this.cache.get(key)
    return !!entry && Date.now() - entry.updatedAt < maxAgeMs
  }

  invalidate(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  entries(): MetricEntry[] {
    return Array.from(this.cache.values())
  }

  keys(): string[] {
    return Array.from(this.cache.keys())
  }

  size(): number {
    return this.cache.size
  }

  /** Bulk insert multiple metrics at once */
  setMany(metrics: { key: string; value: number; tags?: string[] }[]): void {
    for (const m of metrics) {
      this.set(m.key, m.value, m.tags)
    }
  }

  /** Filter metrics by tag */
  filterByTag(tag: string): MetricEntry[] {
    return this.entries().filter(e => e.tags?.includes(tag))
  }

  /** Purge expired entries older than maxAgeMs */
  purgeOlderThan(maxAgeMs: number): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.updatedAt > maxAgeMs) {
        this.cache.delete(key)
      }
    }
  }
}
