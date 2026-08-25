#!/usr/bin/env python3
"""Create three web-ready terrain models from the IITH ground dataset."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import open3d as o3d

from reconstruct_lidar_models import point_cloud, preview, save_mesh_bundle, terrain_mesh


CAPTURES = [
    (0, "iith-low-slope", "MODEL 01 · IITH LOW SLOPE"),
    (5, "iith-medium-slope", "MODEL 02 · IITH MEDIUM SLOPE"),
    (10, "iith-high-slope", "MODEL 03 · IITH HIGH SLOPE"),
]


def read_labelled_pcd(path: Path) -> tuple[np.ndarray, np.ndarray]:
    data = np.loadtxt(path, comments="#", skiprows=11)
    points = data[:, :3].astype(np.float64)
    packed_rgb = data[:, 3].astype(np.uint32)
    red = (packed_rgb >> 16) & 255
    green = (packed_rgb >> 8) & 255
    ground = red > green
    return points, ground


def height_colors(points: np.ndarray) -> np.ndarray:
    height = points[:, 2]
    low, high = np.percentile(height, [2, 98])
    normalized = np.clip((height - low) / max(high - low, 1e-6), 0.0, 1.0)
    lower = np.asarray([0.16, 0.38, 0.34])
    upper = np.asarray([0.79, 0.95, 0.43])
    return lower + normalized[:, None] * (upper - lower)


def fitted_grade(points: np.ndarray) -> float:
    design = np.column_stack([points[:, 0], points[:, 1], np.ones(len(points))])
    a, b, _ = np.linalg.lstsq(design, points[:, 2], rcond=None)[0]
    return float(np.degrees(np.arctan(np.hypot(a, b))))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    arguments.output.mkdir(parents=True, exist_ok=True)

    model_stats = []
    for capture, stem, title in CAPTURES:
        filename = f"slope_{capture}_labelled.pcd"
        if capture == 3:
            filename += ".pcd"
        points, ground_mask = read_labelled_pcd(arguments.dataset / "labelled_data" / filename)
        points[:, :2] -= np.median(points[ground_mask, :2], axis=0)
        points[:, 2] -= np.median(points[ground_mask, 2])

        ground_points = points[ground_mask]
        colors = height_colors(ground_points)
        cloud = point_cloud(ground_points, colors).voxel_down_sample(0.11)
        cloud_points = np.asarray(cloud.points)
        cloud_colors = np.asarray(cloud.colors)
        mesh = terrain_mesh(cloud_points, cloud_colors, grid_size=0.20)
        grade = fitted_grade(ground_points)
        stats = save_mesh_bundle(mesh, cloud, arguments.output, stem)
        stats.update({
            "capture": f"slope_{capture}",
            "labelled_points": len(points),
            "ground_points": int(np.count_nonzero(ground_mask)),
            "non_ground_points": int(np.count_nonzero(~ground_mask)),
            "fitted_grade_degrees": round(grade, 2),
        })
        model_stats.append(stats)
        preview(cloud_points, cloud_colors, arguments.output / f"{stem}.png", f"{title} · {grade:.2f}° GRADE")

        context_colors = np.empty((len(points), 3), dtype=np.float64)
        context_colors[ground_mask] = np.asarray([0.23, 0.72, 0.55])
        context_colors[~ground_mask] = np.asarray([1.0, 0.48, 0.26])
        context = point_cloud(points, context_colors).voxel_down_sample(0.10)
        o3d.io.write_point_cloud(str(arguments.output / f"{stem}-labelled-context.ply"), context, write_ascii=False, compressed=True)

    manifest = {
        "source": "IITH_LiDAR_ground_dataset_labelled_raw.zip",
        "toolkit": f"Open3D {o3d.__version__}",
        "label_definition": {"ground": "red", "non_ground": "green"},
        "models": model_stats,
    }
    (arguments.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
