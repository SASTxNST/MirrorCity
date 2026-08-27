import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { sensors } from "../../../db/schema";

function toError(e: unknown) {
  return e instanceof Error ? e.message : "Unexpected error";
}

// GET /api/sensors?roomId=N  — list sensors in a room
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const roomId = Number(url.searchParams.get("roomId"));
    if (!roomId) return Response.json({ error: "roomId required" }, { status: 400 });
    const db = getDb();
    const rows = await db.select().from(sensors).where(eq(sensors.roomId, roomId));
    return Response.json(rows);
  } catch (e) {
    return Response.json({ error: toError(e) }, { status: 500 });
  }
}

// POST /api/sensors  — register a sensor node (call once per device)
// Body: { roomId, hardwareId, name?, type?, x?, y?, z? }
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      roomId: number;
      hardwareId: string;
      name?: string;
      type?: string;
      x?: number;
      y?: number;
      z?: number;
    };
    if (!payload.roomId || !payload.hardwareId) {
      return Response.json({ error: "roomId and hardwareId required" }, { status: 400 });
    }
    const db = getDb();

    // Upsert — if a sensor with this hardwareId already exists for this room, return it
    const existing = await db
      .select()
      .from(sensors)
      .where(eq(sensors.hardwareId, payload.hardwareId))
      .limit(1);

    if (existing.length > 0) {
      return Response.json(existing[0]);
    }

    const [row] = await db
      .insert(sensors)
      .values({
        roomId: payload.roomId,
        hardwareId: payload.hardwareId,
        name: payload.name ?? "Sensor",
        type: payload.type ?? "env",
        x: payload.x ?? 0.5,
        y: payload.y ?? 0.7,
        z: payload.z ?? 0.5,
      })
      .returning();
    return Response.json(row, { status: 201 });
  } catch (e) {
    return Response.json({ error: toError(e) }, { status: 500 });
  }
}

// PUT /api/sensors  — update sensor position or name
export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as {
      id: number;
      name?: string;
      x?: number;
      y?: number;
      z?: number;
      active?: boolean;
    };
    if (!payload.id) return Response.json({ error: "id required" }, { status: 400 });
    const updates: Record<string, unknown> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.x !== undefined) updates.x = payload.x;
    if (payload.y !== undefined) updates.y = payload.y;
    if (payload.z !== undefined) updates.z = payload.z;
    if (payload.active !== undefined) updates.active = payload.active;
    const db = getDb();
    const [row] = await db.update(sensors).set(updates).where(eq(sensors.id, payload.id)).returning();
    return Response.json(row);
  } catch (e) {
    return Response.json({ error: toError(e) }, { status: 500 });
  }
}
