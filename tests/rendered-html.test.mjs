import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";

test("GET / renders the MirrorCity workspace", async () => {
  // Runs in workerd like the API tests: since vinext 1.0 the server entry
  // imports "cloudflare:workers" up front, which plain Node can't load.
  const response = await mf.dispatchFetch("http://localhost/", { headers: { accept: "text/html" } });
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
const ADMIN_TOKEN = "test-admin-token";

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
    bindings: { ROOM_ADMIN_TOKEN: ADMIN_TOKEN },
  });

  const db = await mf.getD1Database("DB");
  const migrationsDir = new URL("../drizzle/", import.meta.url);
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", migrationsDir), "utf8"));
  for (const { tag } of journal.entries) {
    const sql = readFileSync(new URL(`${tag}.sql`, migrationsDir), "utf8");
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

test("a session remembers the last flood storm", async () => {
  const first = await mf.dispatchFetch("http://localhost/api/session");
  const cookie = first.headers.get("set-cookie").split(";")[0];
  assert.equal((await first.json()).session.floodRainfall, 100);

  const put = await mf.dispatchFetch("http://localhost/api/session", { method: "PUT", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ floodRainfall: 140, floodStormMinutes: 90 }) });
  assert.equal(put.status, 200);

  const { session } = await (await mf.dispatchFetch("http://localhost/api/session", { headers: { cookie } })).json();
  assert.equal(session.floodRainfall, 140);
  assert.equal(session.floodStormMinutes, 90);

  const bad = await mf.dispatchFetch("http://localhost/api/session", { method: "PUT", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ floodRainfall: "lots" }) });
  assert.equal(bad.status, 400);
});

test("a first visit never receives another visitor's session", async () => {
  const first = await mf.dispatchFetch("http://localhost/api/session");
  const firstCookie = first.headers.get("set-cookie").split(";")[0];
  const firstId = (await first.json()).session.id;

  const second = await mf.dispatchFetch("http://localhost/api/session");
  assert.notEqual((await second.json()).session.id, firstId);

  const returning = await mf.dispatchFetch("http://localhost/api/session", { headers: { cookie: firstCookie } });
  assert.equal((await returning.json()).session.id, firstId);
});

test("a session's data can only be read by its owner", async () => {
  const owner = await mf.dispatchFetch("http://localhost/api/session");
  const ownerCookie = owner.headers.get("set-cookie").split(";")[0];
  const sessionId = (await owner.json()).session.id;
  const other = await mf.dispatchFetch("http://localhost/api/session");
  const otherCookie = other.headers.get("set-cookie").split(";")[0];

  const placed = await mf.dispatchFetch("http://localhost/api/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ sessionId, assetId: "pump", assetName: "Flood pump station", x: 10, y: 20 }),
  });
  assert.equal(placed.status, 201);

  for (const route of ["assets", "lines", "areas", "buildings", "uploads"]) {
    const res = await mf.dispatchFetch(`http://localhost/api/${route}?sessionId=${sessionId}`, { headers: { cookie: otherCookie } });
    assert.equal(res.status, 404, `${route} must not be readable by another visitor`);
  }
  const own = await mf.dispatchFetch(`http://localhost/api/assets?sessionId=${sessionId}`, { headers: { cookie: ownerCookie } });
  assert.equal((await own.json()).length, 1);
});

const json = (body, extra = {}) => ({ method: "POST", headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) });
const admin = { Authorization: `Bearer ${ADMIN_TOKEN}` };

test("only a session's owner can upload into it", async () => {
  const owner = await mf.dispatchFetch("http://localhost/api/session");
  const sessionId = (await owner.json()).session.id;
  const other = (await mf.dispatchFetch("http://localhost/api/session")).headers.get("set-cookie").split(";")[0];
  const boundary = "----mcTestBoundary";
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="sessionId"\r\n\r\n${sessionId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="scan.las"\r\nContent-Type: application/octet-stream\r\n\r\nx\r\n--${boundary}--\r\n`;
  const res = await mf.dispatchFetch("http://localhost/api/uploads", { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, cookie: other }, body });
  assert.equal(res.status, 404);
});

test("the unused session snapshot endpoint is gone", async () => {
  const res = await mf.dispatchFetch("http://localhost/api/session/snapshot", json({ label: "x" }));
  assert.equal(res.status, 404);
});

test("rooms: first room is self-provisioned, everything after needs the admin token", async () => {
  assert.equal((await mf.dispatchFetch("http://localhost/api/rooms", json({ name: "Lab" }))).status, 201);
  assert.equal((await mf.dispatchFetch("http://localhost/api/rooms", json({ name: "Spam" }))).status, 401);
  assert.equal((await mf.dispatchFetch("http://localhost/api/rooms", json({ name: "Annex" }, admin))).status, 201);
  assert.equal((await mf.dispatchFetch("http://localhost/api/rooms", { ...json({ id: 1, name: "Renamed" }), method: "PUT" })).status, 401);
});

test("sensors: registration and edits need the admin token; re-registering rotates the secret", async () => {
  assert.equal((await mf.dispatchFetch("http://localhost/api/sensors", json({ roomId: 1, hardwareId: "ESP_T1" }))).status, 401);
  const reg = await mf.dispatchFetch("http://localhost/api/sensors", json({ roomId: 1, hardwareId: "ESP_T1" }, admin));
  assert.equal(reg.status, 201);
  const { id, deviceSecret } = await reg.json();
  assert.ok(deviceSecret);
  assert.equal((await mf.dispatchFetch("http://localhost/api/sensors", { ...json({ id, name: "x" }), method: "PUT" })).status, 401);
  const again = await (await mf.dispatchFetch("http://localhost/api/sensors", json({ roomId: 1, hardwareId: "ESP_T1" }, admin))).json();
  assert.ok(again.deviceSecret && again.deviceSecret !== deviceSecret);
});

test("ingest: unknown devices are rejected, registered ones need their current secret", async () => {
  const reading = (hardwareId, deviceSecret) => json({ hardwareId, roomId: 1, deviceSecret, readings: { temperature: 21 } });
  assert.equal((await mf.dispatchFetch("http://localhost/api/ingest", reading("ESP_UNKNOWN"))).status, 401);

  const { deviceSecret } = await (await mf.dispatchFetch("http://localhost/api/sensors", json({ roomId: 1, hardwareId: "ESP_T2" }, admin))).json();
  assert.equal((await mf.dispatchFetch("http://localhost/api/ingest", reading("ESP_T2", deviceSecret))).status, 200);

  const first = (await (await mf.dispatchFetch("http://localhost/api/sensors", json({ roomId: 1, hardwareId: "ESP_T3" }, admin))).json()).deviceSecret;
  await mf.dispatchFetch("http://localhost/api/sensors", json({ roomId: 1, hardwareId: "ESP_T3" }, admin));
  assert.equal((await mf.dispatchFetch("http://localhost/api/ingest", reading("ESP_T3", first))).status, 401, "rotated-out secret must stop working");
});

test("GET /api/ingest reports the health check", async () => {
  const response = await mf.dispatchFetch("http://localhost/api/ingest");
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.status, "ok");
});
