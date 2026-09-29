
"""
Validation tests for the MirrorCity flood solver.

These tests verify:

1. Rainfall conservation.
2. Water remains non-negative.
3. Water moves downhill.
4. Depressions accumulate water.
5. Infiltration removes water.
6. Obstacles block transport.
7. Closed boundaries conserve water.
8. Water spreads into dry cells.
9. Draining cells do not create water.
10. Open boundaries drain, and outflow is accounted for.
11. LiDAR rasterization reproduces a plane; the committed grid is current.
"""

from __future__ import annotations

import numpy as np

from .boundary import BoundaryConditions
from .infiltration import GreenAmptInfiltration
from .lidar_terrain import OUTPUT, build, rasterize
from .obstacles import rectangular_obstacle
from .rainfall import constant_rainfall
from .solver import FloodSolver


def test_rainfall_volume() -> None:
    """Flat terrain + uniform rainfall."""

    nx = 20
    ny = 20

    dx = 2.0
    dy = 2.0

    elevation = np.zeros(
        (ny, nx)
    )

    rainfall = constant_rainfall(
        36.0
    )

    solver = FloodSolver(
        elevation=elevation,
        dx=dx,
        dy=dy,
        rainfall=rainfall,
        infiltration=None,
    )

    duration = 600.0

    solver.run(
        duration=duration,
        output_interval=duration,
    )

    expected_rate = (
        36.0
        / 1000.0
        / 3600.0
    )

    area = (
        nx
        * ny
        * dx
        * dy
    )

    expected_volume = (
        expected_rate
        * duration
        * area
    )

    actual_volume = (
        solver.total_water_volume()
    )

    relative_error = abs(
        actual_volume
        - expected_volume
    ) / expected_volume

    print(
        "Rainfall volume test"
    )
    print(
        "--------------------"
    )
    print(
        f"Expected: "
        f"{expected_volume:.6f} m³"
    )
    print(
        f"Actual:   "
        f"{actual_volume:.6f} m³"
    )
    print(
        f"Error:    "
        f"{relative_error:.6%}"
    )

    assert relative_error < 1e-10


def test_non_negative_water() -> None:
    """Water depth must never become negative."""

    elevation = np.zeros(
        (30, 30)
    )

    rainfall = constant_rainfall(
        100.0
    )

    solver = FloodSolver(
        elevation=elevation,
        dx=1.0,
        dy=1.0,
        rainfall=rainfall,
        infiltration=None,
    )

    states = solver.run(
        duration=300.0,
        output_interval=30.0,
    )

    for state in states:

        assert (
            np.min(state.depth)
            >= 0.0
        )


