// Copies the Pyodide runtime (npm `pyodide`) into public/pyodide/ and adds
// the packages our Python models need, so the flood and grid workers load
// everything from our own origin: NumPy (flood); pandas, SciPy, pandapower
// and their dependencies (power grid, ~30 MB, loaded only when a load flow
// is run). Packages aren't in the npm package, so each is downloaded once and
// checked against a pinned SHA-256 (pyodide-lock.json for Pyodide builds,
// PyPI digests for the wheels below). Runs before `dev` and `build`;
// public/pyodide/ is git-ignored.

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
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

// Downloads `file` into public/pyodide once, refusing it unless it matches `expected`.
async function vendor(file, url, expected) {
  const destination = path.join(target, file);
  if (existsSync(destination) && sha256(await readFile(destination)) === expected) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't download ${url}: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (sha256(data) !== expected) throw new Error(`${file} failed its checksum`);
  await writeFile(destination, data);
}

// Pyodide-built packages (checksums from pyodide-lock.json): NumPy for the
// flood model; pandas, SciPy etc. for the power-grid model, with everything
// they depend on.
const normalise = (name) => name.toLowerCase().replaceAll("_", "-");
const byName = new Map(Object.keys(lock.packages).map((name) => [normalise(name), name]));
const needed = new Set();
const pending = ["numpy", "micropip", "pandas", "scipy", "packaging", "tqdm", "typing-extensions", "pydantic"];
while (pending.length) {
  const name = byName.get(normalise(pending.pop()));
  if (needed.has(name)) continue;
  needed.add(name);
  pending.push(...lock.packages[name].depends);
}
// networkx is pure Python, but Pyodide lists matplotlib as its dependency
// (for drawing, which pandapower doesn't use): ship the wheel and install
// it without dependencies instead.
const networkx = lock.packages.networkx;
for (const name of [...needed, "networkx"]) {
  const { file_name: file, sha256: expected } = lock.packages[name];
  await vendor(file, `https://cdn.jsdelivr.net/pyodide/v${version}/full/${file}`, expected);
}

// pandapower and its pure-Python dependencies from PyPI, pinned by hash.
// See app/grid-worker.ts for why these versions.
const PYPI_WHEELS = [
  { file: "pandapower-3.5.5-py3-none-any.whl", url: "https://files.pythonhosted.org/packages/20/94/385fd8f85ed6d714fdee4a27154f750e0ce533433b386913822534f8efa9/pandapower-3.5.5-py3-none-any.whl", sha256: "119f1034e015fb59ef040542ca932592442afc6268e6788d7bf6cbc783bc39a5" },
  { file: "pandera-0.32.1-py3-none-any.whl", url: "https://files.pythonhosted.org/packages/ca/d0/411c82285a7586e97326020f6b5ecbc2f2ffcbef72aa108c897de1b0a540/pandera-0.32.1-py3-none-any.whl", sha256: "1a17a3ffa906174d19207715f4f082ec3db3709647927ad8c095c147d74d8454" },
  { file: "deepdiff-9.0.0-py3-none-any.whl", url: "https://files.pythonhosted.org/packages/dc/c4/da7089cd7aa4ab554f56e18a7fb08dcfed8fd2ae91fa528f5b1be207a148/deepdiff-9.0.0-py3-none-any.whl", sha256: "b1ae0dd86290d86a03de5fbee728fde43095c1472ae4974bdab23ab4656305bd" },
  { file: "orderly_set-5.5.0-py3-none-any.whl", url: "https://files.pythonhosted.org/packages/12/27/fb8d7338b4d551900fa3e580acbe7a0cf655d940e164cb5c00ec31961094/orderly_set-5.5.0-py3-none-any.whl", sha256: "46f0b801948e98f427b412fcabb831677194c05c3b699b80de260374baa0b1e7" },
  { file: "geojson-3.3.0-py3-none-any.whl", url: "https://files.pythonhosted.org/packages/aa/5e/fdd72167b57158d743353f71d453200719744d1e75f18b1c8230508db370/geojson-3.3.0-py3-none-any.whl", sha256: "a2d885187eeaa8b357600b3fcc9d963cb4300d1694196636dbd7eddc82fd0825" },
  { file: "colorama-0.4.6-py2.py3-none-any.whl", url: "https://files.pythonhosted.org/packages/d1/d6/3965ed04c63042e047cb6a3e6ed1a63a35087b6a609aa3a15ed8ac56c221/colorama-0.4.6-py2.py3-none-any.whl", sha256: "4f1d9991f5acc0ca119f9d443620b77f9d6b33703e51011c16baf57afb285fc6" },
  { file: "typeguard-4.6.0-py3-none-any.whl", url: "https://files.pythonhosted.org/packages/8f/eb/461d5f167b6f5c7d97696f397c82f82e3480e003fce3f0a1cd1dd26e2eb2/typeguard-4.6.0-py3-none-any.whl", sha256: "79878165bb86f2cf5d41d159a0ff1792a796cf496882d2fe1b1c6c7049b9cdd7" },
  { file: "typing_inspect-0.9.0-py3-none-any.whl", url: "https://files.pythonhosted.org/packages/65/f3/107a22063bf27bdccf2024833d3445f4eea42b2e598abfbd46f6a63b6cb0/typing_inspect-0.9.0-py3-none-any.whl", sha256: "9ee6fc59062311ef8547596ab6b955e1b8aa46242d854bfc78f4f6b0eff35f9f" },
  { file: "mypy_extensions-1.1.0-py3-none-any.whl", url: "https://files.pythonhosted.org/packages/79/7b/2c79738432f5c924bef5071f933bcc9efd0473bac3b4aa584a6f7c1c8df8/mypy_extensions-1.1.0-py3-none-any.whl", sha256: "1be4cccdb0f2482337c4743e60421de3a356cd97508abadd57d47403e94f5505" },
];
for (const wheel of PYPI_WHEELS) await vendor(wheel.file, wheel.url, wheel.sha256);

// What the grid worker loads: Pyodide packages by name, wheels by file.
await writeFile(path.join(target, "grid-packages.json"), JSON.stringify({
  pyodide: [...needed],
  wheels: [networkx.file_name, ...PYPI_WHEELS.map((wheel) => wheel.file)],
}, null, 2));

console.log(`Pyodide ${version} + ${needed.size + 1} packages + ${PYPI_WHEELS.length} PyPI wheels ready in ${target}/`);
