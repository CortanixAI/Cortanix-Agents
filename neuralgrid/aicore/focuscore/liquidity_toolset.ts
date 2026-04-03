import { toolkitBuilder } from "@/ai/core"
import { FETCH_POOL_DATA_KEY } from "@/ai/modules/liquidity/pool-fetcher/key"
import { ANALYZE_POOL_HEALTH_KEY } from "@/ai/modules/liquidity/health-checker/key"
import { FetchPoolDataAction } from "@/ai/modules/liquidity/pool-fetcher/action"
import { AnalyzePoolHealthAction } from "@/ai/modules/liquidity/health-checker/action"

type Toolkit = ReturnType<typeof toolkitBuilder>

/**
 * Toolkit exposing liquidity-related actions:
 * – fetch raw pool data
 * – run health / risk analysis on a liquidity pool
 * – compute extended pool insights (volume, fees, depth stability)
 */
class PoolInsightsAction {
  readonly key = "pool_insights"
  async run(params: { poolAddress: string }) {
    // placeholder for now – extend with actual analytics pipeline
    return {
      poolAddress: params.poolAddress,
      volume24h: 0,
      feeApr: 0,
      depthStability: "unknown",
    }
  }
}

/**
 * Toolkit exposing liquidity-related actions.
 * Includes fetching, health checks, and extended insights.
 */
export const LIQUIDITY_ANALYSIS_TOOLS: Record<string, Toolkit> = Object.freeze({
  [`liquidityscan-${FETCH_POOL_DATA_KEY}`]: toolkitBuilder(new FetchPoolDataAction()),
  [`poolhealth-${ANALYZE_POOL_HEALTH_KEY}`]: toolkitBuilder(new AnalyzePoolHealthAction()),
  ["poolinsights"]: toolkitBuilder(new PoolInsightsAction()),
})
