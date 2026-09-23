import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { sensors, sensorReadings } from "../../../db/schema";
import { blankStringField, invalidNumberField } from "../_validate";

// Simple in-memory sliding-window rate limit — good enough for a single
// Worker isolate, not durable across isolates/restarts. Full Durable
// Object-based rate limiting is future work.
const RATE_LIMIT_MS = 10_000;
const lastSeenByDevice = new Map<string, number>();

/**
 * POST /api/ingest
 *
 * Called by each ESP8266/ESP32 node every 30 seconds.
 *
 * Body (JSON):
 * {
 *   hardwareId: "ESP_A1B2",          // unique per device
 *   roomId: 1,                        // must match a row in rooms table
 *   deviceSecret: "…",                // issued once by POST /api/sensors
 *   readings: {
 *     temperature?: 28.4,             // °C
 *     humidity?: 62.1,                // %
 *     occupancy?: 1,                  // 1 = detected, 0 = empty
 *     co2?: 842                        // ppm
 *   }
 * }
 *
 * Response: { ok: true, sensorId: N, inserted: N }
 */
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      hardwareId: string;
      roomId: number;
      deviceSecret?: string;
      readings: Partial<{
        temperature: number;
        humidity: number;
        occupancy: number;
        co2: number;
      }>;
    };

    if (!payload.hardwareId || !payload.roomId || !payload.readings) {
      return Response.json({ error: "hardwareId, roomId, and readings required" }, { status: 400 });
    }

    const numberError = invalidNumberField({ roomId: payload.roomId, ...payload.readings });
    if (numberError) return numberError;
    const stringError = blankStringField({ hardwareId: payload.hardwareId });
    if (stringError) return stringError;

    const lastSeen = lastSeenByDevice.get(payload.hardwareId);
    const nowMs = Date.now();
    if (lastSeen !== undefined && nowMs - lastSeen < RATE_LIMIT_MS) {
      return Response.json({ error: "Rate limited — try again shortly" }, { status: 429 });
    }
    lastSeenByDevice.set(payload.hardwareId, nowMs);

    const db = getDb();

    // Find or auto-register the sensor
    let sensorRow = (await db
      .select()
      .from(sensors)
      .where(eq(sensors.hardwareId, payload.hardwareId))
      .limit(1))[0];

    if (!sensorRow) {
      [sensorRow] = await db
        .insert(sensors)
        .values({
          roomId: payload.roomId,
          hardwareId: payload.hardwareId,
          name: `Auto: ${payload.hardwareId}`,
          type: "env",
          deviceSecret: payload.deviceSecret || null,
        })
        .returning();
    } else if (!sensorRow.deviceSecret) {
      // Grace write — this device has never had a secret set (an
      // already-deployed device from before this change). Adopt whatever
      // it sends now, if anything, as its secret going forward.
      if (payload.deviceSecret) {
        [sensorRow] = await db
          .update(sensors)
          .set({ deviceSecret: payload.deviceSecret })
          .where(eq(sensors.id, sensorRow.id))
          .returning();
      }
    } else if (payload.deviceSecret !== sensorRow.deviceSecret) {
      return Response.json({ error: "Invalid or missing deviceSecret" }, { status: 401 });
    }

    // Determine the unit for each metric
    const unitMap: Record<string, string> = {
      temperature: "°C",
      humidity: "%",
      occupancy: "bool",
      co2: "ppm",
    };

    // Insert one row per metric in the payload
    const entries = Object.entries(payload.readings).filter(([, value]) => value !== undefined && value !== null);

    if (entries.length === 0) {
      return Response.json({ error: "No valid readings in payload" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const inserts = entries.map(([metric, value]) => ({
      sensorId: sensorRow.id,
      metric,
      value: Number(value),
      unit: unitMap[metric] ?? "?",
      recordedAt: now,
    }));

    await db.insert(sensorReadings).values(inserts);

    return Response.json({ ok: true, sensorId: sensorRow.id, inserted: inserts.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}

// GET /api/ingest  — health check (useful when testing from a browser)
export async function GET() {
  return Response.json({
    status: "ok",
    usage: "POST { hardwareId, roomId, deviceSecret, readings: { temperature?, humidity?, occupancy?, co2? } }",
  });
}
