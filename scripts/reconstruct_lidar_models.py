#!/usr/bin/env python3
"""Build three MirrorCity-ready 3D models from a SemanticKITTI sequence.

The pipeline follows the supplied Open3D examples: NumPy point ingestion,
pose-based registration, voxel downsampling, semantic filtering, DBSCAN object
clustering, and mesh export. It creates terrain, building-mass, and street-asset
models as OBJ, PLY, and GLB files plus a colored point-cloud source for each.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import open3d as o3d
from scipy.spatial import Delaunay
import trimesh


SEMANTIC_COLORS = {
    0: (0.22, 0.24, 0.23),
    10: (1.00, 0.73, 0.18),
    11: (0.98, 0.55, 0.20),
    15: (0.96, 0.44, 0.18),
    18: (0.94, 0.37, 0.22),
    20: (0.83, 0.42, 0.25),
    30: (0.95, 0.33, 0.40),
    31: (0.95, 0.40, 0.52),
    32: (0.95, 0.48, 0.38),
    40: (0.28, 0.34, 0.34),
    44: (0.40, 0.44, 0.42),
    48: (0.61, 0.57, 0.48),
    49: (0.47, 0.45, 0.40),
    50: (0.82, 0.85, 0.82),
    51: (0.58, 0.62, 0.59),
    52: (0.52, 0.55, 0.52),
    60: (0.96, 0.86, 0.44),
    70: (0.26, 0.48, 0.33),
    71: (0.42, 0.31, 0.19),
    72: (0.39, 0.48, 0.38),
    80: (0.31, 0.82, 0.77),
    81: (0.48, 0.70, 0.95),
    99: (0.44, 0.47, 0.45),
    252: (1.00, 0.65, 0.10),
    253: (0.98, 0.50, 0.18),
    254: (0.96, 0.28, 0.40),
    255: (0.96, 0.36, 0.47),
    256: (0.84, 0.38, 0.22),
    257: (0.89, 0.39, 0.16),
    258: (0.91, 0.32, 0.16),
    259: (0.79, 0.35, 0.22),
}

GROUND_LABELS = {40, 44, 48, 49, 60, 72}
BUILDING_LABELS = {50, 51, 52}
VEHICLE_LABELS = {10, 11, 15, 18, 20, 252, 253, 256, 257, 258, 259}
VERTICAL_ASSET_LABELS = {70, 71, 80, 81}


def read_calibration(path: Path) -> np.ndarray:
    for line in path.read_text().splitlines():
        if line.startswith("Tr:"):
            matrix = np.asarray([float(value) for value in line.split()[1:]], dtype=np.float64).reshape(3, 4)
            return np.vstack([matrix, [0.0, 0.0, 0.0, 1.0]])
    raise ValueError(f"No Tr calibration found in {path}")


def read_poses(path: Path) -> list[np.ndarray]:
    values = np.loadtxt(path, dtype=np.float64)
    poses = []
    for row in values:
        poses.append(np.vstack([row.reshape(3, 4), [0.0, 0.0, 0.0, 1.0]]))
    return poses


def register_sequence(sequence: Path, frame_count: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    transform = read_calibration(sequence / "calib.txt")
    inverse_transform = np.linalg.inv(transform)
    poses = read_poses(sequence / "poses.txt")
    all_points: list[np.ndarray] = []
    all_labels: list[np.ndarray] = []
    all_intensity: list[np.ndarray] = []

    for frame in range(frame_count):
        stem = f"{frame:06d}"
        scan = np.fromfile(sequence / "velodyne" / f"{stem}.bin", dtype=np.float32).reshape(-1, 4)
        labels = np.fromfile(sequence / "labels" / f"{stem}.label", dtype=np.uint32) & 0xFFFF
        if len(scan) != len(labels):
            raise ValueError(f"Point/label mismatch in frame {stem}")
        velodyne_pose = inverse_transform @ poses[frame] @ transform
        homogeneous = np.column_stack([scan[:, :3], np.ones(len(scan), dtype=np.float32)])
        registered = (homogeneous @ velodyne_pose.T)[:, :3]
        radial = np.linalg.norm(scan[:, :2], axis=1)
        keep = (radial < 68.0) & (registered[:, 2] > -8.0) & (registered[:, 2] < 12.0)
        all_points.append(registered[keep])
        all_labels.append(labels[keep])
        all_intensity.append(scan[keep, 3])

    points = np.concatenate(all_points)
    labels = np.concatenate(all_labels)
    intensity = np.concatenate(all_intensity)
    points[:, :2] -= np.median(points[:, :2], axis=0)
    return points, labels, intensity


def colors_for_labels(labels: np.ndarray, intensity: np.ndarray | None = None) -> np.ndarray:
    colors = np.asarray([SEMANTIC_COLORS.get(int(label), (0.50, 0.52, 0.50)) for label in labels], dtype=np.float64)
    if intensity is not None:
        brightness = 0.78 + np.clip(intensity, 0.0, 1.0)[:, None] * 0.22
        colors = np.clip(colors * brightness, 0.0, 1.0)
    return colors


def point_cloud(points: np.ndarray, colors: np.ndarray) -> o3d.geometry.PointCloud:
    cloud = o3d.geometry.PointCloud()
    cloud.points = o3d.utility.Vector3dVector(points)
    cloud.colors = o3d.utility.Vector3dVector(colors)
    return cloud


def paint_mesh(mesh: o3d.geometry.TriangleMesh, color: tuple[float, float, float]) -> o3d.geometry.TriangleMesh:
    mesh.paint_uniform_color(color)
    mesh.compute_vertex_normals()
    return mesh


def terrain_mesh(points: np.ndarray, colors: np.ndarray, grid_size: float = 0.42) -> o3d.geometry.TriangleMesh:
    cells = np.floor(points[:, :2] / grid_size).astype(np.int64)
    _, inverse = np.unique(cells, axis=0, return_inverse=True)
    count = np.bincount(inverse)
    reduced = np.column_stack([np.bincount(inverse, weights=points[:, axis]) / count for axis in range(3)])
    reduced_colors = np.column_stack([np.bincount(inverse, weights=colors[:, axis]) / count for axis in range(3)])
    triangulation = Delaunay(reduced[:, :2], qhull_options="QJ")
    triangles = triangulation.simplices
    triangle_points = reduced[triangles]
    edges = np.stack([
        np.linalg.norm(triangle_points[:, 0] - triangle_points[:, 1], axis=1),
        np.linalg.norm(triangle_points[:, 1] - triangle_points[:, 2], axis=1),
        np.linalg.norm(triangle_points[:, 2] - triangle_points[:, 0], axis=1),
    ], axis=1)
    elevation_span = np.ptp(triangle_points[:, :, 2], axis=1)
    triangles = triangles[(edges.max(axis=1) < 2.3) & (elevation_span < 1.1)]
    mesh = o3d.geometry.TriangleMesh(
        o3d.utility.Vector3dVector(reduced),
        o3d.utility.Vector3iVector(triangles.astype(np.int32)),
    )
    mesh.vertex_colors = o3d.utility.Vector3dVector(reduced_colors)
    mesh.compute_vertex_normals()
    return mesh


def clustered_boxes(points: np.ndarray, color: tuple[float, float, float], voxel: float, eps: float, minimum: int, limit: int) -> tuple[o3d.geometry.TriangleMesh, int]:
    cloud = point_cloud(points, np.tile(color, (len(points), 1))).voxel_down_sample(voxel)
    labels = np.asarray(cloud.cluster_dbscan(eps=eps, min_points=minimum, print_progress=False))
    clusters = [(cluster, int(np.count_nonzero(labels == cluster))) for cluster in np.unique(labels) if cluster >= 0]
    clusters.sort(key=lambda item: item[1], reverse=True)
    combined = o3d.geometry.TriangleMesh()
    used = 0
    cloud_points = np.asarray(cloud.points)
    for cluster, size in clusters[:limit]:
        subset = cloud_points[labels == cluster]
        if size < minimum or len(subset) < 4:
            continue
        box = o3d.geometry.OrientedBoundingBox.create_from_points(o3d.utility.Vector3dVector(subset), robust=True)
        extent = np.maximum(box.extent, np.asarray([0.45, 0.45, 0.45]))
        if extent.max() > 80 or extent[2] < 0.5:
            continue
        mesh = o3d.geometry.TriangleMesh.create_box(*extent)
        mesh.translate(-extent / 2.0)
        mesh.rotate(box.R, center=(0.0, 0.0, 0.0))
        mesh.translate(box.center)
        combined += paint_mesh(mesh, color)
        used += 1
    combined.compute_vertex_normals()
    return combined, used


def vertical_assets(points: np.ndarray, labels: np.ndarray) -> tuple[o3d.geometry.TriangleMesh, int]:
    combined = o3d.geometry.TriangleMesh()
    total = 0
    for semantic, color, radius, limit in [
        (71, (0.39, 0.29, 0.18), 0.24, 30),
        (80, (0.31, 0.82, 0.77), 0.12, 35),
        (81, (0.48, 0.70, 0.95), 0.16, 20),
    ]:
        semantic_points = points[labels == semantic]
        if len(semantic_points) < 10:
            continue
        cloud = point_cloud(semantic_points, np.tile(color, (len(semantic_points), 1))).voxel_down_sample(0.16)
        cluster_labels = np.asarray(cloud.cluster_dbscan(eps=0.65, min_points=6, print_progress=False))
        cloud_points = np.asarray(cloud.points)
        clusters = [(cluster, np.count_nonzero(cluster_labels == cluster)) for cluster in np.unique(cluster_labels) if cluster >= 0]
        clusters.sort(key=lambda item: item[1], reverse=True)
        for cluster, _ in clusters[:limit]:
            subset = cloud_points[cluster_labels == cluster]
            minimum = subset.min(axis=0)
            maximum = subset.max(axis=0)
            height = max(0.45, float(maximum[2] - minimum[2]))
            center = (minimum + maximum) / 2.0
            mesh = o3d.geometry.TriangleMesh.create_cylinder(radius=radius, height=height, resolution=10)
            mesh.translate([center[0], center[1], center[2]])
            combined += paint_mesh(mesh, color)
            total += 1
    combined.compute_vertex_normals()
    return combined, total


def save_mesh_bundle(mesh: o3d.geometry.TriangleMesh, cloud: o3d.geometry.PointCloud, output: Path, stem: str) -> dict[str, int | str]:
    mesh.remove_duplicated_vertices()
    mesh.remove_duplicated_triangles()
    mesh.remove_degenerate_triangles()
    mesh.compute_vertex_normals()
    o3d.io.write_triangle_mesh(str(output / f"{stem}.obj"), mesh, write_vertex_colors=True)
    o3d.io.write_triangle_mesh(str(output / f"{stem}.ply"), mesh, write_ascii=False, write_vertex_colors=True)
    vertices = np.asarray(mesh.vertices)
    faces = np.asarray(mesh.triangles)
    vertex_colors = np.asarray(mesh.vertex_colors)
    if len(vertex_colors) == len(vertices):
        alpha = np.ones((len(vertex_colors), 1), dtype=np.float64)
        vertex_colors = np.asarray(np.clip(np.column_stack([vertex_colors, alpha]) * 255, 0, 255), dtype=np.uint8)
    else:
        vertex_colors = None
    web_mesh = trimesh.Trimesh(vertices=vertices, faces=faces, vertex_colors=vertex_colors, process=False)
    (output / f"{stem}.glb").write_bytes(trimesh.exchange.gltf.export_glb(web_mesh))
    glb_ok = True
    o3d.io.write_point_cloud(str(output / f"{stem}-source.ply"), cloud, write_ascii=False, compressed=True)
    return {
        "name": stem,
        "vertices": len(mesh.vertices),
        "triangles": len(mesh.triangles),
        "source_points": len(cloud.points),
        "glb": "available" if glb_ok else "unavailable",
    }


def preview(points: np.ndarray, colors: np.ndarray, output: Path, title: str) -> None:
    rng = np.random.default_rng(7)
    if len(points) > 32000:
        selected = rng.choice(len(points), 32000, replace=False)
        points, colors = points[selected], colors[selected]
    figure = plt.figure(figsize=(8.4, 5.2), dpi=140, facecolor="#111715")
    axis = figure.add_subplot(111, projection="3d", facecolor="#111715")
    axis.scatter(points[:, 0], points[:, 1], points[:, 2], c=colors, s=0.28, linewidths=0, depthshade=False)
    axis.view_init(elev=32, azim=-58)
    figure.text(0.02, 0.96, title, color="#e8ece8", fontsize=12, ha="left", va="top")
    axis.set_axis_off()
    axis.set_box_aspect((1.65, 1.0, 0.35))
    figure.tight_layout(pad=0)
    figure.savefig(output, facecolor=figure.get_facecolor(), bbox_inches="tight", pad_inches=0.08)
    plt.close(figure)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sequence", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frames", type=int, default=10)
    arguments = parser.parse_args()
    arguments.output.mkdir(parents=True, exist_ok=True)

    points, labels, intensity = register_sequence(arguments.sequence, arguments.frames)
    colors = colors_for_labels(labels, intensity)
    complete = point_cloud(points, colors).voxel_down_sample(0.18)
    o3d.io.write_point_cloud(str(arguments.output / "registered-semantic-corridor.ply"), complete, write_ascii=False, compressed=True)

    ground_mask = np.isin(labels, list(GROUND_LABELS))
    ground_points, ground_colors = points[ground_mask], colors[ground_mask]
    ground_cloud = point_cloud(ground_points, ground_colors).voxel_down_sample(0.22)
    ground_mesh = terrain_mesh(np.asarray(ground_cloud.points), np.asarray(ground_cloud.colors))
    ground_stats = save_mesh_bundle(ground_mesh, ground_cloud, arguments.output, "road-terrain")
    preview(np.asarray(ground_cloud.points), np.asarray(ground_cloud.colors), arguments.output / "road-terrain.png", "MODEL 01 · ROAD & TERRAIN")

    building_mask = np.isin(labels, list(BUILDING_LABELS))
    building_points = points[building_mask]
    building_colors = colors[building_mask]
    building_cloud = point_cloud(building_points, building_colors).voxel_down_sample(0.24)
    building_mesh, building_count = clustered_boxes(building_points, (0.73, 0.79, 0.75), 0.38, 1.65, 22, 36)
    building_stats = save_mesh_bundle(building_mesh, building_cloud, arguments.output, "building-masses")
    building_stats["objects"] = building_count
    preview(np.asarray(building_cloud.points), np.asarray(building_cloud.colors), arguments.output / "building-masses.png", "MODEL 02 · BUILDING MASSES")

    vehicle_mask = np.isin(labels, list(VEHICLE_LABELS))
    vertical_mask = np.isin(labels, list(VERTICAL_ASSET_LABELS))
    asset_mask = vehicle_mask | vertical_mask
    asset_points, asset_labels = points[asset_mask], labels[asset_mask]
    asset_colors = colors[asset_mask]
    asset_cloud = point_cloud(asset_points, asset_colors).voxel_down_sample(0.15)
    vehicle_mesh, vehicle_count = clustered_boxes(points[vehicle_mask], (0.96, 0.64, 0.12), 0.16, 0.92, 10, 45)
    vertical_mesh, vertical_count = vertical_assets(asset_points, asset_labels)
    street_mesh = vehicle_mesh + vertical_mesh
    street_stats = save_mesh_bundle(street_mesh, asset_cloud, arguments.output, "street-assets")
    street_stats["objects"] = vehicle_count + vertical_count
    preview(np.asarray(asset_cloud.points), np.asarray(asset_cloud.colors), arguments.output / "street-assets.png", "MODEL 03 · STREET ASSETS")

    manifest = {
        "source": "SemanticKITTI-compatible project-example.zip",
        "toolkit": f"Open3D {o3d.__version__}",
        "frames": arguments.frames,
        "registered_points": len(points),
        "models": [ground_stats, building_stats, street_stats],
    }
    (arguments.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
