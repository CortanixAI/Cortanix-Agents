from typing import List, Dict, Union
import statistics

def generate_activity_heatmap(
    timestamps: List[int],
    counts: List[int],
    buckets: int = 10,
    normalize: bool = True,
    include_stats: bool = False
) -> Union[List[float], Dict[str, Union[List[float], float]]]:
    """
    Bucket activity counts into 'buckets' time intervals,
    returning either raw counts or normalized [0.0–1.0].
    
    Args:
        timestamps: list of epoch ms timestamps
        counts: list of integer counts per timestamp
        buckets: number of intervals to group into (default: 10)
        normalize: if True, values are scaled to [0,1]
        include_stats: if True, returns dict with heatmap + summary stats

    Returns:
        List[float] or Dict with 'heatmap' and stats (mean, stdev, total)
    """
    if not timestamps or not counts or len(timestamps) != len(counts):
        return [] if not include_stats else {"heatmap": [], "mean": 0, "stdev": 0, "total": 0}

    t_min, t_max = min(timestamps), max(timestamps)
    span = t_max - t_min or 1
    bucket_size = span / buckets

    agg = [0.0] * buckets
    for t, c in zip(timestamps, counts):
        idx = min(buckets - 1, int((t - t_min) / bucket_size))
        agg[idx] += c

    if normalize:
        m = max(agg) or 1
        heatmap = [round(val / m, 4) for val in agg]
    else:
        heatmap = agg

    if include_stats:
        return {
            "heatmap": heatmap,
            "mean": round(statistics.mean(agg), 4) if agg else 0,
            "stdev": round(statistics.pstdev(agg), 4) if len(agg) > 1 else 0,
            "total": round(sum(agg), 4),
        }
    return heatmap
