"""
MirrorCity flood simulation package.

This package contains the numerical flood-routing model,
terrain utilities, rainfall forcing, infiltration,
roughness, obstacles, boundary conditions, and validation tools.
"""

from .boundary import BoundaryConditions
from .infiltration import GreenAmptInfiltration
from .obstacles import (
    combine_obstacles,
    empty_obstacle_mask,
    rectangular_obstacle,
)
from .rainfall import (
    constant_rainfall,
    storm_rainfall,
)
from .roughness import (
    land_use_roughness,
    uniform_roughness,
)
from .solver import (
    FloodSolver,
    FloodState,
)
from .terrain import (
    create_test_terrain,
    load_terrain,
    save_terrain,
)


__all__ = [
    "FloodSolver",
    "FloodState",

    "BoundaryConditions",
    "GreenAmptInfiltration",

    "constant_rainfall",
    "storm_rainfall",

    "uniform_roughness",
    "land_use_roughness",

    "empty_obstacle_mask",
    "rectangular_obstacle",
    "combine_obstacles",

    "create_test_terrain",
    "save_terrain",
    "load_terrain",
]