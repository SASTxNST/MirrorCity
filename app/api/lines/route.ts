import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { drawnLines } from "../../../db/schema";

function toError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const full = `${message}\n${cause}`;
  if (full.includes("no such table") || full.includes('"drawn_lines"')) {
    return "Database not initialised. Run `npm run db:generate` then deploy the migration.";
  }
  return message;
}

// GET /api/lines?sessionId=N
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionId = Number(url.searchParams.get("sessionId"));
    if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });

    const db = getDb();
    const rows = await db
      .select()
      .from(drawnLines)
      .where(eq(drawnLines.sessionId, sessionId));

    return Response.json(rows);
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}

// POST /api/lines
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      sessionId: number;
      kind: string;
      points: string; // JSON-stringified array
    };

    if (!payload.sessionId || !payload.kind || !payload.points) {
      return Response.json({ error: "sessionId, kind, and points required" }, { status: 400 });
    }

    const db = getDb();
    const [row] = await db
      .insert(drawnLines)
      .values({
        sessionId: payload.sessionId,
        kind: payload.kind,
        points: payload.points,
      })
      .returning();

    return Response.json(row, { status: 201 });
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}

// DELETE /api/lines?id=N
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) return Response.json({ error: "id required" }, { status: 400 });

    const db = getDb();
    await db.delete(drawnLines).where(eq(drawnLines.id, id));

    return Response.json({ deleted: id });
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}
