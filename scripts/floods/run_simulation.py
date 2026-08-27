"""
Command-line runner for the MirrorCity flood simulation.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from .rainfall import storm_rainfall
from .solver import FloodSolver
from .terrain import (
    create_test_terrain,
    load_terrain,
    save_terrain,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the MirrorCity 2-D flood model."
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
        help="Peak rainfall intensity in mm/hour.",
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

    output_dir = Path(args.output)
    output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    # ------------------------------------------------------------
    # Load or create terrain
    # ------------------------------------------------------------

    if args.terrain:
        elevation, dx, dy = load_terrain(
            args.terrain
        )
    else:
        elevation, dx, dy = create_test_terrain()

        terrain_path = (
            output_dir / "test_terrain.npz"
        )

        save_terrain(
            terrain_path,
            elevation,
            dx,
            dy,
        )

        print(
            f"Created test terrain: {terrain_path}"
        )

    # ------------------------------------------------------------
    # Rainfall
    # ------------------------------------------------------------

    rainfall = storm_rainfall(
        peak_mm_per_hour=args.rainfall,
        ramp_seconds=600.0,
        peak_seconds=min(
            1800.0,
            args.duration * 0.6,
        ),
        total_seconds=args.duration,
    )

    # ------------------------------------------------------------
    # Solver
    # ------------------------------------------------------------

    solver = FloodSolver(
        elevation=elevation,
        dx=dx,
        dy=dy,
        rainfall=rainfall,
        manning_n=0.04,
    )

    print()
    print("MirrorCity Flood Simulation")
    print("===========================")
    print(f"Grid:       {solver.nx} × {solver.ny}")
    print(f"Cell size:  {dx} m × {dy} m")
    print(f"Duration:   {args.duration} s")
    print(f"Rainfall:   {args.rainfall} mm/hour")
    print()

    states = solver.run(
        duration=args.duration,
        output_interval=60.0,
    )

    # ------------------------------------------------------------
    # Save final depth field
    # ------------------------------------------------------------

    final_depth_path = (
        output_dir / "final_depth.npy"
    )

    np.save(
        final_depth_path,
        solver.depth,
    )

    # ------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------

    summary = {
        "model": "MirrorCity 2-D diffusive flood routing",
        "grid": {
            "nx": solver.nx,
            "ny": solver.ny,
            "dx_m": dx,
            "dy_m": dy,
        },
        "simulation": {
            "duration_s": args.duration,
            "peak_rainfall_mm_per_hour": args.rainfall,
            "manning_n": solver.manning_n,
        },
        "results": {
            "max_depth_m": solver.max_depth(),
            "water_volume_m3": solver.total_water_volume(),
            "output_snapshots": len(states),
        },
        "files": {
            "terrain": (
                "test_terrain.npz"
                if not args.terrain
                else args.terrain
            ),
            "final_depth": "final_depth.npy",
        },
    }

    summary_path = (
        output_dir / "summary.json"
    )

    summary_path.write_text(
        json.dumps(
            summary,
            indent=2,
        ),
        encoding="utf-8",
    )

    print("Simulation complete.")
    print(
        f"Maximum depth: "
        f"{summary['results']['max_depth_m']:.4f} m"
    )
    print(
        f"Water volume:   "
        f"{summary['results']['water_volume_m3']:.4f} m³"
    )
    print()
    print(f"Results: {output_dir}")


if __name__ == "__main__":
    main()