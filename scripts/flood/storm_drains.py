"""
Illustrative storm-drain network under the LiDAR street, as EPA SWMM input.

There is no surveyed drainage data for the scanned street, so the network
is designed from the terrain grid with common rules of thumb; every value
below is an assumption:

- Inlets on road cells, lowest first, at least INLET_SPACING_M apart.
- Each inlet pipes to the nearest inlet lower than itself; the lowest inlet
  pipes to an outfall where the street leaves the scan.
- Pipes sized by the Rational method (Q = C i A) for DESIGN_RAIN_MM_PER_HOUR,
  smallest standard size >= 300 mm (CPHEEO minimum for storm drains),
  laid at least MIN_COVER_M deep and MIN_SLOPE steep.

    python3 -m scripts.flood.storm_drains

writes scripts/flood/data/lidar-street-drains.inp. Inlet cells are stored
in its [COORDINATES] section as grid column, row.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .terrain import load_layer, load_terrain

TERRAIN = Path("scripts/flood/data/lidar-street.npz")
OUTPUT = Path("scripts/flood/data/lidar-street-drains.inp")

INLET_SPACING_M = 20.0
DESIGN_RAIN_MM_PER_HOUR = 50.0
RUNOFF_COEFFICIENT = {"road": 0.9, "concrete": 0.85, "grass": 0.3, "": 0.9}  # "" = roofs
PIPE_SIZES_M = [0.3, 0.375, 0.45, 0.6, 0.75, 0.9]
MANNING_N = 0.013
MIN_COVER_M = 1.0
MIN_SLOPE = 1 / 300


def full_flow(diameter: float, slope: float) -> float:
    """Manning full-pipe capacity [m³/s]."""

    area = np.pi * diameter**2 / 4
    return area * (diameter / 4) ** (2 / 3) * np.sqrt(slope) / MANNING_N


def design() -> tuple[list[dict], list[dict], dict]:
    """Inlets (junctions), pipes and the outfall for the street grid."""

    elevation, dx, dy = load_terrain(TERRAIN)
    surface = load_layer(TERRAIN, "surface")
    street = ~load_layer(TERRAIN, "obstacles").astype(bool) & ~load_layer(TERRAIN, "outside").astype(bool)
    roofs = load_layer(TERRAIN, "roofs").astype(bool)

    # Inlets: road cells, lowest first, spaced apart.
    road = np.argwhere(street & (surface == "road"))
    road = road[np.argsort(elevation[tuple(road.T)])]
    cells: list[tuple[int, int]] = []
    for j, i in road:
        if all(np.hypot((i - ci) * dx, (j - cj) * dy) >= INLET_SPACING_M for cj, ci in cells):
            cells.append((int(j), int(i)))

    inlets = [{"name": f"IN{k + 1}", "cell": cell, "ground": float(elevation[cell])} for k, cell in enumerate(cells)]

    # Catchment of each inlet: street and roof cells nearest to it.
    drained = np.argwhere(street | roofs)
    distances = np.stack([np.hypot((drained[:, 1] - i) * dx, (drained[:, 0] - j) * dy) for j, i in cells])
    nearest = distances.argmin(axis=0)
    for k, inlet in enumerate(inlets):
        members = drained[nearest == k]
        coefficient = np.array([RUNOFF_COEFFICIENT[surface[j, i]] for j, i in members])
        inlet["ca_m2"] = float(coefficient.sum() * dx * dy)

    # Downstream links: nearest lower inlet; the lowest inlet feeds the outfall.
    outlet = inlets[0]
    outfall = {"name": "OUTFALL", "cell": outlet["cell"], "ground": outlet["ground"]}
    for inlet in inlets[1:]:
        lower = [other for other in inlets if other["ground"] < inlet["ground"]]
        inlet["to"] = min(lower, key=lambda other: np.hypot((other["cell"][1] - inlet["cell"][1]) * dx, (other["cell"][0] - inlet["cell"][0]) * dy))
    outlet["to"] = outfall

    # Accumulate design flow downstream (highest inlets first).
    for inlet in inlets:
        inlet["ca_total"] = inlet["ca_m2"]
    for inlet in sorted(inlets[1:], key=lambda item: -item["ground"]):
        inlet["to"]["ca_total"] += inlet["ca_total"]

    pipes = []
    for inlet in sorted(inlets, key=lambda item: -item["ground"]):
        downstream = inlet["to"]
        length = max(float(np.hypot((downstream["cell"][1] - inlet["cell"][1]) * dx, (downstream["cell"][0] - inlet["cell"][0]) * dy)), 5.0)
        flow = inlet["ca_total"] * DESIGN_RAIN_MM_PER_HOUR / 1000 / 3600
        slope = max(MIN_SLOPE, (inlet["ground"] - downstream["ground"]) / length)
        diameter = next((size for size in PIPE_SIZES_M if full_flow(size, slope) >= flow), PIPE_SIZES_M[-1])
        pipes.append({"name": f"P{len(pipes) + 1}", "from": inlet, "to": downstream, "length": length, "diameter": diameter, "slope": slope, "design_flow": flow})

    # Inverts, upstream to downstream: min cover, pipe slope, never uphill.
    for node in inlets + [outfall]:
        node["invert"] = np.inf
    for pipe in pipes:
        start = min(pipe["from"]["invert"], pipe["from"]["ground"] - MIN_COVER_M - pipe["diameter"])
        pipe["from"]["invert"] = start
        pipe["to"]["invert"] = min(pipe["to"]["invert"], start - pipe["slope"] * pipe["length"])
    outfall["invert"] = min(outfall["invert"], outlet["invert"] - MIN_SLOPE * 5.0)

    return inlets, pipes, outfall


def swmm_input(inlets: list[dict], pipes: list[dict], outfall: dict) -> str:
    """SWMM input; inflows are set at run time through the SWMM API."""

    junctions = "\n".join(f"{n['name']} {n['invert']:.3f} {n['ground'] - n['invert']:.3f}" for n in inlets)
    conduits = "\n".join(f"{p['name']} {p['from']['name']} {p['to']['name']} {p['length']:.2f} {MANNING_N} 0 0" for p in pipes)
    sections = "\n".join(f"{p['name']} CIRCULAR {p['diameter']} 0 0 0 1" for p in pipes)
    coordinates = "\n".join(f"{n['name']} {n['cell'][1]} {n['cell'][0]}" for n in inlets)

    return f"""[TITLE]
