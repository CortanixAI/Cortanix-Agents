import { toolkitBuilder } from "@/ai/core"
import { FETCH_POOL_DATA_KEY } from "@/ai/modules/liquidity/pool-fetcher/key"
import { ANALYZE_POOL_HEALTH_KEY } from "@/ai/modules/liquidity/health-checker/key"
import { FetchPoolDataAction } from "@/ai/modules/liquidity/pool-fetcher/action"
import { AnalyzePoolHealthAction } from "@/ai/modules/liquidity/health-checker/action"

type Toolkit = ReturnType<typeof toolkitBuilder>

/**
 * Extra action: analyze liquidity depth changes and detect anomalies.
 */
class PoolDepthAnomalyAction {
  readonly key = "pool_depth_anomaly"
  async run(params: { poolAddress: string }) {
    // placeholder logic: integrate with depth API later
    return {
      poolAddress: params.poolAddress,
      anomalyDetected: false,
      recentDepthChange: 0,
    }
  }
}

/**
 * Extended liquidity toolkit including:
 * - raw pool data fetch
 * - health / risk checks
 * - anomaly detection for liquidity depth
 */
export const EXTENDED_LIQUIDITY_TOOLS: Record<string, Toolkit> = Object.freeze({
  [`liquidityscan-${FETCH_POOL_DATA_KEY}`]: toolkitBuilder(new FetchPoolDataAction()),
  [`poolhealth-${ANALYZE_POOL_HEALTH_KEY}`]: toolkitBuilder(new AnalyzePoolHealthAction()),
  ["pooldepth-anomaly"]: toolkitBuilder(new PoolDepthAnomalyAction()),
})
