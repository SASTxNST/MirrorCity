"""
MirrorCity flood simulation package.

This package contains the numerical flood-routing model,
terrain utilities, rainfall forcing, and validation tools.
"""

from .rainfall import constant_rainfall, storm_rainfall
from .solver import FloodSolver, FloodState
from .terrain import create_test_terrain, save_terrain, load_terrain

__all__ = [
    "FloodSolver",
    "FloodState",
    "constant_rainfall",
    "storm_rainfall",
    "create_test_terrain",
    "save_terrain",
    "load_terrain",
]