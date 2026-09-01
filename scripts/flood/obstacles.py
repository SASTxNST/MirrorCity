"""
Hydraulic obstacle utilities for MirrorCity.

An obstacle mask identifies cells that cannot contain surface water.

This provides the first bridge between MirrorCity's 3-D buildings
and the numerical flood domain.
"""

from __future__ import annotations

import numpy as np


def empty_obstacle_mask(
    shape: tuple[int, int],
) -> np.ndarray:
    """Create a grid with no obstacles."""

    return np.zeros(
        shape,
        dtype=bool,
    )


def rectangular_obstacle(
    shape: tuple[int, int],
    x0: int,
    x1: int,
    y0: int,
    y1: int,
) -> np.ndarray:
    """
    Create a rectangular blocked region.

    Coordinates use NumPy array convention:

        mask[y, x]
    """

    ny, nx = shape

    if not (
        0 <= x0 < x1 <= nx
        and 0 <= y0 < y1 <= ny
    ):
        raise ValueError(
            "Obstacle bounds are outside the grid."
        )

    mask = np.zeros(
        shape,
        dtype=bool,
    )

    mask[y0:y1, x0:x1] = True

    return mask


def combine_obstacles(
    *masks: np.ndarray,
) -> np.ndarray:
    """Combine multiple obstacle masks."""

    if not masks:
        raise ValueError(
            "At least one obstacle mask is required."
        )

    result = np.zeros_like(
        masks[0],
        dtype=bool,
    )

    for mask in masks:

        mask = np.asarray(
            mask,
            dtype=bool,
        )

        if mask.shape != result.shape:
            raise ValueError(
                "All obstacle masks must have the same shape."
            )

        result |= mask

    return result
    