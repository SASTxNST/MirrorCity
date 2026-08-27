import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { sensors, sensorReadings } from "../../../db/schema";

function toError(e: unknown) {
  return e instanceof Error ? e.message : "Unexpected error";
}

/**
 * GET /api/sensor-readings?roomId=N
 *
 * Returns the latest reading for every metric on every sensor in the room.
 * Shape:
 * [
 *   {
 *     sensorId: 1,
 *     hardwareId: "ESP_A1B2",
 *     name: "Corner sensor",
 *     x: 0.2, y: 0.7, z: 0.3,
 *     readings: {
 *       temperature: { value: 28.4, unit: "°C", recordedAt: "..." },
 *       humidity:    { value: 62.1, unit: "%",  recordedAt: "..." },
 *       occupancy:   { value: 1,    unit: "bool", recordedAt: "..." },
 *       co2:         { value: 842,  unit: "ppm", recordedAt: "..." }
 *     }
 *   },
 *   ...
 * ]
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const roomId = Number(url.searchParams.get("roomId"));
    if (!roomId) return Response.json({ error: "roomId required" }, { status: 400 });

    const db = getDb();

    // Get all active sensors for this room
    const roomSensors = await db
      .select()
      .from(sensors)
      .where(eq(sensors.roomId, roomId));

    if (roomSensors.length === 0) return Response.json([]);

    // For each sensor, get the latest reading per metric
    const result = await Promise.all(
      roomSensors.map(async (sensor) => {
        // Get the most recent reading for each metric (subquery pattern for D1)
        const metrics = ["temperature", "humidity", "occupancy", "co2"];
        const readings: Record<string, { value: number; unit: string; recordedAt: string }> = {};

        await Promise.all(
          metrics.map(async (metric) => {
            const rows = await db
              .select()
              .from(sensorReadings)
              .where(
                sql`${sensorReadings.sensorId} = ${sensor.id} AND ${sensorReadings.metric} = ${metric}`
              )
              .orderBy(desc(sensorReadings.recordedAt))
              .limit(1);
            if (rows.length > 0) {
              readings[metric] = {
                value: rows[0].value,
                unit: rows[0].unit,
                recordedAt: rows[0].recordedAt,
              };
            }
          })
        );

        return {
          sensorId: sensor.id,
          hardwareId: sensor.hardwareId,
          name: sensor.name,
          type: sensor.type,
          x: sensor.x,
          y: sensor.y,
          z: sensor.z,
          active: sensor.active,
          readings,
        };
      })
    );

    return Response.json(result);
  } catch (e) {
    return Response.json({ error: toError(e) }, { status: 500 });
  }
}
