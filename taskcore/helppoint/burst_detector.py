from typing import List, Dict, Union


def detect_volume_bursts(
    volumes: List[float],
    threshold_ratio: float = 1.5,
    min_interval: int = 1,
    return_with_metadata: bool = False
) -> Union[List[Dict[str, float]], Dict[str, Union[List[Dict[str, float]], int]]]:
    """
    Identify indices where volume jumps by threshold_ratio over the previous value.

    Args:
        volumes: list of volume values (floats).
        threshold_ratio: ratio that defines a "burst" (default: 1.5 → 50% increase).
        min_interval: minimum spacing between detected events (default: 1).
        return_with_metadata: if True, returns dict with events and summary metadata.

    Returns:
        - List of dicts: {index, previous, current, ratio}, or
        - Dict with "events" and summary stats if return_with_metadata=True
    """
    if not volumes or len(volumes) < 2:
        return [] if not return_with_metadata else {"events": [], "total": 0, "max_ratio": 0}

    events: List[Dict[str, float]] = []
    last_idx = -min_interval

    for i in range(1, len(volumes)):
        prev, curr = volumes[i - 1], volumes[i]

        # Guard against division by zero
        ratio = (curr / prev) if prev > 0 else float("inf")

        if ratio >= threshold_ratio and (i - last_idx) >= min_interval:
            events.append({
                "index": float(i),
                "previous": float(prev),
                "current": float(curr),
                "ratio": round(ratio, 4)
            })
            last_idx = i

    if return_with_metadata:
        max_ratio = max((e["ratio"] for e in events), default=0)
        return {
            "events": events,
            "total": len(events),
            "max_ratio": round(max_ratio, 4)
        }

    return events
