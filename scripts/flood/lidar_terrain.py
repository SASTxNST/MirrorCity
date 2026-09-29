"""
Build a flood-model terrain grid from the LiDAR street scan.

Rasterizes public/models/lidar/road-terrain.obj (a Z-up ground mesh) onto
a regular grid and marks the scanned building masses as obstacles. Cells
the scan never covered are obstacles too: the model has no ground there.

    python3 -m scripts.flood.lidar_terrain

writes scripts/flood/data/lidar-street.npz (see terrain.save_terrain).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .terrain import save_terrain

LIDAR = Path("public/models/lidar")
OUTPUT = Path("scripts/flood/data/lidar-street.npz")

# Grid cell size (m). 2 m keeps 5-7 cells across the street and runs
# ~8x faster than 1 m, which matters in the browser.
CELL = 2.0


def read_obj(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Vertices (n, 3) and triangle indices (m, 3) of a triangulated OBJ."""

    vertices = []
    faces = []

    for line in path.read_text().splitlines():
        if line.startswith("v "):
            vertices.append([float(value) for value in line.split()[1:4]])
        elif line.startswith("f "):
            faces.append([int(item.split("/")[0]) - 1 for item in line.split()[1:4]])

    return np.array(vertices), np.array(faces)


def rasterize(
    vertices: np.ndarray,
    faces: np.ndarray,
    origin: tuple[float, float],
    shape: tuple[int, int],
    cell: float,
) -> np.ndarray:
    """
    Height of the mesh at each cell centre, NaN where no triangle
    covers it. Row j is y, column i is x.
    """

    ny, nx = shape
    x0, y0 = origin
    heights = np.full(shape, np.nan)

    for (ax, ay, az), (bx, by, bz), (cx, cy, cz) in vertices[faces]:

        denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)

        if abs(denominator) < 1.0e-12:
            continue  # Vertical or degenerate in plan view.

        i0 = max(int(np.ceil((min(ax, bx, cx) - x0) / cell - 0.5)), 0)
        i1 = min(int(np.floor((max(ax, bx, cx) - x0) / cell - 0.5)), nx - 1)
        j0 = max(int(np.ceil((min(ay, by, cy) - y0) / cell - 0.5)), 0)
        j1 = min(int(np.floor((max(ay, by, cy) - y0) / cell - 0.5)), ny - 1)

        if i1 < i0 or j1 < j0:
            continue

        x, y = np.meshgrid(
            x0 + (np.arange(i0, i1 + 1) + 0.5) * cell,
            y0 + (np.arange(j0, j1 + 1) + 0.5) * cell,
        )

        # Barycentric coordinates of each cell centre.
        l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denominator
        l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denominator
        l3 = 1.0 - l1 - l2

        inside = (l1 >= -1.0e-9) & (l2 >= -1.0e-9) & (l3 >= -1.0e-9)

        window = heights[j0:j1 + 1, i0:i1 + 1]
        window[inside] = (l1 * az + l2 * bz + l3 * cz)[inside]

    return heights


def fill_gaps(
    heights: np.ndarray,
    min_neighbours: int = 1,
    passes: int | None = None,
) -> np.ndarray:
    """
    Fill NaN cells with the mean of their known 4-neighbours, one ring
    at a time. Only cells with at least `min_neighbours` known
    neighbours are filled; `passes=None` repeats until nothing changes.
    """

    heights = heights.copy()

    while passes is None or passes > 0:

        padded = np.pad(heights, 1, constant_values=np.nan)
        neighbours = np.stack([
            padded[:-2, 1:-1],
            padded[2:, 1:-1],
            padded[1:-1, :-2],
            padded[1:-1, 2:],
        ])

        known = np.isfinite(neighbours).sum(axis=0)
        fillable = np.isnan(heights) & (known >= min_neighbours)

        if not fillable.any():
            break

        heights[fillable] = np.nanmean(neighbours[:, fillable], axis=0)

        if passes is not None:
            passes -= 1

    return heights


def build(cell: float = CELL) -> tuple[np.ndarray, np.ndarray]:
    """Elevation and obstacle mask for the LiDAR street scan."""

    ground, ground_faces = read_obj(LIDAR / "road-terrain.obj")
    buildings, building_faces = read_obj(LIDAR / "building-masses.obj")

    origin = (ground[:, 0].min(), ground[:, 1].min())
    shape = (
        int(np.ceil((ground[:, 1].max() - origin[1]) / cell)),
        int(np.ceil((ground[:, 0].max() - origin[0]) / cell)),
    )

    # Close pinholes between scan lines, but don't grow the corridor.
    elevation = fill_gaps(
        rasterize(ground, ground_faces, origin, shape, cell),
        min_neighbours=3,
        passes=2,
    )

    no_ground = np.isnan(elevation)
    footprints = np.isfinite(
        rasterize(buildings, building_faces, origin, shape, cell)
    )

    # Obstacle cells still need finite heights: the solver differences
    # across them, so extend the surrounding ground smoothly.
    elevation = fill_gaps(elevation)

    return elevation, no_ground | footprints


def main() -> None:

    elevation, obstacles = build()

    save_terrain(OUTPUT, elevation, CELL, CELL, obstacles=obstacles)

    ny, nx = elevation.shape
    open_ground = ~obstacles

    print(f"Wrote {OUTPUT}")
    print(f"Grid:        {nx} × {ny} at {CELL} m")
    print(f"Open ground: {open_ground.sum()} cells ({open_ground.mean():.0%})")
    print(
        f"Relief:      {np.ptp(elevation[open_ground]):.2f} m "
        f"({elevation[open_ground].min():.2f} to {elevation[open_ground].max():.2f})"
    )


if __name__ == "__main__":
    main()
