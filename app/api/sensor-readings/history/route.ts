import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { sensorReadings } from "../../../../db/schema";

function toError(e: unknown) {
  return e instanceof Error ? e.message : "Unexpected error";
}

/**
 * GET /api/sensor-readings/history?sensorId=N&metric=temperature&hours=24
 *
 * Returns up to 200 readings for a single metric on a single sensor
 * for charting the trend over time.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sensorId = Number(url.searchParams.get("sensorId"));
    const metric = url.searchParams.get("metric") ?? "temperature";
    const hours = Math.min(168, Math.max(1, Number(url.searchParams.get("hours") ?? "24")));

    if (!sensorId) return Response.json({ error: "sensorId required" }, { status: 400 });

    const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    const db = getDb();
    const rows = await db
      .select({
        value: sensorReadings.value,
        unit: sensorReadings.unit,
        recordedAt: sensorReadings.recordedAt,
      })
      .from(sensorReadings)
      .where(
        and(
          eq(sensorReadings.sensorId, sensorId),
          eq(sensorReadings.metric, metric),
          gte(sensorReadings.recordedAt, cutoff)
        )
      )
      .orderBy(desc(sensorReadings.recordedAt))
      .limit(200);

    // Return chronological order for charting
    return Response.json({
      sensorId,
      metric,
      hours,
      data: rows.reverse(),
    });
  } catch (e) {
    return Response.json({ error: toError(e) }, { status: 500 });
  }
}
