"""
Boundary conditions for the MirrorCity flood model.

A boundary controls how water behaves at the outer edge
of the computational domain.

Supported conditions:

    closed
        No water crosses the boundary.

    open
        Water is allowed to leave the computational domain.

This is intended for the research prototype and is not
an engineering-certified boundary treatment.
"""

from __future__ import annotations

from dataclasses import dataclass


VALID_BOUNDARIES = {"closed", "open"}


@dataclass(frozen=True)
class BoundaryConditions:
    """
    Boundary conditions for the four sides of the domain.

    Attributes:
        west:
            Boundary condition on the left side.

        east:
            Boundary condition on the right side.

        north:
            Boundary condition on the top side.

        south:
            Boundary condition on the bottom side.
    """

    west: str = "closed"
    east: str = "closed"
    north: str = "closed"
    south: str = "closed"

    def __post_init__(self) -> None:
        for name, value in (
            ("west", self.west),
            ("east", self.east),
            ("north", self.north),
            ("south", self.south),
        ):
            if value not in VALID_BOUNDARIES:
                raise ValueError(
                    f"{name} boundary must be one of "
                    f"{sorted(VALID_BOUNDARIES)}."
                )

    @classmethod
    def closed(cls) -> "BoundaryConditions":
        """Return fully closed boundaries."""

        return cls()

    @classmethod
    def open_all(cls) -> "BoundaryConditions":
        """Return fully open boundaries."""

        return cls(
            west="open",
            east="open",
            north="open",
            south="open",
        )