// Copies the Pyodide runtime (npm `pyodide`) and its NumPy wheel into
// public/pyodide/ so the flood worker loads Python from our own origin.
// NumPy isn't in the npm package: it's downloaded once from the matching
// jsDelivr release and checked against the SHA-256 in pyodide-lock.json.
// Runs before `dev` and `build`; public/pyodide/ is git-ignored.

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const source = path.dirname(require.resolve("pyodide/package.json"));
const { version } = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
const target = "public/pyodide";

await mkdir(target, { recursive: true });

for (const file of ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]) {
  await copyFile(path.join(source, file), path.join(target, file));
}

const lock = JSON.parse(await readFile(path.join(source, "pyodide-lock.json"), "utf8"));
const numpy = lock.packages.numpy;
const wheel = path.join(target, numpy.file_name);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

if (!existsSync(wheel) || sha256(await readFile(wheel)) !== numpy.sha256) {
  const url = `https://cdn.jsdelivr.net/pyodide/v${version}/full/${numpy.file_name}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't download ${url}: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (sha256(data) !== numpy.sha256) throw new Error(`${numpy.file_name} failed its checksum`);
  await writeFile(wheel, data);
}

console.log(`Pyodide ${version} + ${numpy.file_name} ready in ${target}/`);
