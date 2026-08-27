"""
Terrain utilities for the MirrorCity flood model.

The flood solver works on a regular elevation grid:

    elevation[j, i] = terrain height at grid cell (i, j)

Units:
    elevation -> metres
    dx, dy    -> metres
"""

from __future__ import annotations

from pathlib import Path

import numpy as np


def create_test_terrain(
    nx: int = 80,
    ny: int = 60,
    dx: float = 2.0,
    dy: float = 2.0,
) -> tuple[np.ndarray, float, float]:
    """
    Create a synthetic sloping terrain with a central depression.

    This is deliberately simple so that we can verify whether water
    moves downhill and accumulates in low areas.

    Returns:
        elevation: shape (ny, nx), metres
        dx: cell width, metres
        dy: cell height, metres
    """

    x = np.arange(nx) * dx
    y = np.arange(ny) * dy

    xx, yy = np.meshgrid(x, y)

    # Gentle overall downhill slope.
    base = 100.0 - 0.03 * xx - 0.01 * yy

    # A smooth depression near the middle of the domain.
    cx = x.mean()
    cy = y.mean()

    depression = 2.0 * np.exp(
        -(
            ((xx - cx) / 18.0) ** 2
            + ((yy - cy) / 14.0) ** 2
        )
    )

    elevation = base - depression

    return elevation.astype(np.float64), dx, dy


def save_terrain(
    path: str | Path,
    elevation: np.ndarray,
    dx: float,
    dy: float,
) -> None:
    """Save a terrain grid to a compressed NumPy archive."""

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    np.savez_compressed(
        path,
        elevation=elevation,
        dx=np.array(dx),
        dy=np.array(dy),
    )


def load_terrain(
    path: str | Path,
) -> tuple[np.ndarray, float, float]:
    """Load a terrain grid previously saved by save_terrain()."""

    data = np.load(path)

    elevation = np.asarray(data["elevation"], dtype=np.float64)
    dx = float(data["dx"])
    dy = float(data["dy"])

    if elevation.ndim != 2:
        raise ValueError("Terrain elevation must be a 2-D array.")

    if dx <= 0 or dy <= 0:
        raise ValueError("Grid spacing dx and dy must be positive.")

    return elevation, dx, dy