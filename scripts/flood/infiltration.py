"""
Infiltration models for the MirrorCity flood simulation.

The current implementation uses a Green-Ampt-style infiltration
approximation.

Units:

    rainfall       -> m/s
    infiltration  -> m/s
    depth         -> m
    conductivity   -> m/s

This is a research prototype and should be calibrated against
soil and field measurements before engineering use.
"""

from __future__ import annotations

import numpy as np


class GreenAmptInfiltration:
    """
    Green-Ampt-style infiltration model.

    The cumulative infiltration F is tracked for every grid cell.

    Approximate infiltration capacity:

        f = K * (1 + psi * delta_theta / F)

    where:

        K           = saturated hydraulic conductivity
        psi         = wetting-front suction head
        delta_theta = moisture deficit
        F           = cumulative infiltration

    The actual infiltration is limited by available surface water.
    """

    def __init__(
        self,
        shape: tuple[int, int],
        hydraulic_conductivity: float = 1.0e-5,
        suction_head: float = 0.10,
        moisture_deficit: float = 0.25,
    ) -> None:

        if hydraulic_conductivity <= 0:
            raise ValueError(
                "hydraulic_conductivity must be positive."
            )

        if suction_head < 0:
            raise ValueError(
                "suction_head cannot be negative."
            )

        if not 0 < moisture_deficit <= 1:
            raise ValueError(
                "moisture_deficit must be in (0, 1]."
            )

        self.shape = shape

        self.hydraulic_conductivity = float(
            hydraulic_conductivity
        )

        self.suction_head = float(
            suction_head
        )

        self.moisture_deficit = float(
            moisture_deficit
        )

        self.cumulative_infiltration = np.zeros(
            shape,
            dtype=np.float64,
        )

    def capacity(self) -> np.ndarray:
        """
        Return infiltration capacity [m/s].

        A small epsilon prevents division by zero.
        """

        F = np.maximum(
            self.cumulative_infiltration,
            1.0e-10,
        )

        capacity = self.hydraulic_conductivity * (
            1.0
            + (
                self.suction_head
                * self.moisture_deficit
                / F
            )
        )

        return capacity

    def infiltrate(
        self,
        available_water: np.ndarray,
        dt: float,
    ) -> np.ndarray:
        """
        Remove water from the surface and infiltrate it.

        Args:
            available_water:
                Surface water depth available for infiltration [m].

            dt:
                Time step [s].

        Returns:
            Actual infiltrated depth [m].
        """

        if dt <= 0:
            raise ValueError("dt must be positive.")

        available_water = np.asarray(
            available_water,
            dtype=np.float64,
        )

        if available_water.shape != self.shape:
            raise ValueError(
                "available_water shape does not match model shape."
            )

        if np.any(available_water < 0):
            raise ValueError(
                "available_water cannot be negative."
            )

        capacity = self.capacity()

        potential_infiltration = capacity * dt

        infiltration = np.minimum(
            available_water,
            potential_infiltration,
        )

        infiltration = np.maximum(
            infiltration,
            0.0,
        )

        self.cumulative_infiltration += infiltration

        return infiltration