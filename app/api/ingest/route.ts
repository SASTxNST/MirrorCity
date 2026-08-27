import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { sensors, sensorReadings } from "../../../db/schema";

/**
 * POST /api/ingest
 *
 * Called by each ESP8266/ESP32 node every 30 seconds.
 *
 * Body (JSON):
 * {
 *   hardwareId: "ESP_A1B2",          // unique per device
 *   roomId: 1,                        // must match a row in rooms table
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
        })
        .returning();
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
    usage: "POST { hardwareId, roomId, readings: { temperature?, humidity?, occupancy?, co2? } }",
  });
}
