import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { sensors } from "../../../db/schema";
import { blankStringField, invalidNumberField } from "../_validate";
import { requireAdmin } from "../_session-auth";

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
    const rows = await db
      .select({ id: sensors.id, roomId: sensors.roomId, hardwareId: sensors.hardwareId, name: sensors.name, type: sensors.type, x: sensors.x, y: sensors.y, z: sensors.z, active: sensors.active, createdAt: sensors.createdAt })
      .from(sensors)
      .where(eq(sensors.roomId, roomId));
    return Response.json(rows);
  } catch (e) {
    return Response.json({ error: toError(e) }, { status: 500 });
  }
}

// POST /api/sensors  — register a sensor node (admin only; returns its deviceSecret)
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
    const authError = requireAdmin(request);
    if (authError) return authError;

    const numberError = invalidNumberField({ x: payload.x, y: payload.y, z: payload.z });
    if (numberError) return numberError;
    const stringError = blankStringField({ hardwareId: payload.hardwareId, name: payload.name, type: payload.type });
    if (stringError) return stringError;

    const db = getDb();

    // deviceSecret is only ever returned here (to the admin) — the device must
    // store it and send it with every POST /api/ingest.
    const deviceSecret = crypto.randomUUID();

    // Re-registering an existing device rotates its secret, so an admin can
    // reclaim a device whose secret was claimed by someone else.
    const [existing] = await db.select({ id: sensors.id }).from(sensors).where(eq(sensors.hardwareId, payload.hardwareId)).limit(1);
    if (existing) {
      const [rotated] = await db.update(sensors).set({ deviceSecret }).where(eq(sensors.id, existing.id)).returning();
      return Response.json(rotated);
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
        deviceSecret,
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
    const authError = requireAdmin(request);
    if (authError) return authError;

    const numberError = invalidNumberField({ x: payload.x, y: payload.y, z: payload.z });
    if (numberError) return numberError;
    const stringError = blankStringField({ name: payload.name });
    if (stringError) return stringError;

    const updates: Record<string, unknown> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.x !== undefined) updates.x = payload.x;
    if (payload.y !== undefined) updates.y = payload.y;
    if (payload.z !== undefined) updates.z = payload.z;
    if (payload.active !== undefined) updates.active = payload.active;
    const db = getDb();
    const [row] = await db
      .update(sensors)
      .set(updates)
      .where(eq(sensors.id, payload.id))
      .returning({ id: sensors.id, roomId: sensors.roomId, hardwareId: sensors.hardwareId, name: sensors.name, type: sensors.type, x: sensors.x, y: sensors.y, z: sensors.z, active: sensors.active, createdAt: sensors.createdAt });
    return Response.json(row);
  } catch (e) {
    return Response.json({ error: toError(e) }, { status: 500 });
  }
}
