"""Stage 3: find how far the recording sits off the A440 semitone grid, and remove it."""

from __future__ import annotations

import numpy as np


def estimate_offset_cents(midi: np.ndarray, mask: np.ndarray) -> float:
    """Circular median of each frame's distance from the nearest semitone, in cents (-50..50).

    Circular because +49 and -49 cents are 2 cents apart, not 98. The median is
    the grid point minimising the summed circular distance to every frame.
    """
    dev = midi[mask] - np.round(midi[mask])
    if dev.size == 0:
        return 0.0
    if dev.size > 20000:  # plenty to pin a median; keeps this O(100 * N) cheap
        dev = dev[np.linspace(0, dev.size - 1, 20000).astype(int)]
    cand = np.arange(-0.5, 0.5, 0.01)
    d = np.abs(dev[None, :] - cand[:, None])
    d = np.minimum(d, 1 - d)
    best = cand[np.argmin(d.sum(axis=1))]
    return float(round(best * 100, 1))


def apply_offset(midi: np.ndarray, cents: float) -> np.ndarray:
    return midi - cents / 100.0
