"""
2-D raster flood-routing solver for MirrorCity.

This first implementation uses a diffusive-wave style formulation.

State variables:

    h[j, i]       water depth [m]

Terrain:

    z[j, i]       ground elevation [m]

Water surface:

    eta = z + h

Flow is driven by gradients in eta and limited using a
Manning-style relationship.

This is an educational/research prototype, not an
engineering-certified hydraulic solver.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class FloodState:
    """State of the flood model at one point in time."""

    time: float
    depth: np.ndarray

    @property
    def max_depth(self) -> float:
        return float(np.max(self.depth))

    @property
    def water_volume(self) -> float:
        return float(self.depth.sum())


class FloodSolver:
    """
    2-D raster flood-routing solver.

    Args:
        elevation:
            Terrain elevation grid [m].

        dx, dy:
            Grid spacing [m].

        manning_n:
            Manning roughness coefficient.

        rainfall:
            Function returning rainfall intensity [m/s].
    """

    def __init__(
        self,
        elevation: np.ndarray,
        dx: float,
        dy: float,
        rainfall,
        manning_n: float = 0.04,
    ) -> None:

        elevation = np.asarray(elevation, dtype=np.float64)

        if elevation.ndim != 2:
            raise ValueError("Elevation must be a 2-D array.")

        if dx <= 0 or dy <= 0:
            raise ValueError("dx and dy must be positive.")

        if manning_n <= 0:
            raise ValueError("Manning n must be positive.")

        self.elevation = elevation
        self.dx = float(dx)
        self.dy = float(dy)
        self.rainfall = rainfall
        self.manning_n = float(manning_n)

        self.ny, self.nx = elevation.shape

        self.depth = np.zeros_like(elevation)

        self.time = 0.0

    def rainfall_rate(self) -> float:
        """Return rainfall intensity at the current time."""

        return float(self.rainfall(self.time))

    def add_rainfall(self, dt: float) -> None:
        """
        Add rainfall directly to the surface water depth.

        Rainfall is assumed to fall uniformly over the domain.
        """

        rate = self.rainfall_rate()

        if rate < 0:
            raise ValueError("Rainfall rate cannot be negative.")

        self.depth += rate * dt

    def _calculate_fluxes(self) -> tuple[np.ndarray, np.ndarray]:
        """
        Calculate water fluxes between neighboring cells.

        Returns:

            qx:
                Flux across vertical cell faces.

            qy:
                Flux across horizontal cell faces.

        Flux units are approximately m^3/s per unit width.
        """

        eta = self.elevation + self.depth

        qx = np.zeros((self.ny, self.nx + 1), dtype=np.float64)
        qy = np.zeros((self.ny + 1, self.nx), dtype=np.float64)

        # ------------------------------------------------------------
        # X direction
        # ------------------------------------------------------------

        eta_left = eta[:, :-1]
        eta_right = eta[:, 1:]

        depth_left = self.depth[:, :-1]
        depth_right = self.depth[:, 1:]

        water_depth = np.minimum(depth_left, depth_right)

        gradient_x = (eta_right - eta_left) / self.dx

        positive_depth = np.maximum(water_depth, 1e-8)

        # Manning-style velocity magnitude.
        hydraulic_radius = positive_depth

        velocity = (
            hydraulic_radius ** (2.0 / 3.0)
            * np.sqrt(np.abs(gradient_x))
            / self.manning_n
        )

        velocity *= np.sign(gradient_x)

        discharge = water_depth * velocity

        # Only move water from high water-surface elevation
        # toward low water-surface elevation.
        qx[:, 1:-1] = -discharge

        # ------------------------------------------------------------
        # Y direction
        # ------------------------------------------------------------

        eta_top = eta[:-1, :]
        eta_bottom = eta[1:, :]

        depth_top = self.depth[:-1, :]
        depth_bottom = self.depth[1:, :]

        water_depth = np.minimum(depth_top, depth_bottom)

        gradient_y = (eta_bottom - eta_top) / self.dy

        positive_depth = np.maximum(water_depth, 1e-8)

        hydraulic_radius = positive_depth

        velocity = (
            hydraulic_radius ** (2.0 / 3.0)
            * np.sqrt(np.abs(gradient_y))
            / self.manning_n
        )

        velocity *= np.sign(gradient_y)

        discharge = water_depth * velocity

        qy[1:-1, :] = -discharge

        return qx, qy

    def _divergence(
        self,
        qx: np.ndarray,
        qy: np.ndarray,
    ) -> np.ndarray:
        """
        Calculate the divergence of the flux field.

        Positive divergence means water is leaving a cell.
        """

        divergence_x = (
            qx[:, 1:] - qx[:, :-1]
        ) / self.dx

        divergence_y = (
            qy[1:, :] - qy[:-1, :]
        ) / self.dy

        return divergence_x + divergence_y

    def choose_timestep(
        self,
        max_dt: float = 2.0,
    ) -> float:
        """
        Choose a conservative timestep.

        The first implementation keeps the timestep modest because
        the model is explicit.
        """

        max_depth = float(np.max(self.depth))

        if max_depth <= 1e-8:
            return min(max_dt, 1.0)

        wave_speed = np.sqrt(9.81 * max_depth)

        characteristic_length = min(self.dx, self.dy)

        dt = 0.35 * characteristic_length / max(
            wave_speed,
            1e-8,
        )

        return min(max_dt, dt)

    def step(self, dt: float) -> FloodState:
        """
        Advance the simulation by dt seconds.
        """

        if dt <= 0:
            raise ValueError("dt must be positive.")

        # Add rainfall first.
        self.add_rainfall(dt)

        # Calculate transport.
        qx, qy = self._calculate_fluxes()

        divergence = self._divergence(qx, qy)

        # Conservative update.
        new_depth = self.depth - dt * divergence

        # Numerical round-off should never create negative water.
        new_depth = np.maximum(new_depth, 0.0)

        self.depth = new_depth
        self.time += dt

        return FloodState(
            time=self.time,
            depth=self.depth.copy(),
        )

    def run(
        self,
        duration: float,
        output_interval: float = 60.0,
    ) -> list[FloodState]:
        """
        Run the simulation.

        Args:
            duration:
                Total simulation time [s].

            output_interval:
                Time between stored outputs [s].

        Returns:
            List of FloodState snapshots.
        """

        if duration <= 0:
            raise ValueError("duration must be positive.")

        if output_interval <= 0:
            raise ValueError("output_interval must be positive.")

        states: list[FloodState] = []

        next_output = output_interval

        while self.time < duration:

            dt = self.choose_timestep()

            remaining = duration - self.time
            dt = min(dt, remaining)

            # Avoid stepping beyond the next requested output.
            dt = min(dt, next_output - self.time)

            state = self.step(dt)

            if self.time >= next_output - 1e-9:
                states.append(state)
                next_output += output_interval

        return states

        def max_depth(self) -> float:
            """Maximum water depth in the domain [m]."""
            return float(np.max(self.depth))

    def total_water_volume(self) -> float:
        """
        Total water volume in the domain [m^3].
        """

        return float(
            self.depth.sum()
            * self.dx
            * self.dy
        )