MirrorCity illustrative storm drains under the LiDAR street (designed, not surveyed)

[OPTIONS]
FLOW_UNITS           CMS
FLOW_ROUTING         DYNWAVE
START_DATE           01/01/2026
START_TIME           00:00:00
END_DATE             01/02/2026
END_TIME             00:00:00
REPORT_STEP          00:05:00
ROUTING_STEP         0:00:01
ALLOW_PONDING        NO

[JUNCTIONS]
;;Name Elev MaxDepth
{junctions}

[OUTFALLS]
;;Name Elev Type
{outfall['name']} {outfall['invert']:.3f} FREE

[CONDUITS]
;;Name From To Length Roughness InOffset OutOffset
{conduits}

[XSECTIONS]
;;Link Shape Geom1 Geom2 Geom3 Geom4 Barrels
{sections}

[COORDINATES]
;;Inlet grid column row
{coordinates}

[REPORT]
NODES ALL
LINKS ALL
"""


def main() -> None:

    inlets, pipes, outfall = design()
    OUTPUT.write_text(swmm_input(inlets, pipes, outfall))

    print(f"Wrote {OUTPUT}")
    print(f"Inlets: {len(inlets)}   Pipes: {len(pipes)}   Outfall invert {outfall['invert']:.2f} m")
    for pipe in pipes:
        capacity = full_flow(pipe["diameter"], pipe["slope"])
        print(
            f"  {pipe['name']:4} {pipe['from']['name']:>5} → {pipe['to']['name']:<7} "
            f"{pipe['length']:5.1f} m  Ø{pipe['diameter'] * 1000:.0f} mm  1:{1 / pipe['slope']:.0f}  "
            f"design {pipe['design_flow'] * 1000:5.1f} L/s  capacity {capacity * 1000:5.1f} L/s"
        )


if __name__ == "__main__":
    main()
