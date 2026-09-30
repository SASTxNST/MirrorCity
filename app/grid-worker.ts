// Runs pandapower (power-grid load flow) in the browser via Pyodide: the
// district grid model (scripts/grid, bundled unchanged) for the app, and
// standard test networks for /lab/grid.
//
// pandapower 3.5.5 pins pandas ~= 2.3 and a few newer helpers than Pyodide
// ships; its results under Pyodide's pandas 3 match native pandapower to
// machine precision (#38), so it is installed without dependency checks
// (deps=False) alongside its pure-Python dependencies: deepdiff 9.0.0 because
// 9.1 needs cachebox (compiled Rust, not in Pyodide), and networkx as a bare
// wheel because Pyodide's networkx package drags in matplotlib.
//
// Everything is self-hosted: scripts/vendor-pyodide.mjs downloads the pinned,
// checksum-verified packages into public/pyodide/ and lists them in
// grid-packages.json. Without that manifest (a build that skipped the
// prebuild step) the same versions come from the Pyodide CDN and PyPI.

const sources = import.meta.glob("../scripts/grid/*.py", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const PYODIDE_CORE = "/pyodide/";
const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const FALLBACK = {
  pyodide: ["micropip", "numpy", "pandas", "scipy", "packaging", "tqdm", "typing-extensions", "pydantic"],
  wheels: [`${PYODIDE_CDN}networkx-3.6.1-py3-none-any.whl`, "pandapower==3.5.5", "pandera==0.32.1", "deepdiff==9.0.0", "orderly-set==5.5.0", "geojson==3.3.0", "colorama==0.4.6", "typeguard==4.6.0", "typing-inspect==0.9.0", "mypy-extensions==1.1.0"],
};

type Pyodide = {
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: string): void };
  globals: { set(name: string, value: unknown): void };
  loadPackage(names: string[], options?: { messageCallback?: () => void }): Promise<unknown>;
  runPython(code: string): unknown;
  runPythonAsync(code: string): Promise<unknown>;
};

const worker = self as unknown as { postMessage(message: unknown): void; onmessage: ((event: MessageEvent<{ network: string } | { district: { population: number; buildings: unknown[] } }>) => void) | null };

let booting: Promise<Pyodide> | null = null;

async function boot(): Promise<Pyodide> {
  const manifest: { pyodide: string[]; wheels: string[] } | null = await fetch(`${PYODIDE_CORE}grid-packages.json`)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  const packages = manifest
    ? { pyodide: manifest.pyodide, wheels: manifest.wheels.map((file) => new URL(`${PYODIDE_CORE}${file}`, self.location.origin).href) }
    : FALLBACK;

  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_CORE}pyodide.mjs`);
  const pyodide: Pyodide = await loadPyodide({ indexURL: PYODIDE_CORE, ...(manifest ? {} : { packageBaseUrl: PYODIDE_CDN }) });
  await pyodide.loadPackage(packages.pyodide, { messageCallback: () => {} });
  await pyodide.runPythonAsync(`import micropip\nawait micropip.install(${JSON.stringify(packages.wheels)}, deps=False)`);
  pyodide.FS.mkdirTree("/app/grid");
  for (const [path, code] of Object.entries(sources)) pyodide.FS.writeFile(`/app/grid/${path.split("/").pop()}`, code);
  pyodide.runPython(`
import json, sys, time, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, "/app")
from grid.district_grid import run as district_run
import pandapower as pp, pandapower.networks as pn

NETWORKS = {
    "cigre_mv": lambda: pn.create_cigre_network_mv(with_der="pv_wind"),
    "case30": pn.case30,
    "case118": pn.case118,
}

def load_flow(name):
    net = NETWORKS[name]()
    started = time.time()
    pp.runpp(net, numba=False)
    lines = net.res_line
    return json.dumps({
        "ms": (time.time() - started) * 1000,
        "buses": len(net.bus),
        "lines": len(net.line),
        "vm_min": float(net.res_bus.vm_pu.min()),
        "vm_max": float(net.res_bus.vm_pu.max()),
        "loading_max": float(lines.loading_percent.max()),
        "busiest_line": str(net.line.name.get(lines.loading_percent.idxmax()) or lines.loading_percent.idxmax()),
        "losses_mw": float(lines.pl_mw.sum() + (net.res_trafo.pl_mw.sum() if len(net.trafo) else 0.0)),
        "grid_import_mw": float(net.res_ext_grid.p_mw.sum()),
    })
`);
  return pyodide;
}

worker.onmessage = async ({ data }) => {
  const started = performance.now();
  try {
    booting ??= boot().catch((error) => { booting = null; throw error; });
    const pyodide = await booting;
    const booted = performance.now();
    if ("district" in data) pyodide.globals.set("district_input", JSON.stringify(data.district));
    const result = JSON.parse(pyodide.runPython("district" in data
      ? "json.dumps(district_run(**json.loads(district_input)))"
      : `load_flow(${JSON.stringify(data.network)})`) as string);
    worker.postMessage({ ok: true, result, bootMs: booted - started });
  } catch (error) {
    worker.postMessage({ ok: false, error: String(error).split("\n").filter(Boolean).pop() });
  }
};
