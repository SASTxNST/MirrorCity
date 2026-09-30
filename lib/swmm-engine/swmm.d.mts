// Types for swmm.mjs (Emscripten build of EPA SWMM; see scripts/build-swmm-wasm.sh).
export type SwmmModule = {
  FS: { writeFile(path: string, data: string): void; readFile(path: string, options: { encoding: "utf8" }): string };
  ccall(name: "swmm_run", returnType: "number", argTypes: string[], args: string[]): number;
  ccall(name: "swmm_getVersion", returnType: "number", argTypes: [], args: []): number;
};

export default function createSwmm(options?: { print?: (text: string) => void; printErr?: (text: string) => void }): Promise<SwmmModule>;
