import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { plannedBuildings } from "../../../db/schema";

function toError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const full = `${message}\n${cause}`;
  if (full.includes("no such table") || full.includes('"planned_buildings"')) {
    return "Database not initialised. Run `npm run db:generate` then deploy the migration.";
  }
  return message;
}

// GET /api/buildings?sessionId=N
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionId = Number(url.searchParams.get("sessionId"));
    if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });

    const db = getDb();
    const rows = await db
      .select()
      .from(plannedBuildings)
      .where(eq(plannedBuildings.sessionId, sessionId));

    return Response.json(rows);
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}

// POST /api/buildings
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      sessionId: number;
      x: number;
      y: number;
      floors: number;
    };

    if (!payload.sessionId) {
      return Response.json({ error: "sessionId required" }, { status: 400 });
    }

    const db = getDb();
    const [row] = await db
      .insert(plannedBuildings)
      .values({
        sessionId: payload.sessionId,
        x: payload.x,
        y: payload.y,
        floors: payload.floors ?? 4,
      })
      .returning();

    return Response.json(row, { status: 201 });
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}

// DELETE /api/buildings?id=N
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) return Response.json({ error: "id required" }, { status: 400 });

    const db = getDb();
    await db.delete(plannedBuildings).where(eq(plannedBuildings.id, id));

    return Response.json({ deleted: id });
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}
