import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";

// Plain Node ESM harness — works for routes that don't touch the D1-backed
// `getDb()` (which imports the workerd-only "cloudflare:workers" module at
// load time). Matches the pattern the starter template used.
async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("GET / renders the MirrorCity workspace", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>MirrorCity — Plan the city before it happens<\/title>/);
});

// Routes under app/api/** import db/index.ts, which imports
// "cloudflare:workers" — a workerd built-in that plain Node cannot resolve.
// Exercising them needs the actual Workers runtime (via miniflare, already
// installed as a transitive dependency of wrangler) with a D1 binding and
// the committed migrations applied.
function collectJsModules(root) {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) files.push(path.relative(root, full));
    }
  })(root);
  // The Worker entrypoint must be first in the module list.
  files.sort((a, b) => (a === "index.js" ? -1 : b === "index.js" ? 1 : 0));
  return files;
}

let mf;

before(async () => {
  const { Miniflare } = await import("miniflare");
  const serverRoot = new URL("../dist/server/", import.meta.url).pathname;

  mf = new Miniflare({
    modulesRoot: serverRoot,
    modules: collectJsModules(serverRoot).map((file) => ({
      type: "ESModule",
      path: path.join(serverRoot, file),
    })),
    compatibilityFlags: ["nodejs_compat"],
    // Newest date the workerd binary bundled with the installed wrangler
    // version supports — bump alongside wrangler/miniflare upgrades.
    compatibilityDate: "2026-05-22",
    d1Databases: { DB: "test-db" },
  });

  const db = await mf.getD1Database("DB");
  const migrationsDir = new URL("../drizzle/", import.meta.url);
  for (const file of ["0000_fixed_tyger_tiger.sql", "0001_new_gateway.sql"]) {
    const sql = readFileSync(new URL(file, migrationsDir), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
});

after(async () => {
  await mf?.dispose();
});

test("GET /api/session returns the active session", async () => {
  const response = await mf.dispatchFetch("http://localhost/api/session");
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.ok("session" in body, "response body should include a `session` key");
  assert.equal(body.session.districtName, "Varuna River Ward");
});

test("GET /api/ingest reports the health check", async () => {
  const response = await mf.dispatchFetch("http://localhost/api/ingest");
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.status, "ok");
});
