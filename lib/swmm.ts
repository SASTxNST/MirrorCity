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
