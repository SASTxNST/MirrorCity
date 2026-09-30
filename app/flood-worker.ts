// Runs the Python flood solver (scripts/flood) in the browser via Pyodide.
// The .py files are bundled unchanged and executed through the solver's own
// CLI entry point, so results match `npm run flood:run` for the same inputs.

// LiDAR street scan grid, built by `python3 -m scripts.flood.lidar_terrain`.
import lidarStreetUrl from "../scripts/flood/data/lidar-street.npz?url";
// Its illustrative storm drains, built by `python3 -m scripts.flood.storm_drains`.
import streetDrains from "../scripts/flood/data/lidar-street-drains.inp?raw";
import { createSwmmStepper } from "../lib/swmm";

// Pyodide is served from our own origin (scripts/vendor-pyodide.mjs copies it
// into public/pyodide/ before dev and build). If that copy is missing, e.g. a
// build that skipped the prebuild step, fall back to the same release on jsDelivr.
const PYODIDE_URLS = ["/pyodide/", "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/"];

const sources = import.meta.glob("../scripts/flood/*.py", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

type Pyodide = {
  loadPackage(name: string): Promise<unknown>;
  runPython(code: string): unknown;
  globals: { set(name: string, value: unknown): void };
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: string | Uint8Array): void; readFile(path: string, options: { encoding: "utf8" }): string };
};

const worker = self as unknown as { postMessage(message: unknown): void; onmessage: ((event: MessageEvent<{ rainfall: number; duration: number; terrain?: "lidar-street"; drains?: boolean }>) => void) | null };

let booting: Promise<Pyodide> | null = null;

async function boot(): Promise<Pyodide> {
  let loaded: { loadPyodide(options: { indexURL: string }): Promise<Pyodide> } | undefined;
  let indexURL = "";
  for (const url of PYODIDE_URLS) {
    indexURL = url;
    loaded = await import(/* @vite-ignore */ `${url}pyodide.mjs`).catch(() => undefined);
    if (loaded) break;
  }
  if (!loaded) throw new Error("Couldn't load Python (Pyodide)");
  const pyodide = await loaded.loadPyodide({ indexURL });
  await pyodide.loadPackage("numpy");
  pyodide.FS.mkdirTree("/app/flood");
  for (const [path, code] of Object.entries(sources)) pyodide.FS.writeFile(`/app/flood/${path.split("/").pop()}`, code);
  pyodide.FS.writeFile("/app/lidar-street.npz", new Uint8Array(await (await fetch(lidarStreetUrl)).arrayBuffer()));
  pyodide.FS.writeFile("/app/lidar-street-drains.inp", streetDrains);
  pyodide.runPython("import sys; sys.path.insert(0, '/app')");
  return pyodide;
}

worker.onmessage = async ({ data }) => {
  const started = performance.now();
  try {
    booting ??= boot().catch((error) => { booting = null; throw error; });
    const pyodide = await booting;
    const booted = performance.now();
    // Storm drains: the solver exchanges water with EPA SWMM (WebAssembly) through this engine.
    pyodide.globals.set("swmm_engine", data.drains ? await createSwmmStepper() : null);
    pyodide.runPython("import flood.drainage\nflood.drainage.ENGINE = swmm_engine");
    pyodide.globals.set("cli_args", ["run_simulation", "--rainfall", String(Number(data.rainfall)), "--duration", String(Number(data.duration)), "--output", "/tmp/flood-out",
      // Roughness, infiltration, roofs, walls and survey edges come from the grid's layers; water may also leave at the grid border.
      ...(data.terrain === "lidar-street" ? ["--terrain", "/app/lidar-street.npz", "--open-edges"] : []),
      ...(data.drains ? ["--drains", "/app/lidar-street-drains.inp"] : [])]);
    pyodide.runPython("import sys\nsys.argv = [str(a) for a in cli_args]\nfrom flood.run_simulation import main\nmain()");
    const summary = JSON.parse(pyodide.FS.readFile("/tmp/flood-out/summary.json", { encoding: "utf8" }));
    worker.postMessage({ ok: true, summary, bootMs: booted - started, runMs: performance.now() - booted });
  } catch (error) {
    worker.postMessage({ ok: false, error: String(error).split("\n").filter(Boolean).pop() });
  }
};
