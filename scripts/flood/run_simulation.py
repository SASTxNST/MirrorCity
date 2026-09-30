"""
Command-line runner for the MirrorCity flood simulation.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from . import drainage as drainage_module
from .boundary import BoundaryConditions
from .infiltration import IMPERVIOUS_SURFACES, GreenAmptInfiltration
from .obstacles import rectangular_obstacle
from .rainfall import storm_rainfall
from .roughness import land_use_roughness, uniform_roughness
from .solver import FloodSolver
from .terrain import (
    create_test_terrain,
    load_layer,
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
        "--drains",
        type=str,
        default=None,
        help=(
            "SWMM storm-drain network (.inp) to couple "
            "with the street; needs drainage.ENGINE."
        ),
    )

    parser.add_argument(
        "--drain-capacity",
        type=float,
        default=0.0,
        help=(
            "Storm-drain capacity in mm/hour over "
            "paved surfaces (all cells if the "
            "terrain has no surface types)."
        ),
    )

    parser.add_argument(
        "--open-edges",
        action="store_true",
        help=(
            "Allow water to leave "
            "through all four boundaries."
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

    # Surface types ("road", "grass", ...) saved with the terrain, if any.
    surface = (
        load_layer(args.terrain, "surface")
        if args.terrain
        else None
    )

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

    manning_n = (
        uniform_roughness(
            shape,
            args.manning,
        )
        if surface is None
        # --manning covers surfaces without a listed value.
        else land_use_roughness(
            surface,
            default=args.manning,
        )
    )

    # ============================================================
    # Infiltration
    # ============================================================

    infiltration = (
        GreenAmptInfiltration(
            shape=shape,
            hydraulic_conductivity=(
                args.infiltration_k
                if surface is None
                # Paved surfaces are impervious.
                else np.where(
                    np.isin(surface, IMPERVIOUS_SURFACES),
                    0.0,
                    args.infiltration_k,
                )
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

    if args.terrain:
        saved_obstacles = load_layer(
            args.terrain,
            "obstacles",
        )

        if saved_obstacles is not None:
            obstacle_mask = saved_obstacles.astype(bool)

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

        obstacle_mask = obstacle_mask | (
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

    boundary = BoundaryConditions.open_all() if args.open_edges else BoundaryConditions(
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

    coupling = None

    if args.drains:
        if drainage_module.ENGINE is None:
            raise SystemExit(
                "--drains needs a SWMM engine in "
                "scripts.flood.drainage.ENGINE "
                "(the browser worker provides one)."
            )

        coupling = drainage_module.DrainageCoupling(
            drainage_module.ENGINE,
            Path(args.drains).read_text(),
            dx,
            dy,
        )

    solver = FloodSolver(
        drainage=coupling,
        elevation=elevation,
        dx=dx,
        dy=dy,
        rainfall=rainfall,
        manning_n=manning_n,
        infiltration=infiltration,
        obstacle_mask=obstacle_mask,
        boundary=boundary,
        roof_mask=(
            load_layer(args.terrain, "roofs")
            if args.terrain
            else None
        ),
        # Cells outside the surveyed area: water flowing there leaves.
        sink_mask=(
            load_layer(args.terrain, "outside")
            if args.terrain
            else None
        ),
        drain_rate=(
            args.drain_capacity / 1000.0 / 3600.0
            * (
                1.0
                if surface is None
                else np.isin(surface, IMPERVIOUS_SURFACES)
            )
        ),
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

    try:
        states = solver.run(
            duration=args.duration,
            output_interval=60.0,
        )
    finally:
        if coupling is not None:
            coupling.close()

    # Water the drains took for good (captured minus what backed up).
    drained_by_network = (
        coupling.captured - coupling.returned
        if coupling is not None
        else 0.0
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

    street = (
        ~solver.obstacle_mask
        & ~solver.sink_mask
    )

    rain_on_street = max(
        solver.total_rainfall_depth
        * (
            street.sum()
            + solver.roof_cells.sum()
        ),
        1.0e-12,
    )

    origin = (
        load_layer(args.terrain, "origin")
        if args.terrain
        else None
    )

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
            "per_surface_parameters": surface is not None,
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
            # Share of the rain reaching the street (directly or
            # off roofs) that soaked in / went down the drains.
            "rain_soaked_in_fraction": (
                solver.total_infiltration_depth
                * obstacle_mask.size
                / rain_on_street
            ),
            "rain_drained_fraction": (
                (solver.total_drained_volume + drained_by_network)
                / (rain_on_street * dx * dy)
            ),
            "drained_m3": solver.total_drained_volume + drained_by_network,
            # Coupled storm drains (--drains), in m³.
            "drain_network": (
                None
                if coupling is None
                else {
                    "captured_m3": coupling.captured,
                    "returned_m3": coupling.returned,
                    "discharged_m3": coupling.discharged,
                    "inlets": len(coupling.names),
                    "inlets_backed_up": int(coupling.backed_up.sum()),
                }
            ),
            # Deepest water anywhere, at any time, and when.
            "peak_depth_m": float(solver.peak_depth.max()),
            "peak_time_s": solver.peak_time,
            # Share of street cells whose water ever exceeded 10 cm,
            # and whose depth-velocity hazard ever reached "high"
            # (solver.hazard_index >= 0.5).
            "flooded_street_fraction": float(
                (solver.peak_depth[street] > 0.10).mean()
            ),
            "high_hazard_street_fraction": float(
                (solver.peak_hazard[street] >= 0.5).mean()
            ),
            "boundary_outflow_m3": (
                solver.total_outflow_volume
            ),
        },
        "timeline": {
            "time_s": [state.time for state in states],
            "water_volume_m3": [
                round(float(state.depth.sum() * dx * dy), 3)
                for state in states
            ],
            "max_depth_m": [
                round(float(state.depth.max()), 4)
                for state in states
            ],
        },
        # Per-cell grids, row j = y. Kept small: the grids here are
        # a few thousand cells.
        "maps": {
            "origin_m": (
                None
                if origin is None
                else [float(value) for value in origin]
            ),
            "cell_m": dx,
            "peak_depth_m": np.round(solver.peak_depth, 3).tolist(),
            "peak_hazard": np.round(solver.peak_hazard, 3).tolist(),
            "elevation_m": np.round(elevation, 3).tolist(),
            # 0 street, 1 building, 2 outside the survey.
            "inlets": (
                []
                if coupling is None
                # Row, column and whether that inlet ever backed up (1).
                else [[int(j), int(i), int(backed)] for j, i, backed in zip(coupling.rows, coupling.cols, coupling.backed_up)]
            ),
            "cell_kind": (
                solver.obstacle_mask.astype(int)
                + 2 * solver.sink_mask
            ).tolist(),
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