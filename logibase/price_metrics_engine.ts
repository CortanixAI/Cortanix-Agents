export interface PricePoint {
  timestamp: number
  price: number
}

export interface TokenMetrics {
  averagePrice: number
  volatility: number      // standard deviation
  maxPrice: number
  minPrice: number
  medianPrice: number
  priceRange: number
  returnsVolatility: number
}

export class TokenAnalysisCalculator {
  constructor(private data: PricePoint[]) {}

  private isEmpty(): boolean {
    return this.data.length === 0
  }

  getAveragePrice(): number {
    if (this.isEmpty()) return 0
    const sum = this.data.reduce((acc, p) => acc + p.price, 0)
    return sum / this.data.length
  }

  getMedianPrice(): number {
    if (this.isEmpty()) return 0
    const sorted = [...this.data].map(p => p.price).sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid]
  }

  getVolatility(): number {
    if (this.isEmpty()) return 0
    const avg = this.getAveragePrice()
    const variance =
      this.data.reduce((acc, p) => acc + (p.price - avg) ** 2, 0) /
      this.data.length
    return Math.sqrt(variance)
  }

  getReturnsVolatility(): number {
    if (this.data.length < 2) return 0
    const returns: number[] = []
    for (let i = 1; i < this.data.length; i++) {
      const prev = this.data[i - 1].price
      const curr = this.data[i].price
      if (prev !== 0) {
        returns.push((curr - prev) / prev)
      }
    }
    if (returns.length === 0) return 0
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
    return Math.sqrt(variance)
  }

  getMaxPrice(): number {
    return this.isEmpty()
      ? 0
      : this.data.reduce((max, p) => (p.price > max ? p.price : max), -Infinity)
  }

  getMinPrice(): number {
    return this.isEmpty()
      ? 0
      : this.data.reduce((min, p) => (p.price < min ? p.price : min), Infinity)
  }

  getPriceRange(): number {
    if (this.isEmpty()) return 0
    return this.getMaxPrice() - this.getMinPrice()
  }

  computeMetrics(): TokenMetrics {
    return {
      averagePrice: this.getAveragePrice(),
      volatility: this.getVolatility(),
      maxPrice: this.getMaxPrice(),
      minPrice: this.getMinPrice(),
      medianPrice: this.getMedianPrice(),
      priceRange: this.getPriceRange(),
      returnsVolatility: this.getReturnsVolatility(),
    }
  }
}
