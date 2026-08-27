"""
Rainfall forcing for the MirrorCity flood model.

Rainfall intensity is expressed in metres/second.

For reference:

    10 mm/hour = 10e-3 / 3600 m/s
"""

from __future__ import annotations


def constant_rainfall(
    intensity_mm_per_hour: float,
) -> callable:
    """
    Return a rainfall function with constant intensity.

    Example:
        rain = constant_rainfall(50.0)
        intensity = rain(600.0)

    Args:
        intensity_mm_per_hour:
            Rainfall intensity in mm/hour.
    """

    if intensity_mm_per_hour < 0:
        raise ValueError("Rainfall intensity cannot be negative.")

    intensity_m_per_second = (
        intensity_mm_per_hour / 1000.0 / 3600.0
    )

    def rainfall(_time_seconds: float) -> float:
        return intensity_m_per_second

    return rainfall


def storm_rainfall(
    peak_mm_per_hour: float = 100.0,
    ramp_seconds: float = 600.0,
    peak_seconds: float = 1800.0,
    total_seconds: float = 3600.0,
) -> callable:
    """
    Create a simple triangular/trapezoidal storm.

    Timeline:

        0 ------------------------------> time

        ramp       peak          decay
        /---------\________________
       /
      0

    Returns rainfall intensity in metres/second.
    """

    if peak_mm_per_hour < 0:
        raise ValueError("Peak rainfall cannot be negative.")

    if ramp_seconds <= 0:
        raise ValueError("ramp_seconds must be positive.")

    if peak_seconds < ramp_seconds:
        raise ValueError("peak_seconds must be >= ramp_seconds.")

    if total_seconds <= peak_seconds:
        raise ValueError("total_seconds must be > peak_seconds.")

    peak = peak_mm_per_hour / 1000.0 / 3600.0

    decay_seconds = total_seconds - peak_seconds

    def rainfall(time_seconds: float) -> float:
        if time_seconds < 0:
            return 0.0

        if time_seconds <= ramp_seconds:
            return peak * time_seconds / ramp_seconds

        if time_seconds <= peak_seconds:
            return peak

        if time_seconds <= total_seconds:
            fraction = (
                time_seconds - peak_seconds
            ) / decay_seconds

            return peak * (1.0 - fraction)

        return 0.0

    return rainfall