def test_water_moves_downhill() -> None:
    """Water should preferentially move downhill."""

    nx = 40
    ny = 10

    dx = 1.0
    dy = 1.0

    x = (
        np.arange(nx)
        * dx
    )

    elevation = np.tile(
        -0.1 * x,
        (ny, 1),
    )

    rainfall = constant_rainfall(
        100.0
    )

    solver = FloodSolver(
        elevation=elevation,
        dx=dx,
        dy=dy,
        rainfall=rainfall,
        infiltration=None,
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

    print(
        "Downhill-flow test"
    )
    print(
        "------------------"
    )

    print(
        f"High side depth: "
        f"{left_depth:.6f} m"
    )

    print(
        f"Low side depth:  "
        f"{right_depth:.6f} m"
    )

    assert (
        right_depth
        > left_depth
    )


def test_depression_accumulates() -> None:
    """Water should accumulate in a bowl."""

    nx = 50
    ny = 50

    x = np.linspace(
        -10.0,
        10.0,
        nx,
    )

    y = np.linspace(
        -10.0,
        10.0,
        ny,
    )

    xx, yy = np.meshgrid(
        x,
        y,
    )

    elevation = (
        0.02
        * (
            xx**2
            + yy**2
        )
    )

    rainfall = constant_rainfall(
        100.0
    )

    solver = FloodSolver(
        elevation=elevation,
        dx=x[1] - x[0],
        dy=y[1] - y[0],
        rainfall=rainfall,
        infiltration=None,
    )

    solver.run(
        duration=600.0,
        output_interval=600.0,
    )

    center_depth = float(
        solver.depth[
            ny // 2,
            nx // 2,
        ]
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

    print(
        "Depression test"
    )
    print(
        "----------------"
    )

    print(
        f"Center depth: "
        f"{center_depth:.6f} m"
    )

    print(
        f"Edge depth:   "
        f"{edge_depth:.6f} m"
    )

    assert (
        center_depth
        > edge_depth
    )


def test_infiltration_reduces_water() -> None:
    """Infiltration should reduce surface water."""

    elevation = np.zeros(
        (20, 20)
    )

    rainfall = constant_rainfall(
        36.0
    )

    solver = FloodSolver(
        elevation=elevation,
        dx=1.0,
        dy=1.0,
        rainfall=rainfall,
        infiltration=(
            GreenAmptInfiltration(
                shape=elevation.shape,
                hydraulic_conductivity=1e-5,
            )
        ),
    )

    solver.run(
        duration=600.0,
        output_interval=600.0,
    )

    no_infiltration_depth = (
        36.0
        / 1000.0
        / 3600.0
        * 600.0
    )

    actual_depth = float(
        solver.depth.mean()
    )

    print(
        "Infiltration test"
    )
    print(
        "-----------------"
    )

    print(
        f"No infiltration: "
        f"{no_infiltration_depth:.6f} m"
    )

    print(
        f"Actual depth:    "
        f"{actual_depth:.6f} m"
    )

    assert (
        actual_depth
        < no_infiltration_depth
    )


def test_obstacle_blocks_water() -> None:
    """A blocked region should remain dry."""

    elevation = np.zeros(
        (30, 30)
    )

    rainfall = constant_rainfall(
        100.0
    )

    obstacle = rectangular_obstacle(
        shape=elevation.shape,
        x0=12,
        x1=18,
        y0=12,
        y1=18,
    )

    solver = FloodSolver(
        elevation=elevation,
        dx=1.0,
        dy=1.0,
        rainfall=rainfall,
        obstacle_mask=obstacle,
        infiltration=None,
    )

    solver.run(
        duration=300.0,
        output_interval=300.0,
    )

    assert np.all(
        solver.depth[obstacle]
        == 0.0
    )


def test_closed_boundary_conserves_water() -> None:
    """Closed boundaries should not lose water."""

    elevation = np.zeros(
        (20, 20)
    )

    rainfall = constant_rainfall(
        20.0
    )

    solver = FloodSolver(
        elevation=elevation,
        dx=1.0,
        dy=1.0,
        rainfall=rainfall,
        infiltration=None,
        boundary=BoundaryConditions.closed(),
    )

    solver.run(
        duration=300.0,
        output_interval=300.0,
    )

    expected = (
        20.0
        / 1000.0
        / 3600.0
        * 300.0
        * 20
        * 20
    )

    actual = (
        solver.total_water_volume()
    )

    relative_error = abs(
        actual - expected
    ) / expected

    print(
        "Closed-boundary conservation test"
    )

    print(
        f"Expected: "
        f"{expected:.6f} m³"
    )

    print(
        f"Actual:   "
        f"{actual:.6f} m³"
    )

    assert (
        relative_error
        < 1e-8
    )


def test_water_enters_dry_cells() -> None:
    """A wet area on flat ground should spread into dry cells."""

    solver = FloodSolver(
        elevation=np.zeros((10, 40)),
        dx=1.0,
        dy=1.0,
        rainfall=constant_rainfall(0.0),
        infiltration=None,
    )

    solver.depth[:, :10] = 0.5

    solver.run(
        duration=60.0,
        output_interval=60.0,
    )

    far_depth = float(
        solver.depth[:, -5:].mean()
    )

    print("Dry-cell spreading test")
    print("-----------------------")
    print(f"Far side depth: {far_depth:.6f} m")

    assert far_depth > 0.0


def test_draining_conserves_water() -> None:
    """Cells draining into a bowl must not gain water when clipped."""

    x = np.linspace(-10.0, 10.0, 50)
    xx, yy = np.meshgrid(x, x)

    solver = FloodSolver(
        elevation=0.02 * (xx**2 + yy**2),
        dx=x[1] - x[0],
        dy=x[1] - x[0],
        rainfall=constant_rainfall(100.0),
        infiltration=None,
    )

    solver.run(
        duration=600.0,
        output_interval=600.0,
    )

    expected = (
        100.0 / 1000.0 / 3600.0 * 600.0
        * solver.dx * solver.dy * solver.depth.size
    )

    actual = solver.total_water_volume()

    relative_error = abs(actual - expected) / expected

    print("Draining conservation test")
    print("--------------------------")
    print(f"Expected: {expected:.6f} m³")
    print(f"Actual:   {actual:.6f} m³")

    assert relative_error < 1e-8


def test_open_boundary_drains() -> None:
    """Rain on a slope should leave through the open edge it runs to."""

    slope = np.tile(0.05 * np.arange(20.0), (20, 1))

    # Ground falls towards the named side.
    sides = {
        "west": slope,
        "east": slope[:, ::-1],
        "north": slope.T,
        "south": slope.T[::-1, :],
    }

    print("Open-boundary test")
    print("------------------")

    for side, elevation in sides.items():

        solver = FloodSolver(
            elevation=elevation,
            dx=1.0,
            dy=1.0,
            rainfall=constant_rainfall(100.0),
            infiltration=None,
            boundary=BoundaryConditions(**{side: "open"}),
        )

        solver.run(
            duration=600.0,
            output_interval=600.0,
        )

        rain = 100.0 / 1000.0 / 3600.0 * 600.0 * 20 * 20

        stored = solver.total_water_volume()
        outflow = solver.total_outflow_volume

        print(
            f"{side:5}: rain {rain:.4f} m³ = "
            f"stored {stored:.4f} + outflow {outflow:.4f}"
        )

        assert outflow > 0.1 * rain
        assert abs(stored + outflow - rain) / rain < 1e-8


def test_lidar_terrain() -> None:
    """Rasterizing a tilted plane is exact; lidar-street.npz is up to date."""

    corners = np.array([
        [0.0, 0.0, 0.0],
        [4.0, 0.0, 0.4],
        [4.0, 3.0, 1.0],
        [0.0, 3.0, 0.6],
    ])  # z = 0.1 x + 0.2 y

    heights = rasterize(
        corners,
        np.array([[0, 1, 2], [0, 2, 3]]),
        origin=(0.0, 0.0),
        shape=(3, 4),
        cell=1.0,
    )

    x, y = np.meshgrid(np.arange(4) + 0.5, np.arange(3) + 0.5)

    elevation, obstacles = build()

    with np.load(OUTPUT) as saved:
        current = (
            np.allclose(saved["elevation"], elevation, atol=1.0e-9)
            and np.array_equal(saved["obstacles"], obstacles)
        )

    print("LiDAR terrain test")
    print("------------------")
    print(f"Plane error: {np.max(np.abs(heights - (0.1 * x + 0.2 * y))):.2e} m")
    print(f"Committed grid current: {current}")

    assert np.allclose(heights, 0.1 * x + 0.2 * y)
    assert current, "Re-run: python3 -m scripts.flood.lidar_terrain"


def run_all_tests() -> None:
    """Run every flood-model validation test."""

    test_rainfall_volume()
    test_non_negative_water()
    test_water_moves_downhill()
    test_depression_accumulates()
    test_infiltration_reduces_water()
    test_obstacle_blocks_water()
    test_closed_boundary_conserves_water()
    test_water_enters_dry_cells()
    test_draining_conserves_water()
    test_open_boundary_drains()
    test_lidar_terrain()

    print()
    print(
        "All flood-model validation tests passed."
    )


if __name__ == "__main__":
    run_all_tests()