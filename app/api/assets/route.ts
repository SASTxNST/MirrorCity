import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { placedAssets } from "../../../db/schema";

function toError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const full = `${message}\n${cause}`;
  if (full.includes("no such table") || full.includes('"placed_assets"')) {
    return "Database not initialised. Run `npm run db:generate` then deploy the migration.";
  }
  return message;
}

// GET /api/assets?sessionId=N
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionId = Number(url.searchParams.get("sessionId"));
    if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });

    const db = getDb();
    const rows = await db
      .select()
      .from(placedAssets)
      .where(eq(placedAssets.sessionId, sessionId));

    return Response.json(rows);
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}

// POST /api/assets — insert one placed asset
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      sessionId: number;
      assetId: string;
      assetName: string;
      x: number;
      y: number;
      rotation?: number;
      scale?: number;
    };

    if (!payload.sessionId || !payload.assetId) {
      return Response.json({ error: "sessionId and assetId required" }, { status: 400 });
    }

    const db = getDb();
    const [row] = await db
      .insert(placedAssets)
      .values({
        sessionId: payload.sessionId,
        assetId: payload.assetId,
        assetName: payload.assetName,
        x: payload.x,
        y: payload.y,
        rotation: payload.rotation ?? 0,
        scale: payload.scale ?? 1,
      })
      .returning();

    return Response.json(row, { status: 201 });
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}

// PUT /api/assets — update position, rotation, scale of a placed asset
export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as {
      id: number;
      x?: number;
      y?: number;
      rotation?: number;
      scale?: number;
    };

    if (!payload.id) return Response.json({ error: "id required" }, { status: 400 });

    const updates: Partial<{ x: number; y: number; rotation: number; scale: number }> = {};
    if (payload.x !== undefined) updates.x = payload.x;
    if (payload.y !== undefined) updates.y = payload.y;
    if (payload.rotation !== undefined) updates.rotation = payload.rotation;
    if (payload.scale !== undefined) updates.scale = payload.scale;

    const db = getDb();
    const [row] = await db
      .update(placedAssets)
      .set(updates)
      .where(eq(placedAssets.id, payload.id))
      .returning();

    return Response.json(row);
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}

// DELETE /api/assets?id=N
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) return Response.json({ error: "id required" }, { status: 400 });

    const db = getDb();
    await db.delete(placedAssets).where(eq(placedAssets.id, id));

    return Response.json({ deleted: id });
  } catch (error) {
    return Response.json({ error: toError(error) }, { status: 500 });
  }
}
