import { getDb } from "../../../db";
import { rooms } from "../../../db/schema";
import { eq } from "drizzle-orm";

function toError(e: unknown) {
  return e instanceof Error ? e.message : "Unexpected error";
}

// GET /api/rooms  — list all rooms
export async function GET() {
  try {
    const db = getDb();
    const rows = await db.select().from(rooms);
    return Response.json(rows);
  } catch (e) {
    return Response.json({ error: toError(e) }, { status: 500 });
  }
}

// POST /api/rooms — create a room
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      name?: string;
      glbPath?: string;
      widthM?: number;
      depthM?: number;
      heightM?: number;
    };
    const db = getDb();
    const [row] = await db
      .insert(rooms)
      .values({
        name: payload.name ?? "Unnamed Room",
        glbPath: payload.glbPath ?? "/models/room/room.glb",
        widthM: payload.widthM ?? 6,
        depthM: payload.depthM ?? 5,
        heightM: payload.heightM ?? 3,
      })
      .returning();
    return Response.json(row, { status: 201 });
  } catch (e) {
    return Response.json({ error: toError(e) }, { status: 500 });
  }
}

// PUT /api/rooms  — update room metadata
export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as {
      id: number;
      name?: string;
      glbPath?: string;
      widthM?: number;
      depthM?: number;
      heightM?: number;
    };
    if (!payload.id) return Response.json({ error: "id required" }, { status: 400 });
    const updates: Record<string, unknown> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.glbPath !== undefined) updates.glbPath = payload.glbPath;
    if (payload.widthM !== undefined) updates.widthM = payload.widthM;
    if (payload.depthM !== undefined) updates.depthM = payload.depthM;
    if (payload.heightM !== undefined) updates.heightM = payload.heightM;
    const db = getDb();
    const [row] = await db.update(rooms).set(updates).where(eq(rooms.id, payload.id)).returning();
    return Response.json(row);
  } catch (e) {
    return Response.json({ error: toError(e) }, { status: 500 });
  }
}
