// Runs EPA SWMM in the browser (5.2.2, compiled to WebAssembly by
// @fileops/swmm-wasm-web). The engine is loaded on first use (~730 KB).

type SwmmModule = {
  FS: { writeFile(path: string, data: string): void; readFile(path: string, options: { encoding: "utf8" }): string };
  ccall(name: string, returnType: "number", argTypes: string[], args: string[]): number;
};

export async function runSwmm(input: string): Promise<{ code: number; report: string }> {
  const { default: createModule } = (await import("@fileops/swmm-wasm-web")) as { default: (options: object) => Promise<SwmmModule> };
  // A fresh instance per run keeps runs independent (the C engine uses globals).
  const swmm = await createModule({ print: () => {}, printErr: () => {} });
  swmm.FS.writeFile("/model.inp", input);
  const code = swmm.ccall("swmm_run", "number", ["string", "string", "string"], ["/model.inp", "/model.rpt", "/model.out"]);
  return { code, report: swmm.FS.readFile("/model.rpt", { encoding: "utf8" }) };
}
