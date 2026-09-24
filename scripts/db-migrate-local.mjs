// Applies drizzle/ migrations to the local D1 database that `npm run dev` uses.
// Idempotent: applied migrations are recorded in wrangler's `d1_migrations` table.
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";

// Must match the database_id and persist path the Cloudflare Vite plugin uses in dev.
const DATABASE_ID = "00000000-0000-4000-8000-000000000000";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch: () => new Response(null) }",
  d1Databases: { DB: DATABASE_ID },
  d1Persist: ".wrangler/state/v3/d1",
});

try {
  const db = await mf.getD1Database("DB");
  await db.prepare("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)").run();
  const { results } = await db.prepare("SELECT name FROM d1_migrations").all();
  const applied = new Set(results.map((row) => row.name));

  let count = 0;
  for (const { tag } of journal.entries) {
    const name = `${tag}.sql`;
    if (applied.has(name)) continue;
    const statements = readFileSync(`drizzle/${name}`, "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    for (const statement of statements) await db.prepare(statement).run();
    await db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(name).run();
    console.log(`applied ${name}`);
    count++;
  }
  console.log(count ? `${count} migration(s) applied to local D1.` : "Local D1 is up to date.");
} finally {
  await mf.dispose();
}
