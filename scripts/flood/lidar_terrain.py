"""
Build a flood-model terrain grid from the LiDAR street scan.

Rasterizes public/models/lidar/road-terrain.obj (a Z-up ground mesh) onto
a regular grid and marks the scanned building masses as roofs (obstacles
whose rain drains to the ground). Beyond the street, cells where the
point cloud shows a structure (wall, fence, hedge) are walls; the rest
are "outside": water that flows there leaves the model.
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


def read_point_cloud(path: Path) -> np.ndarray:
    """x, y, z, r, g, b (colours 0-1) from Open3D's binary PLY point clouds."""

    data = path.read_bytes()
    body = data[data.index(b"end_header\n") + len(b"end_header\n"):]
    points = np.frombuffer(body, dtype=np.dtype([
        ("x", "<f8"), ("y", "<f8"), ("z", "<f8"),
        ("r", "u1"), ("g", "u1"), ("b", "u1"),
    ]))

    return np.column_stack([
        points["x"], points["y"], points["z"],
        points["r"] / 255.0, points["g"] / 255.0, points["b"] / 255.0,
    ])


def structure_cells(
    points: np.ndarray,
    elevation: np.ndarray,
    origin: tuple[float, float],
    cell: float,
    min_points: int = 3,
) -> np.ndarray:
    """
    Cells holding at least `min_points` scan points more than 0.5 m
    above the ground: walls, buildings, fences, hedges. Vehicles (warm
    label colours) don't count: they move.
    """

    i = np.floor((points[:, 0] - origin[0]) / cell).astype(int)
    j = np.floor((points[:, 1] - origin[1]) / cell).astype(int)
    ny, nx = elevation.shape
    inside = (i >= 0) & (j >= 0) & (i < nx) & (j < ny)

    points, i, j = points[inside], i[inside], j[inside]

    chromaticity = points[:, 3:6] / np.maximum(points[:, 3:6].sum(axis=1, keepdims=True), 1.0e-9)
    vehicle = (chromaticity[:, 0] > 0.40) & (chromaticity[:, 2] < 0.25)
    raised = points[:, 2] > elevation[j, i] + 0.5

    counts = np.zeros(elevation.shape, dtype=int)
    np.add.at(counts, (j[raised & ~vehicle], i[raised & ~vehicle]), 1)

    return counts >= min_points


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


def connected_to_border(mask: np.ndarray) -> np.ndarray:
    """Cells of `mask` reachable from the grid border through `mask` (4-neighbour)."""

    reached = np.zeros_like(mask)
    reached[0, :], reached[-1, :] = mask[0, :], mask[-1, :]
    reached[:, 0], reached[:, -1] = mask[:, 0], mask[:, -1]

    while True:
        padded = np.pad(reached, 1)
        grown = mask & (
            reached
            | padded[:-2, 1:-1] | padded[2:, 1:-1]
            | padded[1:-1, :-2] | padded[1:-1, 2:]
        )
        if np.array_equal(grown, reached):
            return reached
        reached = grown


def classify_surface(colours: np.ndarray) -> np.ndarray:
    """Nearest surface type by chromaticity for (..., 3) RGB colours."""

    names = [name for name, group in SURFACE_COLOURS.items() for _ in group]
    references = np.array([colour for group in SURFACE_COLOURS.values() for colour in group])
    references /= references.sum(axis=1, keepdims=True)

    chromaticity = colours / colours.sum(axis=-1, keepdims=True)
    distance = ((chromaticity[..., None, :] - references) ** 2).sum(axis=-1)

    return np.array(names)[distance.argmin(axis=-1)]


def build(cell: float = CELL) -> dict[str, np.ndarray]:
    """
    Terrain layers for the LiDAR street scan: elevation, obstacles
    (= roofs), surface types, roofs, outside (cells the scan never
    covered and saw no structure in, which the model treats as sinks:
    water flowing there leaves the street) and origin (x, y of the grid corner, metres,
    in the scan's coordinates).
    """

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

    roofs = np.isfinite(
        rasterize(buildings[:, :3], building_faces, origin, shape, cell)
    )

    # Unscanned areas enclosed by the street are occlusions (ground hidden
    # under parked cars, etc.), not the edge of the survey: they become
    # street, with heights and surface types from their surroundings.
    unscanned = connected_to_border(np.isnan(elevation) & ~roofs)

    # Unscanned cells get heights continuing the surrounding ground, so
    # water leaves the street only where the surface slopes that way.
    elevation = fill_gaps(elevation)

    # Where the scan saw a structure beyond the street edge, that edge is
    # a wall; where it saw nothing (the street running out of range),
    # water leaves the model.
    walls = unscanned & structure_cells(
        read_point_cloud(LIDAR / "registered-semantic-corridor.ply"),
        elevation,
        origin,
        cell,
    )
    outside = unscanned & ~walls
    colours = np.stack([fill_gaps(colours[..., channel]) for channel in range(3)], axis=-1)

    surface = np.full(shape, "", dtype="<U8")
    surface[~outside] = classify_surface(colours[~outside])

    return {
        "elevation": elevation,
        "obstacles": roofs | walls,
        "surface": surface,
        "roofs": roofs,
        "outside": outside,
        "origin": np.array(origin),
    }


def main() -> None:

    layers = build()
    elevation = layers.pop("elevation")

    save_terrain(OUTPUT, elevation, CELL, CELL, **layers)

    ny, nx = elevation.shape
    street = ~layers["obstacles"] & ~layers["outside"]

    print(f"Wrote {OUTPUT}")
    print(f"Grid:        {nx} × {ny} at {CELL} m")
    print(f"Street:      {street.sum()} cells ({street.mean():.0%})")
    print(f"Roofs:       {layers['roofs'].sum()} cells ({layers['roofs'].mean():.0%}), drained to the street")
    print(f"Walls:       {(layers['obstacles'] & ~layers['roofs']).sum()} cells (structures the scan saw beyond the street)")
    print(f"Outside:     {layers['outside'].sum()} cells ({layers['outside'].mean():.0%}), water leaves the model there")
    print(
        f"Relief:      {np.ptp(elevation[street]):.2f} m "
        f"({elevation[street].min():.2f} to {elevation[street].max():.2f})"
    )

    for name in SURFACE_COLOURS:
        print(f"{name.capitalize() + ':':13}{np.mean(layers['surface'][street] == name):.0%} of the street")


if __name__ == "__main__":
    main()
