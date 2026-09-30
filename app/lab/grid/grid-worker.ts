// Spike: runs pandapower (power-grid load flow) in the browser via Pyodide.
//
// pandapower 3.5.5 pins pandas ~= 2.3 and a few newer helpers than Pyodide
// ships; its results under Pyodide's pandas 3 match native pandapower to
// machine precision (see the PR), so the pins are skipped (deps=False) and
// its pure-Python dependencies are installed explicitly.
//
// ponytail: the scientific packages come from the Pyodide CDN and the wheels
// from PyPI at run time; vendor them (like scripts/vendor-pyodide.mjs) before
// using this outside the lab.

const PYODIDE_CORE = "/pyodide/";
const PYODIDE_PACKAGES = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const PACKAGES = ["micropip", "numpy", "pandas", "scipy", "networkx", "packaging", "tqdm", "typing-extensions", "pydantic"];
const WHEELS = [
  "pandapower==3.5.5",
  "pandera~=0.32.0",
  "deepdiff==9.0.0", // 9.1 needs cachebox (compiled Rust), not in Pyodide
  "orderly-set",
  "geojson",
  "colorama",
  "typeguard",
  "typing-inspect",
  "mypy-extensions",
];

type Pyodide = {
  loadPackage(names: string[], options?: { messageCallback?: () => void }): Promise<unknown>;
  runPython(code: string): unknown;
  runPythonAsync(code: string): Promise<unknown>;
};

const worker = self as unknown as { postMessage(message: unknown): void; onmessage: ((event: MessageEvent<{ network: string }>) => void) | null };

let booting: Promise<Pyodide> | null = null;

async function boot(): Promise<Pyodide> {
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_CORE}pyodide.mjs`);
  const pyodide: Pyodide = await loadPyodide({ indexURL: PYODIDE_CORE, packageBaseUrl: PYODIDE_PACKAGES });
  await pyodide.loadPackage(PACKAGES, { messageCallback: () => {} });
  await pyodide.runPythonAsync(`import micropip\nawait micropip.install(${JSON.stringify(WHEELS)}, deps=False)`);
  pyodide.runPython(`
import json, time, warnings
warnings.filterwarnings("ignore")
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
    const result = JSON.parse(pyodide.runPython(`load_flow(${JSON.stringify(data.network)})`) as string);
    worker.postMessage({ ok: true, result, bootMs: booted - started });
  } catch (error) {
    worker.postMessage({ ok: false, error: String(error).split("\n").filter(Boolean).pop() });
  }
};
