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

        roof_mask:
            Boolean grid of building roofs. Roofs are obstacles, but
            their rain drains (like a downspout) to the nearest open
            cell instead of being lost.

        sink_mask:
            Boolean grid of cells outside the modelled area (e.g.
            beyond a survey's edge). Water flowing into them leaves
            the model and counts as outflow; rain on them is ignored.

        drain_rate:
            Storm-drain capacity per cell [m/s] (scalar or grid).
            Up to this rate of surface water is removed and counted
            as drained.

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
        roof_mask: np.ndarray | None = None,
        sink_mask: np.ndarray | None = None,
        drain_rate: float | np.ndarray = 0.0,
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
        # Roof drainage
        # --------------------------------------------------------

        roof_mask = (
            np.zeros(elevation.shape, dtype=bool)
            if roof_mask is None
            else np.asarray(roof_mask, dtype=bool)
        )

        if roof_mask.shape != elevation.shape:
            raise ValueError(
                "roof_mask must match elevation shape."
            )

        # Roofs are always obstacles.
        self.obstacle_mask = self.obstacle_mask | roof_mask

        # --------------------------------------------------------
        # Sinks and drains
        # --------------------------------------------------------

        self.sink_mask = (
            np.zeros(elevation.shape, dtype=bool)
            if sink_mask is None
            else np.asarray(sink_mask, dtype=bool)
        ) & ~self.obstacle_mask

        if self.sink_mask.shape != elevation.shape:
            raise ValueError(
                "sink_mask must match elevation shape."
            )

        self.drain_rate = np.broadcast_to(
            np.asarray(drain_rate, dtype=np.float64),
            elevation.shape,
        )

        if np.any(self.drain_rate < 0):
            raise ValueError(
                "drain_rate cannot be negative."
            )

        self.roof_cells, self.roof_outlets = self._roof_outlets(
            roof_mask
        )

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

        # Face discharges (m²/s), carried between steps by the
        # local-inertial flux update.
        self.qx = np.zeros(
            (self.ny, self.nx + 1),
        )

        self.qy = np.zeros(
            (self.ny + 1, self.nx),
        )

        self.time = 0.0

        # Cumulative bookkeeping.
        self.total_rainfall_depth = 0.0
        self.total_infiltration_depth = 0.0
        self.total_outflow_volume = 0.0
        self.total_drained_volume = 0.0

        # Per-cell peaks over the run, and when the deepest water
        # anywhere occurred.
        self.peak_depth = np.zeros_like(elevation)
        self.peak_hazard = np.zeros_like(elevation)
        self.peak_time = 0.0

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

        # Roof rain runs off to the ground; the roof cell itself is
        # emptied with the other obstacles.
        np.add.at(
            self.depth,
            self.roof_outlets,
            rainfall_depth,
        )

        self.total_rainfall_depth += (
            rainfall_depth
        )

        return rainfall_depth

    def _roof_outlets(
        self,
        roof_mask: np.ndarray,
    ) -> tuple[np.ndarray, tuple[np.ndarray, np.ndarray]]:
        """
        Roof cells that can drain, and the open cell each drains to:
        the nearest by 4-neighbour steps (breadth-first search from
        all open cells).
        """

        ny, nx = roof_mask.shape
        outlet = np.full((ny, nx, 2), -1)

        frontier = list(zip(*np.nonzero(~self.obstacle_mask & ~self.sink_mask)))
        for j, i in frontier:
            outlet[j, i] = (j, i)

        while frontier:
            reached = []
            for j, i in frontier:
                for nj, ni in ((j - 1, i), (j + 1, i), (j, i - 1), (j, i + 1)):
                    if 0 <= nj < ny and 0 <= ni < nx and outlet[nj, ni, 0] < 0:
                        outlet[nj, ni] = outlet[j, i]
                        reached.append((nj, ni))
            frontier = reached

        # Roofs with no route to open ground (e.g. an all-obstacle grid)
        # keep losing their rain.
        drains = roof_mask & (outlet[:, :, 0] >= 0)

        return drains, (outlet[drains][:, 0], outlet[drains][:, 1])

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
        dt: float,
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Local-inertial face discharges (Bates et al., 2010):

            q = (q - g h dt S) / (1 + g dt n² |q| / h^(7/3))

        A plain Manning (diffusive-wave) flux is unstable under the
        gravity-wave timestep used here: ponded water oscillates until
        depth overflows. The inertial term keeps it stable.
        """

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

        blocked_left = self.obstacle_mask[:, :-1]
        blocked_right = self.obstacle_mask[:, 1:]

        # Flow depth between cells: highest water surface above the
        # highest bed, so water can spill into dry neighbours.
        water_depth = np.maximum(
            np.maximum(eta_left, eta_right)
            - np.maximum(
                self.elevation[:, :-1],
                self.elevation[:, 1:],
            ),
            0.0,
        )

        gradient_x = (
            eta_right - eta_left
        ) / self.dx

        positive_depth = np.maximum(
            water_depth,
            1.0e-8,
        )

        roughness = 0.5 * (
            self.manning_n[:, :-1]
            + self.manning_n[:, 1:]
        )

        previous = self.qx[:, 1:-1]

        discharge = (
            previous
            - 9.81 * water_depth * dt * gradient_x
        ) / (
            1.0
            + 9.81 * dt * roughness**2
            * np.abs(previous)
            / positive_depth ** (7.0 / 3.0)
        )

        discharge[water_depth <= 1.0e-8] = 0.0

        # Do not move water through obstacles.
        discharge[
            blocked_left
            | blocked_right
        ] = 0.0

        qx[:, 1:-1] = discharge

        # ========================================================
        # Y direction
        # ========================================================

        eta_top = eta[:-1, :]
        eta_bottom = eta[1:, :]

        blocked_top = self.obstacle_mask[:-1, :]
        blocked_bottom = self.obstacle_mask[1:, :]

        water_depth = np.maximum(
            np.maximum(eta_top, eta_bottom)
            - np.maximum(
                self.elevation[:-1, :],
                self.elevation[1:, :],
            ),
            0.0,
        )

        gradient_y = (
            eta_bottom - eta_top
        ) / self.dy

        positive_depth = np.maximum(
            water_depth,
            1.0e-8,
        )

        roughness = 0.5 * (
            self.manning_n[:-1, :]
            + self.manning_n[1:, :]
        )

        previous = self.qy[1:-1, :]

        discharge = (
            previous
            - 9.81 * water_depth * dt * gradient_y
        ) / (
            1.0
            + 9.81 * dt * roughness**2
            * np.abs(previous)
            / positive_depth ** (7.0 / 3.0)
        )

        discharge[water_depth <= 1.0e-8] = 0.0

        discharge[
            blocked_top
            | blocked_bottom
        ] = 0.0

        qy[1:-1, :] = discharge

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

        # Open edges drain freely: the water-surface slope is carried
        # on past the edge cell and drives the same inertial update.
        # Discharges are signed +x/+y, so west/north outflow is negative.
        if self.boundary.west == "open":
            qx[:, 0] = -self._open_boundary_discharge(
                -self.qx[:, 0], eta[:, 0], eta[:, 1], self.dx, dt,
                self.depth[:, 0], self.manning_n[:, 0], self.obstacle_mask[:, 0],
            )

        if self.boundary.east == "open":
            qx[:, -1] = self._open_boundary_discharge(
                self.qx[:, -1], eta[:, -1], eta[:, -2], self.dx, dt,
                self.depth[:, -1], self.manning_n[:, -1], self.obstacle_mask[:, -1],
            )

        if self.boundary.north == "open":
            qy[0, :] = -self._open_boundary_discharge(
                -self.qy[0, :], eta[0, :], eta[1, :], self.dy, dt,
                self.depth[0, :], self.manning_n[0, :], self.obstacle_mask[0, :],
            )

        if self.boundary.south == "open":
            qy[-1, :] = self._open_boundary_discharge(
                self.qy[-1, :], eta[-1, :], eta[-2, :], self.dy, dt,
                self.depth[-1, :], self.manning_n[-1, :], self.obstacle_mask[-1, :],
            )

        # ========================================================
        # Outflow limiter
        # ========================================================

        # Scale each cell's outgoing discharges so it cannot lose more
        # water than it holds; otherwise clipping negative depth to
        # zero creates water.
        outgoing = (
            np.maximum(qx[:, 1:], 0.0)
            + np.maximum(-qx[:, :-1], 0.0)
        ) / self.dx + (
            np.maximum(qy[1:, :], 0.0)
            + np.maximum(-qy[:-1, :], 0.0)
        ) / self.dy

        scale = np.minimum(
            1.0,
            self.depth
            / np.maximum(outgoing * dt, 1.0e-300),
        )

        # Each face is scaled by its donor (upstream) cell.
        scale_x = np.pad(scale, ((0, 0), (1, 1)), constant_values=1.0)
        qx *= np.where(qx > 0.0, scale_x[:, :-1], scale_x[:, 1:])

        scale_y = np.pad(scale, ((1, 1), (0, 0)), constant_values=1.0)
        qy *= np.where(qy > 0.0, scale_y[:-1, :], scale_y[1:, :])

        return qx, qy

    @staticmethod
    def _open_boundary_discharge(
        previous: np.ndarray,
        eta_edge: np.ndarray,
        eta_inner: np.ndarray,
        spacing: float,
        dt: float,
        depth: np.ndarray,
        roughness: np.ndarray,
        blocked: np.ndarray,
    ) -> np.ndarray:
        """Outward discharge (>= 0) through one open edge."""

        # Water-surface gradient in the outward direction.
        gradient = (eta_edge - eta_inner) / spacing

        discharge = (
            previous
            - 9.81 * depth * dt * gradient
        ) / (
            1.0
            + 9.81 * dt * roughness**2
            * np.abs(previous)
            / np.maximum(depth, 1.0e-8) ** (7.0 / 3.0)
        )

        discharge[(depth <= 1.0e-8) | blocked] = 0.0

        return np.maximum(discharge, 0.0)

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
        """
        Cell velocity from the face discharges: the average of a
        cell's two face discharges divided by its depth. Cells under
        1 mm of water report zero, as a film that thin has no
        meaningful velocity.
        """

        depth = np.where(
            self.depth > 1.0e-3,
            self.depth,
            np.inf,
        )

        velocity_x = 0.5 * (self.qx[:, :-1] + self.qx[:, 1:]) / depth
        velocity_y = 0.5 * (self.qy[:-1, :] + self.qy[1:, :]) / depth

        velocity_x[self.obstacle_mask] = 0.0
        velocity_y[self.obstacle_mask] = 0.0

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
        # Obstacles cannot hold water (so it can't soak in there
        # either: clear it before infiltration).
        # --------------------------------------------------------

        self.depth[
            self.obstacle_mask | self.sink_mask
        ] = 0.0

        # --------------------------------------------------------
        # Infiltration and storm drains
        # --------------------------------------------------------

        self.apply_infiltration(dt)

        drained = np.minimum(
            self.depth,
            self.drain_rate * dt,
        )

        self.depth -= drained

        self.total_drained_volume += float(
            drained.sum() * self.dx * self.dy
        )

        # --------------------------------------------------------
        # Transport
        # --------------------------------------------------------

        qx, qy = (
            self._calculate_fluxes(dt)
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

        # Water that reached a sink has left the modelled area.
        self.total_outflow_volume += float(
            new_depth[self.sink_mask].sum() * self.dx * self.dy
        )

        new_depth[
            self.sink_mask
        ] = 0.0

        # --------------------------------------------------------
        # Estimate boundary outflow.
        # --------------------------------------------------------

        outflow = 0.0

        if self.boundary.west == "open":
            outflow += float(
                np.sum(
                    np.maximum(
                        -qx[:, 0],
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
                        qx[:, -1],
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
                        -qy[0, :],
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
                        qy[-1, :],
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
        self.qx = qx
        self.qy = qy

        self.time += dt

        (
            self.velocity_x,
            self.velocity_y,
        ) = self._calculate_cell_velocity()

        if self.depth.max() > self.peak_depth.max():
            self.peak_time = self.time

        np.maximum(self.peak_depth, self.depth, out=self.peak_depth)
        np.maximum(self.peak_hazard, self.hazard_index(), out=self.peak_hazard)

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