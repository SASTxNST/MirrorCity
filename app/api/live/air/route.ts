// GET /api/live/air?lat=&lon= — current weather and air quality at the scene,
// from Open-Meteo's two free endpoints.
//
// For an Indian city this is the layer that matters most day to day: PM2.5
// over Delhi routinely sits above every health threshold the EPA defines.

import { parseAir } from "../../../../lib/live.ts";
import { cachedJson, fetchJson, isResponse, readCentre } from "../_shared.ts";

// Open-Meteo refreshes air quality hourly and weather every fifteen minutes.
const CACHE_SECONDS = 600;

export async function GET(request: Request) {
  const centre = readCentre(request);
  if (isResponse(centre)) return centre;

  const lat = centre.lat.toFixed(3);
  const lon = centre.lon.toFixed(3);

  return cachedJson(`https://mirrorcity.live/air?lat=${lat}&lon=${lon}`, CACHE_SECONDS, async () => {
    const [weather, quality] = await Promise.all([
      fetchJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
          "&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m"
      ),
      fetchJson(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
          "&current=pm2_5,pm10,us_aqi"
      ),
    ]);

    if (weather === null && quality === null) {
      return { body: { error: "Open-Meteo is unavailable.", reading: null }, status: 502 };
    }

    return {
      body: {
        reading: parseAir(weather, quality),
        source: "Open-Meteo",
        fetchedAt: new Date().toISOString(),
      },
    };
  });
}
