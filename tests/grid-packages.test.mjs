import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadPyodide } from "pyodide";

// The power-grid model must run from the self-hosted files alone: the Pyodide
// packages and wheels scripts/vendor-pyodide.mjs puts in public/pyodide (the
// prebuild step), installed from local files with no network, as the grid
// worker does. A dependency missing from the vendored set fails the import.
const root = new URL("../", import.meta.url);
const vendored = fileURLToPath(new URL("public/pyodide/", root));

test("district grid runs from the self-hosted pandapower packages", { timeout: 180_000 }, async () => {
  const manifest = JSON.parse(readFileSync(`${vendored}grid-packages.json`, "utf8"));
  const pyodide = await loadPyodide({ packageBaseUrl: vendored, packageCacheDir: vendored });
  await pyodide.loadPackage(manifest.pyodide, { messageCallback: () => {} });

  pyodide.FS.mkdirTree("/wheels");
  for (const file of manifest.wheels) pyodide.FS.writeFile(`/wheels/${file}`, readFileSync(`${vendored}${file}`));
  pyodide.globals.set("wheels", manifest.wheels.map((file) => `emfs:/wheels/${file}`));
  await pyodide.runPythonAsync("import micropip\nawait micropip.install(list(wheels), deps=False)");

  pyodide.FS.mkdirTree("/app/grid");
  const grid = new URL("scripts/grid/", root);
  for (const file of readdirSync(grid).filter((name) => name.endsWith(".py"))) pyodide.FS.writeFile(`/app/grid/${file}`, readFileSync(new URL(file, grid), "utf8"));
  pyodide.globals.set("buildings_json", readFileSync(new URL("district_buildings.json", grid), "utf8"));

  const result = JSON.parse(pyodide.runPython(`
import sys, io, json
sys.stderr = io.StringIO()
sys.path.insert(0, "/app")
from grid.district_grid import run
json.dumps(run(2000, json.loads(buildings_json)))
`));

  // Same design case as npm run grid:test (native pandapower): 54.5%.
  assert.equal(result.transformers, 3);
  assert.ok(Math.abs(result.transformer_loading_percent - 54.5) < 0.1, `transformer ${result.transformer_loading_percent}%`);
  assert.equal(result.buildings_below_limit, 0);
});
