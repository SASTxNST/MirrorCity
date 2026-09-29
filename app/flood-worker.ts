// Runs the Python flood solver (scripts/flood) in the browser via Pyodide.
// The .py files are bundled unchanged and executed through the solver's own
// CLI entry point, so results match `npm run flood:run` for the same inputs.

// LiDAR street scan grid, built by `python3 -m scripts.flood.lidar_terrain`.
import lidarStreetUrl from "../scripts/flood/data/lidar-street.npz?url";

// ponytail: loaded from the jsDelivr CDN; self-host the Pyodide files before relying on this in production.
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";

const sources = import.meta.glob("../scripts/flood/*.py", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

type Pyodide = {
  loadPackage(name: string): Promise<unknown>;
  runPython(code: string): unknown;
  globals: { set(name: string, value: unknown): void };
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: string | Uint8Array): void; readFile(path: string, options: { encoding: "utf8" }): string };
};

const worker = self as unknown as { postMessage(message: unknown): void; onmessage: ((event: MessageEvent<{ rainfall: number; duration: number; terrain?: "lidar-street" }>) => void) | null };

let booting: Promise<Pyodide> | null = null;

async function boot(): Promise<Pyodide> {
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`);
  const pyodide: Pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  await pyodide.loadPackage("numpy");
  pyodide.FS.mkdirTree("/app/flood");
  for (const [path, code] of Object.entries(sources)) pyodide.FS.writeFile(`/app/flood/${path.split("/").pop()}`, code);
  pyodide.FS.writeFile("/app/lidar-street.npz", new Uint8Array(await (await fetch(lidarStreetUrl)).arrayBuffer()));
  pyodide.runPython("import sys; sys.path.insert(0, '/app')");
  return pyodide;
}

worker.onmessage = async ({ data }) => {
  const started = performance.now();
  try {
    booting ??= boot().catch((error) => { booting = null; throw error; });
    const pyodide = await booting;
    const booted = performance.now();
    pyodide.globals.set("cli_args", ["run_simulation", "--rainfall", String(Number(data.rainfall)), "--duration", String(Number(data.duration)), "--output", "/tmp/flood-out",
      // The street is mostly paved: ~3.6 mm/h soak-in instead of the soil default, and water may leave where the street runs off the scan.
      ...(data.terrain === "lidar-street" ? ["--terrain", "/app/lidar-street.npz", "--open-edges", "--infiltration-k", "1e-6"] : [])]);
    pyodide.runPython("import sys\nsys.argv = [str(a) for a in cli_args]\nfrom flood.run_simulation import main\nmain()");
    const summary = JSON.parse(pyodide.FS.readFile("/tmp/flood-out/summary.json", { encoding: "utf8" }));
    worker.postMessage({ ok: true, summary, bootMs: booted - started, runMs: performance.now() - booted });
  } catch (error) {
    worker.postMessage({ ok: false, error: String(error).split("\n").filter(Boolean).pop() });
  }
};
