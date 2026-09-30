"""
Two-way coupling between the flood grid and a storm-drain network (EPA SWMM).

Each flood step, every inlet takes street water from its cell up to its
grate capacity (weir equation). Every EXCHANGE_SECONDS the captured water
is handed to SWMM as a steady inflow for the next interval; water that
overflows a manhole (pipes backed up) comes back onto the street at that
inlet's cell.

The SWMM engine is supplied by the caller (in the browser: the WebAssembly
build in lib/swmm-engine, see app/flood-worker.ts). It needs:

    open(input_text) · index(node_name) -> int · set_inflow(index, m3_per_s)
    stride(seconds) · overflow(index) -> m3_per_s · inflow(index) -> m3_per_s
    close()
"""

from __future__ import annotations

import re

import numpy as np

# Grate inlet in a sag: Q = Cw · P · h^1.5 (FHWA HEC-22 weir coefficient, SI),
# for an assumed 0.6 m × 0.3 m grate.
WEIR_COEFFICIENT = 1.66
GRATE_PERIMETER_M = 1.8

EXCHANGE_SECONDS = 5

# SWMM engine used by run_simulation --drains; set by the caller (the browser
# worker installs the WebAssembly engine here before running).
ENGINE = None


class DrainageCoupling:
    """Moves water between flood-grid cells and SWMM inlet nodes."""

    def __init__(self, engine, swmm_input: str, dx: float, dy: float) -> None:

        self.engine = engine
        self.cell_area = dx * dy

        # [COORDINATES] holds each inlet's grid column and row.
        section = swmm_input.split("[COORDINATES]", 1)[1].split("\n[", 1)[0]
        inlets = re.findall(r"^(\S+)\s+(\d+)\s+(\d+)\s*$", section, re.MULTILINE)
        self.names = [name for name, _, _ in inlets]
        self.rows = np.array([int(row) for _, _, row in inlets])
        self.cols = np.array([int(col) for _, col, _ in inlets])
        outfall = re.search(r"\[OUTFALLS\][^\[]*?^(?!;;)(\S+)", swmm_input, re.MULTILINE).group(1)

        engine.open(swmm_input)
        self.nodes = [engine.index(name) for name in self.names]
        self.outfall = engine.index(outfall)

        self.pending = np.zeros(len(self.names))  # m³ captured since the last exchange
        self.elapsed = 0.0

        # Bookkeeping (m³).
        self.captured = 0.0
        self.returned = 0.0
        self.discharged = 0.0
        self.backed_up = np.zeros(len(self.names), dtype=bool)

    def step(self, depth: np.ndarray, dt: float) -> None:
        """Capture water at the inlets for one flood step, exchanging with SWMM when due."""

        cells = (self.rows, self.cols)
        grate_rate = WEIR_COEFFICIENT * GRATE_PERIMETER_M * depth[cells] ** 1.5
        taken = np.minimum(depth[cells] * self.cell_area, grate_rate * dt)
        depth[cells] -= taken / self.cell_area
        self.pending += taken
        self.captured += float(taken.sum())

        self.elapsed += dt
        if self.elapsed >= EXCHANGE_SECONDS:
            self._exchange(depth, self.elapsed)
            self.elapsed = 0.0

    def _exchange(self, depth: np.ndarray, interval: float) -> None:

        for node, volume in zip(self.nodes, self.pending):
            self.engine.set_inflow(node, float(volume) / interval)
        self.pending[:] = 0.0

        self.engine.stride(int(round(interval)))

        overflow = np.array([self.engine.overflow(node) for node in self.nodes]) * interval
        np.add.at(depth, (self.rows, self.cols), overflow / self.cell_area)
        self.returned += float(overflow.sum())
        self.backed_up |= overflow > 0.0
        self.discharged += self.engine.inflow(self.outfall) * interval

    def close(self) -> None:
        self.engine.close()

    @property
    def in_pipes(self) -> float:
        """Water still in the pipes or waiting to be handed over (m³)."""
        return self.captured - self.returned - self.discharged
