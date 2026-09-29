"""
Build a flood-model terrain grid from the LiDAR street scan.

Rasterizes public/models/lidar/road-terrain.obj (a Z-up ground mesh) onto
a regular grid and marks the scanned building masses as obstacles. Cells
the scan never covered are obstacles too: the model has no ground there.
Each cell also gets a surface type (road / concrete / grass) recovered
from the mesh's semantic colours, for per-surface roughness and
infiltration.

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

# SemanticKITTI ground-class colours used by scripts/reconstruct_lidar_models.py,
# grouped by how water behaves on them. Mesh colours were scaled by LiDAR
# intensity and averaged, so cells are matched by chromaticity (colour / sum).
SURFACE_COLOURS = {
    "road": [(0.28, 0.34, 0.34), (0.40, 0.44, 0.42), (0.96, 0.86, 0.44)],  # road, parking, lane marking
    "concrete": [(0.61, 0.57, 0.48), (0.47, 0.45, 0.40)],  # sidewalk, other ground
    "grass": [(0.39, 0.48, 0.38)],  # terrain
}


def read_obj(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """
    Vertices (n, 3), or (n, 6) with x y z r g b when the OBJ has vertex
    colours, and triangle indices (m, 3) of a triangulated OBJ.
    """

    vertices = []
    faces = []

    for line in path.read_text().splitlines():
        if line.startswith("v "):
            vertices.append([float(value) for value in line.split()[1:]])
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


def classify_surface(colours: np.ndarray) -> np.ndarray:
    """Nearest surface type by chromaticity for (..., 3) RGB colours."""

    names = [name for name, group in SURFACE_COLOURS.items() for _ in group]
    references = np.array([colour for group in SURFACE_COLOURS.values() for colour in group])
    references /= references.sum(axis=1, keepdims=True)

    chromaticity = colours / colours.sum(axis=-1, keepdims=True)
    distance = ((chromaticity[..., None, :] - references) ** 2).sum(axis=-1)

    return np.array(names)[distance.argmin(axis=-1)]


def build(cell: float = CELL) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Elevation, obstacle mask and surface types for the LiDAR street scan."""

    ground, ground_faces = read_obj(LIDAR / "road-terrain.obj")
    buildings, building_faces = read_obj(LIDAR / "building-masses.obj")

    origin = (ground[:, 0].min(), ground[:, 1].min())
    shape = (
        int(np.ceil((ground[:, 1].max() - origin[1]) / cell)),
        int(np.ceil((ground[:, 0].max() - origin[0]) / cell)),
    )

    # Close pinholes between scan lines, but don't grow the corridor.
    elevation = fill_gaps(
        rasterize(ground[:, :3], ground_faces, origin, shape, cell),
        min_neighbours=3,
        passes=2,
    )

    # Rasterize each colour channel like a height, filled the same way.
    colours = np.stack([
        fill_gaps(
            rasterize(ground[:, [0, 1, 3 + channel]], ground_faces, origin, shape, cell),
            min_neighbours=3,
            passes=2,
        )
        for channel in range(3)
    ], axis=-1)

    no_ground = np.isnan(elevation)
    footprints = np.isfinite(
        rasterize(buildings[:, :3], building_faces, origin, shape, cell)
    )

    # Obstacle cells still need finite heights: the solver differences
    # across them, so extend the surrounding ground smoothly.
    elevation = fill_gaps(elevation)

    obstacles = no_ground | footprints

    surface = np.full(shape, "", dtype="<U8")
    surface[~no_ground] = classify_surface(colours[~no_ground])

    return elevation, obstacles, surface


def main() -> None:

    elevation, obstacles, surface = build()

    save_terrain(OUTPUT, elevation, CELL, CELL, obstacles=obstacles, surface=surface)

    ny, nx = elevation.shape
    open_ground = ~obstacles

    print(f"Wrote {OUTPUT}")
    print(f"Grid:        {nx} × {ny} at {CELL} m")
    print(f"Open ground: {open_ground.sum()} cells ({open_ground.mean():.0%})")
    print(
        f"Relief:      {np.ptp(elevation[open_ground]):.2f} m "
        f"({elevation[open_ground].min():.2f} to {elevation[open_ground].max():.2f})"
    )

    for name in SURFACE_COLOURS:
        print(f"{name.capitalize() + ':':13}{np.mean(surface[open_ground] == name):.0%} of open ground")


if __name__ == "__main__":
    main()
