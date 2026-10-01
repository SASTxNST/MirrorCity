// GET /api/live/quakes?lat=&lon=&window= — recent earthquakes worldwide,
// ordered by distance from the scene, from the USGS feed.

import { parseQuakes } from "../../../../lib/live.ts";
import { cachedJson, fetchJson, isResponse, readCentre } from "../_shared.ts";

const CACHE_SECONDS = 120;
const FEEDS: Record<string, string> = {
  hour: "all_hour",
  day: "all_day",
  week: "all_week",
};

export async function GET(request: Request) {
  const centre = readCentre(request);
  if (isResponse(centre)) return centre;

  const requested = new URL(request.url).searchParams.get("window") ?? "day";
  const feed = FEEDS[requested] ?? FEEDS.day;

  return cachedJson(
    `https://mirrorcity.live/quakes?feed=${feed}&lat=${centre.lat.toFixed(1)}&lon=${centre.lon.toFixed(1)}`,
    CACHE_SECONDS,
    async () => {
      const payload = await fetchJson(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`);
      if (payload === null) {
        return { body: { error: "The USGS feed is unavailable.", quakes: [] }, status: 502 };
      }
      const quakes = parseQuakes(payload, centre);
      const byDistance = [...quakes].sort((a, b) => a.distanceM - b.distanceM);
      const byMagnitude = [...quakes].sort((a, b) => b.magnitude - a.magnitude);
      return {
        body: {
          nearest: byDistance.slice(0, 12),
          strongest: byMagnitude.slice(0, 12),
          total: quakes.length,
          window: requested in FEEDS ? requested : "day",
          source: "USGS",
          fetchedAt: new Date().toISOString(),
        },
      };
    }
  );
}
