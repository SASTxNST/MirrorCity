import { desc } from "drizzle-orm";
import { getDb } from "../../../../db";
import { sessions } from "../../../../db/schema";

function toError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return message;
}

// POST /api/session/snapshot — copy current session state into a new labelled row
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { label?: string };
    const label = payload.label?.trim() ?? `Snapshot ${new Date().toISOString()}`;

    const db = getDb();
    const rows = await db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.updatedAt), desc(sessions.id))
      .limit(1);

    if (rows.length === 0) {
      return Response.json({ error: "No active session to snapshot" }, { status: 404 });
    }

    const source = rows[0];
    const [snapshot] = await db
      .insert(sessions)
      .values({
        districtName: source.districtName,
        population: source.population,
        activeScenario: source.activeScenario,
        layers: source.layers,
        label,
      })
      .returning();

    return Response.json({ snapshot }, { status: 201 });
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}
