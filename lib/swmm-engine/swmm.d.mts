// Types for swmm.mjs (Emscripten build of EPA SWMM; see scripts/build-swmm-wasm.sh).
export type SwmmModule = {
  FS: { writeFile(path: string, data: string): void; readFile(path: string, options: { encoding: "utf8" }): string };
  ccall(name: string, returnType: "number", argTypes: string[], args: Array<number | string>): number;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
};

export default function createSwmm(options?: { print?: (text: string) => void; printErr?: (text: string) => void }): Promise<SwmmModule>;
