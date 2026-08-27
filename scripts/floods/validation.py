"""
Validation tests for the MirrorCity flood solver.

These tests verify basic numerical behavior:

1. Rainfall adds the correct amount of water.
2. Water remains non-negative.
3. Water moves toward lower terrain.
4. A depression accumulates water.
"""

from __future__ import annotations

import numpy as np

from .rainfall import constant_rainfall
from .solver import FloodSolver


def test_rainfall_volume() -> None:
    """
    Flat terrain + uniform rainfall.

    Expected volume:

        V = rainfall_rate * time * area
    """

    nx = 20
    ny = 20
    dx = 2.0
    dy = 2.0

    elevation = np.zeros((ny, nx))

    rainfall = constant_rainfall(36.0)

    solver = FloodSolver(
        elevation=elevation,
        dx=dx,
        dy=dy,
        rainfall=rainfall,
    )

    duration = 600.0

    solver.run(
        duration=duration,
        output_interval=duration,
    )

    expected_rate = 36.0 / 1000.0 / 3600.0

    area = nx * ny * dx * dy

    expected_volume = (
        expected_rate
        * duration
        * area
    )

    actual_volume = solver.total_water_volume()

    relative_error = abs(
        actual_volume - expected_volume
    ) / expected_volume

    print("Rainfall volume test")
    print("--------------------")
    print(f"Expected: {expected_volume:.6f} m³")
    print(f"Actual:   {actual_volume:.6f} m³")
    print(f"Error:    {relative_error:.6%}")

    assert relative_error < 1e-10


def test_non_negative_water() -> None:
    """Water depth must never become negative."""

    elevation = np.zeros((30, 30))

    rainfall = constant_rainfall(100.0)

    solver = FloodSolver(
        elevation=elevation,
        dx=1.0,
        dy=1.0,
        rainfall=rainfall,
    )

    states = solver.run(
        duration=300.0,
        output_interval=30.0,
    )

    for state in states:
        assert np.min(state.depth) >= 0.0


def test_water_moves_downhill() -> None:
    """
    Create a simple slope.

    Water should preferentially move toward the lower side.
    """

    nx = 40
    ny = 10

    dx = 1.0
    dy = 1.0

    x = np.arange(nx) * dx

    elevation = np.tile(
        -0.1 * x,
        (ny, 1),
    )

    rainfall = constant_rainfall(100.0)

    solver = FloodSolver(
        elevation=elevation,
        dx=dx,
        dy=dy,
        rainfall=rainfall,
    )

    solver.run(
        duration=300.0,
        output_interval=300.0,
    )

    left_depth = float(
        solver.depth[:, :5].mean()
    )

    right_depth = float(
        solver.depth[:, -5:].mean()
    )

    print("Downhill-flow test")
    print("------------------")
    print(f"High side depth: {left_depth:.6f} m")
    print(f"Low side depth:  {right_depth:.6f} m")

    assert right_depth > left_depth


def test_depression_accumulates() -> None:
    """
    Create a bowl-shaped depression and verify that water
    accumulates near its center.
    """

    nx = 50
    ny = 50

    x = np.linspace(-10.0, 10.0, nx)
    y = np.linspace(-10.0, 10.0, ny)

    xx, yy = np.meshgrid(x, y)

    elevation = (
        0.02 * (xx**2 + yy**2)
    )

    rainfall = constant_rainfall(100.0)

    solver = FloodSolver(
        elevation=elevation,
        dx=x[1] - x[0],
        dy=y[1] - y[0],
        rainfall=rainfall,
    )

    solver.run(
        duration=600.0,
        output_interval=600.0,
    )

    center_depth = float(
        solver.depth[ny // 2, nx // 2]
    )

    edge_depth = float(
        np.mean(
            np.concatenate(
                [
                    solver.depth[0, :],
                    solver.depth[-1, :],
                    solver.depth[:, 0],
                    solver.depth[:, -1],
                ]
            )
        )
    )

    print("Depression test")
    print("----------------")
    print(f"Center depth: {center_depth:.6f} m")
    print(f"Edge depth:   {edge_depth:.6f} m")

    assert center_depth > edge_depth


def run_all_tests() -> None:
    """Run all validation tests."""

    test_rainfall_volume()
    test_non_negative_water()
    test_water_moves_downhill()
    test_depression_accumulates()

    print()
    print("All flood-model validation tests passed.")


if __name__ == "__main__":
    run_all_tests()