
"""
Surface roughness utilities for the MirrorCity flood model.

Manning's n is spatially variable.

Typical prototype values:

    road       -> 0.015
    concrete   -> 0.020
    grass      -> 0.035
    vegetation -> 0.060
    default    -> 0.040

These are illustrative prototype values and must be calibrated
for engineering applications.
"""

from __future__ import annotations

import numpy as np


DEFAULT_ROUGHNESS = {
    "road": 0.015,
    "concrete": 0.020,
    "grass": 0.035,
    "soil": 0.040,
    "vegetation": 0.060,
    "water": 0.020,
}


def uniform_roughness(
    shape: tuple[int, int],
    manning_n: float = 0.04,
) -> np.ndarray:
    """Create a spatially uniform Manning roughness grid."""

    if manning_n <= 0:
        raise ValueError(
            "Manning n must be positive."
        )

    return np.full(
        shape,
        float(manning_n),
        dtype=np.float64,
    )


def land_use_roughness(
    land_use: np.ndarray,
    values: dict[str, float] | None = None,
    default: float = 0.04,
) -> np.ndarray:
    """
    Convert a categorical land-use grid into Manning n values.

    Args:
        land_use:
            String/object array containing labels.

        values:
            Optional mapping from land-use label to Manning n.

        default:
            Value used for unknown classes.

    Returns:
        Manning roughness array.
    """

    if default <= 0:
        raise ValueError(
            "default Manning n must be positive."
        )

    mapping = (
        DEFAULT_ROUGHNESS
        if values is None
        else values
    )

    land_use = np.asarray(land_use)

    result = np.full(
        land_use.shape,
        default,
        dtype=np.float64,
    )

    for label, value in mapping.items():

        if value <= 0:
            raise ValueError(
                f"Manning n for '{label}' must be positive."
            )

        result[land_use == label] = value

    return result