"""
Illustrative low-voltage power grid for the Varuna River Ward (pandapower).

There is no surveyed grid data, so the network is designed from the
district drawing with common Indian distribution practice; every value
below is an assumption:

- Substation E-14 is an 11 / 0.433 kV distribution substation of
  1000 kVA transformers.
- Each occupied building is fed by its own 0.4 kV cable (NAYY 4x150)
  from the substation, routed along the streets (Manhattan distance).
- Sized by simulation for the design case: add transformers until they
  are <= 80% loaded, and parallel cable runs until each is <= 80%
  loaded and delivers >= 0.96 p.u. (a 4% drop budget).
- Evening-peak demand: 0.4 kW per resident (split across residential
  buildings by volume) plus fixed loads per building type; power
  factor 0.9. The design case is 2,000 residents.
- Supply voltage limit: +/- 6% of nominal at the building (CEA
  supply-code limit for LV), so below 0.94 p.u. is out of limits.

    run(population, buildings) -> results dict (JSON-safe)
"""

from __future__ import annotations

import math
import warnings

warnings.filterwarnings("ignore")

import pandapower as pp  # noqa: E402

WARD_M = (600.0, 450.0)  # same ward scale as the sewer and evacuation models
SUBSTATION = "Substation E-14"

HV_KV, LV_KV = 11.0, 0.433
TRANSFORMER_MVA = 1.0
CABLE = "NAYY 4x150 SE"
CABLE_MAX_KA = 0.27
DESIGN_LOADING = 0.8
DESIGN_POPULATION = 2000

KW_PER_RESIDENT = 0.4
POWER_FACTOR = 0.9
RESIDENTIAL = {"Residential", "Mixed use"}
FIXED_KW = {  # evening peak, by building type
    "Critical facility": 250.0,
    "Commercial": 120.0,
    "Government": 40.0,
    "Education": 20.0,
    "Mobility": 60.0,
    "Response center": 40.0,
    "Utilities": 75.0,
    "Energy": 5.0,
}
VOLTAGE_LIMIT_PU = 0.94


def demand_kw(population: float, buildings: list[dict]) -> dict[str, float]:
    """Evening-peak demand per building [kW]."""

    volume = {b["name"]: b["w"] * b["d"] * b["h"] for b in buildings if b["type"] in RESIDENTIAL}
    total = sum(volume.values())
    demand = {}
    for b in buildings:
        if b["type"] in RESIDENTIAL:
            demand[b["name"]] = population * KW_PER_RESIDENT * volume[b["name"]] / total
        elif b["type"] in FIXED_KW:
            demand[b["name"]] = FIXED_KW[b["type"]]
    return demand


def cable_km(a: dict, b: dict) -> float:
    """Street route between two buildings, as Manhattan distance [km]."""

    return (abs(a["x"] - b["x"]) / 100 * WARD_M[0] + abs(a["y"] - b["y"]) / 100 * WARD_M[1]) / 1000


def build(population: float, buildings: list[dict]):
    """pandapower network for `population`, sized for the design case."""

    substation = next(b for b in buildings if b["name"] == SUBSTATION)
    fed = [b for b in buildings if b["name"] in demand_kw(population, buildings)]

    net = pp.create_empty_network(name="Varuna River Ward (illustrative)")
    hv = pp.create_bus(net, HV_KV, name="11 kV supply")
    lv = pp.create_bus(net, LV_KV, name="E-14 LV busbar")
    pp.create_ext_grid(net, hv, vm_pu=1.0)
    pp.create_transformer_from_parameters(
        net, hv, lv, name="E-14",
        sn_mva=TRANSFORMER_MVA, vn_hv_kv=HV_KV, vn_lv_kv=LV_KV,
        vk_percent=5.0, vkr_percent=1.0, pfe_kw=1.8, i0_percent=0.5,
    )
    for b in fed:
        bus = pp.create_bus(net, LV_KV, name=b["name"])
        pp.create_line(net, lv, bus, max(cable_km(substation, b), 0.02), CABLE, name=b["name"])
        pp.create_load(net, bus, p_mw=0.0, name=b["name"])

    def set_loads(people: float) -> None:
        demand = demand_kw(people, buildings)
        net.load.p_mw = [demand[name] / 1000 for name in net.load.name]
        net.load.q_mvar = net.load.p_mw * math.tan(math.acos(POWER_FACTOR))

    # Size for the design case by simulation.
    set_loads(DESIGN_POPULATION)
    for _ in range(50):
        pp.runpp(net, numba=False)
        changed = False
        if net.res_trafo.loading_percent.iloc[0] > DESIGN_LOADING * 100:
            net.trafo.loc[0, "parallel"] += 1
            changed = True
        vm = net.res_bus.vm_pu.loc[net.line.to_bus].to_numpy()
        short = (net.res_line.loading_percent.to_numpy() > DESIGN_LOADING * 100) | (vm < 0.96)
        net.line.loc[short, "parallel"] += 1
        if not (changed or short.any()):
            break
    else:
        raise RuntimeError("Grid sizing did not converge")

    set_loads(population)
    return net


def run(population: float, buildings: list[dict]) -> dict:
    """Load flow for `population`; returns the results the app shows."""

    net = build(population, buildings)
    pp.runpp(net, numba=False)  # the population's own load flow

    supply = {
        name: {"kw": float(load_kw), "vm_pu": float(vm)}
        for name, load_kw, vm in zip(net.load.name, net.res_load.p_mw * 1000, net.res_bus.vm_pu.loc[net.load.bus])
    }
    worst = min(supply, key=lambda name: supply[name]["vm_pu"])
    return {
        "transformer_loading_percent": float(net.res_trafo.loading_percent.iloc[0]),
        "transformers": int(net.trafo.parallel.iloc[0]),
        "load_kw": float(net.res_load.p_mw.sum() * 1000),
        "losses_kw": float((net.res_line.pl_mw.sum() + net.res_trafo.pl_mw.sum()) * 1000),
        "grid_import_kw": float(net.res_ext_grid.p_mw.sum() * 1000),
        "cable_loading_max_percent": float(net.res_line.loading_percent.max()),
        "cable_runs": int(net.line.parallel.sum()),
        "lowest_voltage_pu": supply[worst]["vm_pu"],
        "lowest_voltage_building": worst,
        "buildings_below_limit": sum(1 for s in supply.values() if s["vm_pu"] < VOLTAGE_LIMIT_PU),
        "buildings": supply,
    }
