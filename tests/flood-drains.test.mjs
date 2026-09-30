import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadPyodide } from "pyodide";
import { createSwmmStepper } from "../lib/swmm.ts";

// The flood model coupled with its storm drains, run exactly as the browser
// worker runs it: Python (Pyodide) exchanging water with EPA SWMM (WebAssembly).
const root = new URL("../", import.meta.url);
const drains = readFileSync(new URL("scripts/flood/data/lidar-street-drains.inp", root), "utf8");

test("SWMM stepper: an overloaded drain spills the excess back out", async () => {
  const swmm = await createSwmmStepper();
  swmm.open(drains);
  const [top, outfall] = [swmm.index("IN7"), swmm.index("OUTFALL")];
  swmm.set_inflow(top, 0.4); // m³/s, far beyond what the pipes can carry
  for (let step = 0; step < 60; step += 1) swmm.stride(5);
  const [out, spill] = [swmm.inflow(outfall), swmm.overflow(top)];
  swmm.close();

  assert.ok(spill > 0.1, `spill ${spill} m³/s`);
  assert.ok(Math.abs(out + spill - 0.4) < 0.004, "inflow = outfall + spill once steady");
});

test("coupled flood + storm drains: drains take water and the budget balances", { timeout: 120_000 }, async () => {
  // Pyodide's NumPy wheel is vendored into public/pyodide by the prebuild step.
  // A plain path: Pyodide treats a file:// URL as a relative cache folder.
  const pyodide = await loadPyodide({ packageBaseUrl: fileURLToPath(new URL("public/pyodide/", root)) });
  await pyodide.loadPackage("numpy", { messageCallback: () => {} });
  pyodide.FS.mkdirTree("/app/flood");
  const flood = new URL("scripts/flood/", root);
  for (const file of readdirSync(flood).filter((name) => name.endsWith(".py"))) pyodide.FS.writeFile(`/app/flood/${file}`, readFileSync(new URL(file, flood), "utf8"));
  pyodide.FS.writeFile("/app/street.npz", readFileSync(new URL("data/lidar-street.npz", flood)));
  pyodide.FS.writeFile("/app/drains.inp", drains);

  pyodide.globals.set("swmm_engine", await createSwmmStepper());
  pyodide.globals.set("cli_args", ["run_simulation", "--rainfall", "100", "--duration", "3600", "--output", "/tmp/out", "--terrain", "/app/street.npz", "--open-edges", "--drains", "/app/drains.inp"]);
  pyodide.runPython(`
import sys, io, contextlib
sys.path.insert(0, "/app")
import flood.drainage
flood.drainage.ENGINE = swmm_engine
sys.argv = [str(arg) for arg in cli_args]
from flood.run_simulation import main
with contextlib.redirect_stdout(io.StringIO()):
    main()
`);
  const { results } = JSON.parse(pyodide.FS.readFile("/tmp/out/summary.json", { encoding: "utf8" }));
  const network = results.drain_network;

  assert.equal(network.inlets, 7);
  assert.ok(network.captured_m3 > 50, `captured ${network.captured_m3} m³`);

  // Rain reaching the street = soaked + drained + still on the street + left the model.
  const rain = results.drained_m3 / results.rain_drained_fraction;
  const accounted = results.rain_soaked_in_fraction * rain + results.drained_m3 + results.water_volume_m3 + results.boundary_outflow_m3;
  assert.ok(Math.abs(accounted - rain) / rain < 1e-6, `rain ${rain} m³ vs accounted ${accounted} m³`);
});
