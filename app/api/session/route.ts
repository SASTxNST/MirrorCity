import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { sessions } from "../../../db/schema";

function toError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const full = `${message}\n${cause}`;
  if (full.includes("no such table") || full.includes('"sessions"')) {
    return "Database not initialised. Run `npm run db:generate` then deploy the migration.";
  }
  return message;
}

// GET /api/session — return the latest session (or create a default one)
export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.updatedAt), desc(sessions.id))
      .limit(1);

    if (rows.length > 0) {
      return Response.json({ session: rows[0] });
    }

    // No session exists yet — create a default one
    const [created] = await db
      .insert(sessions)
      .values({ districtName: "Varuna River Ward", population: 2000, activeScenario: "sewer", layers: "{}", label: "" })
      .returning();

    return Response.json({ session: created });
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}

// PUT /api/session — update fields on the latest session
export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as {
      districtName?: string;
      population?: number;
      activeScenario?: string;
      layers?: string;
    };

    const db = getDb();
    const rows = await db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.updatedAt), desc(sessions.id))
      .limit(1);

    if (rows.length === 0) {
      return Response.json({ error: "No active session" }, { status: 404 });
    }

    const current = rows[0];
    const updates: Partial<typeof current> = { updatedAt: new Date().toISOString() };

    if (payload.districtName !== undefined) updates.districtName = payload.districtName;
    if (payload.population !== undefined) updates.population = payload.population;
    if (payload.activeScenario !== undefined) updates.activeScenario = payload.activeScenario;
    if (payload.layers !== undefined) updates.layers = payload.layers;

    const [updated] = await db
      .update(sessions)
      .set(updates)
      .where(eq(sessions.id, current.id))
      .returning();

    return Response.json({ session: updated });
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}
