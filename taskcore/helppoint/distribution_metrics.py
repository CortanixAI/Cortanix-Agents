import math
from typing import List, Dict


def compute_shannon_entropy(
    addresses: List[str],
    normalize: bool = False
) -> float:
    """
    Compute Shannon entropy (in bits) of a sequence of addresses.

    Args:
        addresses: list of address strings.
        normalize: if True, returns entropy normalized to [0,1] by dividing by log2(N),
                   where N = number of unique addresses.

    Returns:
        Shannon entropy value (rounded to 4 decimals).
    """
    if not addresses:
        return 0.0

    # Count frequencies
    freq: Dict[str, int] = {}
    for a in addresses:
        freq[a] = freq.get(a, 0) + 1

    total = len(addresses)
    entropy = 0.0

    for count in freq.values():
        p = count / total
        entropy -= p * math.log2(p)

    if normalize and len(freq) > 1:
        entropy /= math.log2(len(freq))

    return round(entropy, 4)
