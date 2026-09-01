"""
Command-line runner for the MirrorCity flood simulation.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from .boundary import BoundaryConditions
from .infiltration import GreenAmptInfiltration
from .obstacles import rectangular_obstacle
from .rainfall import storm_rainfall
from .roughness import uniform_roughness
from .solver import FloodSolver
from .terrain import (
    create_test_terrain,
    load_terrain,
    save_terrain,
)


def parse_args() -> argparse.Namespace:

    parser = argparse.ArgumentParser(
        description=(
            "Run the MirrorCity 2-D flood model."
        )
    )

    parser.add_argument(
        "--terrain",
        type=str,
        default=None,
        help="Path to a .npz terrain file.",
    )

    parser.add_argument(
        "--duration",
        type=float,
        default=3600.0,
        help="Simulation duration in seconds.",
    )

    parser.add_argument(
        "--rainfall",
        type=float,
        default=100.0,
        help=(
            "Peak rainfall intensity "
            "in mm/hour."
        ),
    )

    parser.add_argument(
        "--manning",
        type=float,
        default=0.04,
        help="Default Manning roughness.",
    )

    parser.add_argument(
        "--infiltration-k",
        type=float,
        default=1.0e-5,
        help=(
            "Hydraulic conductivity "
            "in m/s."
        ),
    )

    parser.add_argument(
        "--open-south",
        action="store_true",
        help=(
            "Allow water to leave "
            "through the south boundary."
        ),
    )

    parser.add_argument(
        "--building",
        action="store_true",
        help=(
            "Add a demonstration "
            "rectangular building obstacle."
        ),
    )

    parser.add_argument(
        "--output",
        type=str,
        default="scripts/flood/output",
        help="Output directory.",
    )

    return parser.parse_args()


def main() -> None:

    args = parse_args()

    output_dir = Path(
        args.output
    )

    output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    # ============================================================
    # Terrain
    # ============================================================

    if args.terrain:

        elevation, dx, dy = (
            load_terrain(
                args.terrain
            )
        )

    else:

        elevation, dx, dy = (
            create_test_terrain()
        )

        terrain_path = (
            output_dir
            / "test_terrain.npz"
        )

        save_terrain(
            terrain_path,
            elevation,
            dx,
            dy,
        )

        print(
            f"Created test terrain: "
            f"{terrain_path}"
        )

    shape = elevation.shape

    # ============================================================
    # Rainfall
    # ============================================================

    rainfall = storm_rainfall(
        peak_mm_per_hour=args.rainfall,
        ramp_seconds=600.0,
        peak_seconds=min(
            1800.0,
            args.duration * 0.6,
        ),
        total_seconds=args.duration,
    )

    # ============================================================
    # Roughness
    # ============================================================

    manning_n = uniform_roughness(
        shape,
        args.manning,
    )

    # ============================================================
    # Infiltration
    # ============================================================

    infiltration = (
        GreenAmptInfiltration(
            shape=shape,
            hydraulic_conductivity=(
                args.infiltration_k
            ),
            suction_head=0.10,
            moisture_deficit=0.25,
        )
    )

    # ============================================================
    # Obstacles
    # ============================================================

    obstacle_mask = np.zeros(
        shape,
        dtype=bool,
    )

    if args.building:

        ny, nx = shape

        x0 = max(
            1,
            nx // 2 - 5,
        )

        x1 = min(
            nx - 1,
            nx // 2 + 5,
        )

        y0 = max(
            1,
            ny // 2 - 4,
        )

        y1 = min(
            ny - 1,
            ny // 2 + 4,
        )

        obstacle_mask = (
            rectangular_obstacle(
                shape,
                x0,
                x1,
                y0,
                y1,
            )
        )

    # ============================================================
    # Boundary conditions
    # ============================================================

    boundary = BoundaryConditions(
        west="closed",
        east="closed",
        north="closed",
        south=(
            "open"
            if args.open_south
            else "closed"
        ),
    )

    # ============================================================
    # Solver
    # ============================================================

    solver = FloodSolver(
        elevation=elevation,
        dx=dx,
        dy=dy,
        rainfall=rainfall,
        manning_n=manning_n,
        infiltration=infiltration,
        obstacle_mask=obstacle_mask,
        boundary=boundary,
    )

    print()
    print(
        "MirrorCity Flood Simulation"
    )
    print(
        "==========================="
    )

    print(
        f"Grid:              "
        f"{solver.nx} × {solver.ny}"
    )

    print(
        f"Cell size:         "
        f"{dx} m × {dy} m"
    )

    print(
        f"Duration:          "
        f"{args.duration} s"
    )

    print(
        f"Peak rainfall:    "
        f"{args.rainfall} mm/hour"
    )

    print(
        f"Manning n:         "
        f"{args.manning}"
    )

    print(
        f"Infiltration K:    "
        f"{args.infiltration_k:.2e} m/s"
    )

    print(
        f"South boundary:    "
        f"{boundary.south}"
    )

    print(
        f"Obstacle cells:    "
        f"{int(obstacle_mask.sum())}"
    )

    print()

    # ============================================================
    # Run
    # ============================================================

    states = solver.run(
        duration=args.duration,
        output_interval=60.0,
    )

    # ============================================================
    # Save final depth
    # ============================================================

    final_depth_path = (
        output_dir
        / "final_depth.npy"
    )

    np.save(
        final_depth_path,
        solver.depth,
    )

    # ============================================================
    # Save velocity
    # ============================================================

    velocity_x_path = (
        output_dir
        / "velocity_x.npy"
    )

    velocity_y_path = (
        output_dir
        / "velocity_y.npy"
    )

    np.save(
        velocity_x_path,
        solver.velocity_x,
    )

    np.save(
        velocity_y_path,
        solver.velocity_y,
    )

    # ============================================================
    # Save hazard index
    # ============================================================

    hazard_path = (
        output_dir
        / "hazard_index.npy"
    )

    np.save(
        hazard_path,
        solver.hazard_index(),
    )

    # ============================================================
    # Summary
    # ============================================================

    summary = {
        "model": (
            "MirrorCity 2-D diffusive "
            "flood routing prototype"
        ),
        "grid": {
            "nx": solver.nx,
            "ny": solver.ny,
            "dx_m": dx,
            "dy_m": dy,
        },
        "simulation": {
            "duration_s": args.duration,
            "peak_rainfall_mm_per_hour": (
                args.rainfall
            ),
            "manning_n": args.manning,
            "infiltration": True,
            "hydraulic_conductivity_m_per_s": (
                args.infiltration_k
            ),
            "south_boundary": boundary.south,
            "obstacle_cells": int(
                obstacle_mask.sum()
            ),
        },
        "results": {
            "max_depth_m": (
                solver.max_depth()
            ),
            "max_velocity_m_per_s": (
                solver.max_velocity()
            ),
            "water_volume_m3": (
                solver.total_water_volume()
            ),
            "output_snapshots": len(
                states
            ),
            "rainfall_depth_m": (
                solver.total_rainfall_depth
            ),
            "infiltration_depth_mean_m": (
                solver.total_infiltration_depth
            ),
            "boundary_outflow_m3": (
                solver.total_outflow_volume
            ),
        },
        "files": {
            "terrain": (
                "test_terrain.npz"
                if not args.terrain
                else args.terrain
            ),
            "final_depth": (
                "final_depth.npy"
            ),
            "velocity_x": (
                "velocity_x.npy"
            ),
            "velocity_y": (
                "velocity_y.npy"
            ),
            "hazard_index": (
                "hazard_index.npy"
            ),
        },
    }

    summary_path = (
        output_dir
        / "summary.json"
    )

    summary_path.write_text(
        json.dumps(
            summary,
            indent=2,
        ),
        encoding="utf-8",
    )

    # ============================================================
    # Console output
    # ============================================================

    print(
        "Simulation complete."
    )

    print(
        f"Maximum depth: "
        f"{solver.max_depth():.4f} m"
    )

    print(
        f"Maximum velocity: "
        f"{solver.max_velocity():.4f} m/s"
    )

    print(
        f"Water volume:   "
        f"{solver.total_water_volume():.4f} m³"
    )

    print(
        f"Boundary outflow:"
        f" {solver.total_outflow_volume:.4f} m³"
    )

    print()

    print(
        f"Results: "
        f"{output_dir}"
    )


if __name__ == "__main__":
    main()