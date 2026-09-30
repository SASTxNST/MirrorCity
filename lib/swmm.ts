// Runs EPA SWMM 5.2.4 in the browser (or Node): lib/swmm-engine/swmm.mjs is
// built from EPA's source by scripts/build-swmm-wasm.sh. Loaded on first use.

export async function runSwmm(input: string): Promise<{ code: number; report: string }> {
  const { default: createSwmm } = await import("./swmm-engine/swmm.mjs");
  // A fresh instance per run keeps runs independent (the C engine uses globals).
  const swmm = await createSwmm({ print: () => {}, printErr: () => {} });
  swmm.FS.writeFile("/model.inp", input);
  const code = swmm.ccall("swmm_run", "number", ["string", "string", "string"], ["/model.inp", "/model.rpt", "/model.out"]);
  return { code, report: swmm.FS.readFile("/model.rpt", { encoding: "utf8" }) };
}

// SWMM toolkit codes (EPA swmm5.h).
const SWMM_NODE = 2;
const NODE_INFLOW = 307;
const NODE_OVERFLOW = 308;
const NODE_LATFLOW = 306;

// A SWMM run advanced step by step by the caller, for two-way coupling with
// the flood model (scripts/flood/drainage.py calls these from Python).
// Flows are in the input's FLOW_UNITS.
export async function createSwmmStepper() {
  const { default: createSwmm } = await import("./swmm-engine/swmm.mjs");
  const swmm = await createSwmm({ print: () => {}, printErr: () => {} });
  const call = (name: string, args: Array<number | string>, types = args.map((arg) => (typeof arg === "string" ? "string" : "number"))) => swmm.ccall(name, "number", types, args);
  const elapsed = swmm._malloc(8);

  const check = (code: number, action: string) => {
    if (code) throw new Error(`SWMM ${action} failed (error ${code}); see /drains.rpt`);
  };

  return {
    open(input: string) {
      swmm.FS.writeFile("/drains.inp", input);
      check(call("swmm_open", ["/drains.inp", "/drains.rpt", "/drains.out"]), "open");
      check(call("swmm_start", [0]), "start");
    },
    index: (name: string) => call("swmm_getIndex", [SWMM_NODE, name]),
    set_inflow: (index: number, flow: number) => call("swmm_setValue", [NODE_LATFLOW, index, flow]),
    stride: (seconds: number) => check(call("swmm_stride", [seconds, elapsed]), "step"),
    overflow: (index: number) => call("swmm_getValue", [NODE_OVERFLOW, index]),
    inflow: (index: number) => call("swmm_getValue", [NODE_INFLOW, index]),
    close() {
      call("swmm_end", []);
      call("swmm_close", []);
      swmm._free(elapsed);
    },
  };
}
