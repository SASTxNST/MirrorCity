"""
Checks for the illustrative district grid (run: npm run grid:test).

district_buildings.json mirrors the `buildings` list in app/page.tsx.
"""

from __future__ import annotations

import json
from pathlib import Path

from .district_grid import DESIGN_POPULATION, VOLTAGE_LIMIT_PU, build, run

BUILDINGS = json.loads((Path(__file__).parent / "district_buildings.json").read_text())


def test_power_balance() -> None:
    """Grid import = building load + cable and transformer losses."""

    r = run(2000, BUILDINGS)
    print(f"Power balance: import {r['grid_import_kw']:.3f} kW = load {r['load_kw']:.3f} + losses {r['losses_kw']:.3f}")
    assert abs(r["grid_import_kw"] - (r["load_kw"] + r["losses_kw"])) < 1e-6


def test_design_case_meets_design_rules() -> None:
    """At the design population: transformers and cables <= 80%, supply >= 0.96 p.u."""

    net = build(DESIGN_POPULATION, BUILDINGS)
    import pandapower as pp

    pp.runpp(net, numba=False)
    trafo = float(net.res_trafo.loading_percent.iloc[0])
    cables = float(net.res_line.loading_percent.max())
    lowest = float(net.res_bus.vm_pu.loc[net.line.to_bus].min())
    print(f"Design case: transformers {trafo:.1f}%, worst cable {cables:.1f}%, lowest supply {lowest:.4f} p.u.")
    assert trafo <= 80 and cables <= 80 and lowest >= 0.96


def test_growth_uses_up_headroom() -> None:
    """More residents: more load, lower voltage; far beyond design, out of limits."""

    results = [run(people, BUILDINGS) for people in (1500, 2000, 2500, 3500)]
    loading = [r["transformer_loading_percent"] for r in results]
    lowest = [r["lowest_voltage_pu"] for r in results]
    print(f"Growth: transformer load {[round(x, 1) for x in loading]} %, lowest voltage {[round(x, 3) for x in lowest]} p.u.")
    assert loading == sorted(loading) and lowest == sorted(lowest, reverse=True)
    assert results[2]["buildings_below_limit"] == 0, "the slider's top end stays in limits"
    assert results[3]["buildings_below_limit"] > 0 and results[3]["lowest_voltage_pu"] < VOLTAGE_LIMIT_PU


if __name__ == "__main__":
    test_power_balance()
    test_design_case_meets_design_rules()
    test_growth_uses_up_headroom()
    print("\nAll district-grid checks passed.")
