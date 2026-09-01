"""
2-D raster flood-routing solver for MirrorCity.

Physics included in this prototype:

    - rainfall forcing
    - Green-Ampt-style infiltration
    - spatially variable Manning roughness
    - hydraulic obstacles
    - open/closed boundary conditions
    - diffusive-wave-style surface routing
    - adaptive explicit timestep

State variables:

    h[j, i]       water depth [m]

Terrain:

    z[j, i]       ground elevation [m]

Water surface:

    eta = z + h

This remains a research prototype and is NOT an
engineering-certified hydraulic solver.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .boundary import BoundaryConditions
from .infiltration import GreenAmptInfiltration


@dataclass
class FloodState:
    """Snapshot of the flood model."""

    time: float
    depth: np.ndarray
    velocity_x: np.ndarray
    velocity_y: np.ndarray

    @property
    def max_depth(self) -> float:
        return float(np.max(self.depth))

    @property
    def max_velocity(self) -> float:
        speed = np.sqrt(
            self.velocity_x**2
            + self.velocity_y**2
        )

        return float(np.max(speed))

    @property
    def water_volume(self) -> float:
        return float(
            self.depth.sum()
        )


class FloodSolver:
    """
    2-D raster flood-routing solver.

    Args:
        elevation:
            Terrain elevation [m].

        dx, dy:
            Grid spacing [m].

        rainfall:
            Function returning rainfall intensity [m/s].

        manning_n:
            Scalar or spatial Manning roughness grid.

        infiltration:
            Optional infiltration model.

        obstacle_mask:
            Boolean grid where True means hydraulically blocked.

        boundary:
            Open/closed boundary conditions.
    """

    def __init__(
        self,
        elevation: np.ndarray,
        dx: float,
        dy: float,
        rainfall,
        manning_n: float | np.ndarray = 0.04,
        infiltration: GreenAmptInfiltration | None = None,
        obstacle_mask: np.ndarray | None = None,
        boundary: BoundaryConditions | None = None,
    ) -> None:

        elevation = np.asarray(
            elevation,
            dtype=np.float64,
        )

        if elevation.ndim != 2:
            raise ValueError(
                "Elevation must be a 2-D array."
            )

        if dx <= 0 or dy <= 0:
            raise ValueError(
                "dx and dy must be positive."
            )

        self.elevation = elevation
        self.dx = float(dx)
        self.dy = float(dy)
        self.rainfall = rainfall

        self.ny, self.nx = elevation.shape

        # --------------------------------------------------------
        # Manning roughness
        # --------------------------------------------------------

        roughness = np.asarray(
            manning_n,
            dtype=np.float64,
        )

        if roughness.ndim == 0:
            roughness = np.full(
                elevation.shape,
                float(roughness),
                dtype=np.float64,
            )

        if roughness.shape != elevation.shape:
            raise ValueError(
                "manning_n array must match elevation shape."
            )

        if np.any(roughness <= 0):
            raise ValueError(
                "All Manning n values must be positive."
            )

        self.manning_n = roughness

        # --------------------------------------------------------
        # Infiltration
        # --------------------------------------------------------

        if infiltration is not None:
            if infiltration.shape != elevation.shape:
                raise ValueError(
                    "Infiltration model shape must match elevation."
                )

        self.infiltration = infiltration

        # --------------------------------------------------------
        # Obstacles
        # --------------------------------------------------------

        if obstacle_mask is None:

            obstacle_mask = np.zeros(
                elevation.shape,
                dtype=bool,
            )

        obstacle_mask = np.asarray(
            obstacle_mask,
            dtype=bool,
        )

        if obstacle_mask.shape != elevation.shape:
            raise ValueError(
                "obstacle_mask must match elevation shape."
            )

        self.obstacle_mask = obstacle_mask

        # --------------------------------------------------------
        # Boundary conditions
        # --------------------------------------------------------

        self.boundary = (
            BoundaryConditions.closed()
            if boundary is None
            else boundary
        )

        # --------------------------------------------------------
        # Dynamic state
        # --------------------------------------------------------

        self.depth = np.zeros_like(
            elevation
        )

        self.velocity_x = np.zeros_like(
            elevation
        )

        self.velocity_y = np.zeros_like(
            elevation
        )

        self.time = 0.0

        # Cumulative bookkeeping.
        self.total_rainfall_depth = 0.0
        self.total_infiltration_depth = 0.0
        self.total_outflow_volume = 0.0

    # ============================================================
    # Rainfall
    # ============================================================

    def rainfall_rate(self) -> float:
        """Return rainfall intensity [m/s]."""

        rate = float(
            self.rainfall(self.time)
        )

        if rate < 0:
            raise ValueError(
                "Rainfall rate cannot be negative."
            )

        return rate

    def add_rainfall(
        self,
        dt: float,
    ) -> float:
        """
        Add rainfall to the surface.

        Returns:
            rainfall depth added [m].
        """

        rate = self.rainfall_rate()

        rainfall_depth = rate * dt

        self.depth += rainfall_depth

        self.total_rainfall_depth += (
            rainfall_depth
        )

        return rainfall_depth

    # ============================================================
    # Infiltration
    # ============================================================

    def apply_infiltration(
        self,
        dt: float,
    ) -> float:
        """
        Remove infiltrated water.

        Returns:
            mean infiltrated depth [m].
        """

        if self.infiltration is None:
            return 0.0

        infiltrated = self.infiltration.infiltrate(
            available_water=self.depth,
            dt=dt,
        )

        self.depth -= infiltrated

        # Numerical protection.
        self.depth = np.maximum(
            self.depth,
            0.0,
        )

        self.total_infiltration_depth += (
            float(np.mean(infiltrated))
        )

        return float(
            np.mean(infiltrated)
        )

    # ============================================================
    # Hydraulic flux
    # ============================================================

    def _calculate_fluxes(
        self,
    ) -> tuple[np.ndarray, np.ndarray]:

        eta = (
            self.elevation
            + self.depth
        )

        qx = np.zeros(
            (
                self.ny,
                self.nx + 1,
            ),
            dtype=np.float64,
        )

        qy = np.zeros(
            (
                self.ny + 1,
                self.nx,
            ),
            dtype=np.float64,
        )

        # ========================================================
        # X direction
        # ========================================================

        eta_left = eta[:, :-1]
        eta_right = eta[:, 1:]

        depth_left = self.depth[:, :-1]
        depth_right = self.depth[:, 1:]

        blocked_left = self.obstacle_mask[:, :-1]
        blocked_right = self.obstacle_mask[:, 1:]

        water_depth = np.minimum(
            depth_left,
            depth_right,
        )

        gradient_x = (
            eta_right - eta_left
        ) / self.dx

        positive_depth = np.maximum(
            water_depth,
            1.0e-8,
        )

        velocity = (
            positive_depth ** (2.0 / 3.0)
            * np.sqrt(
                np.abs(gradient_x)
            )
            / (
                0.5
                * (
                    self.manning_n[:, :-1]
                    + self.manning_n[:, 1:]
                )
            )
        )

        velocity *= np.sign(
            gradient_x
        )

        discharge = (
            water_depth
            * velocity
        )

        # Do not move water through obstacles.
        discharge[
            blocked_left
            | blocked_right
        ] = 0.0

        qx[:, 1:-1] = -discharge

        # ========================================================
        # Y direction
        # ========================================================

        eta_top = eta[:-1, :]
        eta_bottom = eta[1:, :]

        depth_top = self.depth[:-1, :]
        depth_bottom = self.depth[1:, :]

        blocked_top = self.obstacle_mask[:-1, :]
        blocked_bottom = self.obstacle_mask[1:, :]

        water_depth = np.minimum(
            depth_top,
            depth_bottom,
        )

        gradient_y = (
            eta_bottom - eta_top
        ) / self.dy

        positive_depth = np.maximum(
            water_depth,
            1.0e-8,
        )

        velocity = (
            positive_depth ** (2.0 / 3.0)
            * np.sqrt(
                np.abs(gradient_y)
            )
            / (
                0.5
                * (
                    self.manning_n[:-1, :]
                    + self.manning_n[1:, :]
                )
            )
        )

        velocity *= np.sign(
            gradient_y
        )

        discharge = (
            water_depth
            * velocity
        )

        discharge[
            blocked_top
            | blocked_bottom
        ] = 0.0

        qy[1:-1, :] = -discharge

        # ========================================================
        # Boundary conditions
        # ========================================================

        if self.boundary.west == "closed":
            qx[:, 0] = 0.0

        if self.boundary.east == "closed":
            qx[:, -1] = 0.0

        if self.boundary.north == "closed":
            qy[0, :] = 0.0

        if self.boundary.south == "closed":
            qy[-1, :] = 0.0

        return qx, qy

    # ============================================================
    # Divergence
    # ============================================================

    def _divergence(
        self,
        qx: np.ndarray,
        qy: np.ndarray,
    ) -> np.ndarray:

        divergence_x = (
            qx[:, 1:]
            - qx[:, :-1]
        ) / self.dx

        divergence_y = (
            qy[1:, :]
            - qy[:-1, :]
        ) / self.dy

        return (
            divergence_x
            + divergence_y
        )

    # ============================================================
    # Velocity
    # ============================================================

    def _calculate_cell_velocity(
        self,
    ) -> tuple[np.ndarray, np.ndarray]:

        eta = (
            self.elevation
            + self.depth
        )

        velocity_x = np.zeros_like(
            self.depth
        )

        velocity_y = np.zeros_like(
            self.depth
        )

        # X gradient.
        gradient_x = np.zeros_like(
            self.depth
        )

        gradient_x[:, 1:-1] = (
            eta[:, 2:]
            - eta[:, :-2]
        ) / (
            2.0 * self.dx
        )

        depth_safe = np.maximum(
            self.depth,
            1.0e-8,
        )

        velocity_x = (
            depth_safe ** (2.0 / 3.0)
            * np.sign(gradient_x)
            * np.sqrt(
                np.abs(gradient_x)
            )
            / self.manning_n
        )

        # Y gradient.
        gradient_y = np.zeros_like(
            self.depth
        )

        gradient_y[1:-1, :] = (
            eta[2:, :]
            - eta[:-2, :]
        ) / (
            2.0 * self.dy
        )

        velocity_y = (
            depth_safe ** (2.0 / 3.0)
            * np.sign(gradient_y)
            * np.sqrt(
                np.abs(gradient_y)
            )
            / self.manning_n
        )

        velocity_x[
            self.obstacle_mask
        ] = 0.0

        velocity_y[
            self.obstacle_mask
        ] = 0.0

        return velocity_x, velocity_y

    # ============================================================
    # Timestep
    # ============================================================

    def choose_timestep(
        self,
        max_dt: float = 2.0,
    ) -> float:

        max_depth = float(
            np.max(self.depth)
        )

        if max_depth <= 1.0e-8:
            return min(
                max_dt,
                1.0,
            )

        wave_speed = np.sqrt(
            9.81 * max_depth
        )

        characteristic_length = min(
            self.dx,
            self.dy,
        )

        dt = (
            0.35
            * characteristic_length
            / max(
                wave_speed,
                1.0e-8,
            )
        )

        return min(
            max_dt,
            dt,
        )

    # ============================================================
    # Step
    # ============================================================

    def step(
        self,
        dt: float,
    ) -> FloodState:

        if dt <= 0:
            raise ValueError(
                "dt must be positive."
            )

        # --------------------------------------------------------
        # Rainfall
        # --------------------------------------------------------

        self.add_rainfall(dt)

        # --------------------------------------------------------
        # Infiltration
        # --------------------------------------------------------

        self.apply_infiltration(dt)

        # --------------------------------------------------------
        # Obstacles cannot hold water.
        # --------------------------------------------------------

        self.depth[
            self.obstacle_mask
        ] = 0.0

        # --------------------------------------------------------
        # Transport
        # --------------------------------------------------------

        qx, qy = (
            self._calculate_fluxes()
        )

        divergence = (
            self._divergence(
                qx,
                qy,
            )
        )

        # --------------------------------------------------------
        # Conservative update
        # --------------------------------------------------------

        new_depth = (
            self.depth
            - dt * divergence
        )

        new_depth = np.maximum(
            new_depth,
            0.0,
        )

        new_depth[
            self.obstacle_mask
        ] = 0.0

        # --------------------------------------------------------
        # Estimate boundary outflow.
        # --------------------------------------------------------

        outflow = 0.0

        if self.boundary.west == "open":
            outflow += float(
                np.sum(
                    np.maximum(
                        qx[:, 0],
                        0.0,
                    )
                )
                * self.dy
                * dt
            )

        if self.boundary.east == "open":
            outflow += float(
                np.sum(
                    np.maximum(
                        -qx[:, -1],
                        0.0,
                    )
                )
                * self.dy
                * dt
            )

        if self.boundary.north == "open":
            outflow += float(
                np.sum(
                    np.maximum(
                        qy[0, :],
                        0.0,
                    )
                )
                * self.dx
                * dt
            )

        if self.boundary.south == "open":
            outflow += float(
                np.sum(
                    np.maximum(
                        -qy[-1, :],
                        0.0,
                    )
                )
                * self.dx
                * dt
            )

        self.total_outflow_volume += (
            max(outflow, 0.0)
        )

        self.depth = new_depth

        self.time += dt

        (
            self.velocity_x,
            self.velocity_y,
        ) = self._calculate_cell_velocity()

        return FloodState(
            time=self.time,
            depth=self.depth.copy(),
            velocity_x=self.velocity_x.copy(),
            velocity_y=self.velocity_y.copy(),
        )

    # ============================================================
    # Run
    # ============================================================

    def run(
        self,
        duration: float,
        output_interval: float = 60.0,
    ) -> list[FloodState]:

        if duration <= 0:
            raise ValueError(
                "duration must be positive."
            )

        if output_interval <= 0:
            raise ValueError(
                "output_interval must be positive."
            )

        states: list[FloodState] = []

        next_output = output_interval

        while self.time < duration:

            dt = self.choose_timestep()

            remaining = (
                duration
                - self.time
            )

            dt = min(
                dt,
                remaining,
            )

            dt = min(
                dt,
                next_output
                - self.time,
            )

            self.step(dt)

            if self.time >= (
                next_output - 1.0e-9
            ):

                states.append(
                    FloodState(
                        time=self.time,
                        depth=self.depth.copy(),
                        velocity_x=self.velocity_x.copy(),
                        velocity_y=self.velocity_y.copy(),
                    )
                )

                next_output += (
                    output_interval
                )

        return states

    # ============================================================
    # Diagnostics
    # ============================================================

    def max_depth(self) -> float:
        """Maximum water depth [m]."""

        return float(
            np.max(self.depth)
        )

    def max_velocity(self) -> float:
        """Maximum water velocity [m/s]."""

        speed = np.sqrt(
            self.velocity_x**2
            + self.velocity_y**2
        )

        return float(
            np.max(speed)
        )

    def total_water_volume(self) -> float:
        """Water volume currently inside domain [m³]."""

        return float(
            self.depth.sum()
            * self.dx
            * self.dy
        )

    def water_surface_elevation(
        self,
    ) -> np.ndarray:
        """Return water-surface elevation [m]."""

        return (
            self.elevation
            + self.depth
        )

    def hazard_index(
        self,
    ) -> np.ndarray:
        """
        Simple depth-velocity hazard indicator.

        Prototype classification:

            < 0.1  -> low
            < 0.5  -> moderate
            < 1.0  -> high
            >= 1.0 -> extreme

        The index is:

            H = depth * (velocity + 0.5)

        This is a screening indicator, NOT an official
        flood-hazard standard.
        """

        speed = np.sqrt(
            self.velocity_x**2
            + self.velocity_y**2
        )

        return (
            self.depth
            * (
                speed
                + 0.5
            )
        )