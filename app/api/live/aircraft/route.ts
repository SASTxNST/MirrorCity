// GET /api/live/aircraft?lat=&lon=&span= — aircraft currently in the air
// around a point, from the OpenSky Network.
//
// OpenSky's anonymous tier updates every ten seconds and is metered per day,
// so this caches for fifteen and snaps the query box to a coarse grid: two
// people watching the same city share one upstream call.

import { parseAircraft, degreeBox } from "../../../../lib/live.ts";
import { cachedJson, fetchJson, isResponse, readCentre } from "../_shared.ts";

const CACHE_SECONDS = 15;
const DEFAULT_SPAN_DEG = 1.0;
const MAX_SPAN_DEG = 3.0;

export async function GET(request: Request) {
  const centre = readCentre(request);
  if (isResponse(centre)) return centre;

  const requested = Number(new URL(request.url).searchParams.get("span") ?? DEFAULT_SPAN_DEG);
  const span = Number.isFinite(requested) ? Math.min(MAX_SPAN_DEG, Math.max(0.2, requested)) : DEFAULT_SPAN_DEG;

  const gridLat = Number(centre.lat.toFixed(1));
  const gridLon = Number(centre.lon.toFixed(1));
  const box = degreeBox({ lat: gridLat, lon: gridLon }, span);

  return cachedJson(
    `https://mirrorcity.live/aircraft?lat=${gridLat}&lon=${gridLon}&span=${span}`,
    CACHE_SECONDS,
    async () => {
      const payload = await fetchJson(
        `https://opensky-network.org/api/states/all?lamin=${box.lamin}&lomin=${box.lomin}&lamax=${box.lamax}&lomax=${box.lomax}`,
        20_000
      );
      if (payload === null) {
        return {
          body: { error: "OpenSky is unavailable or rate-limited. It is a free community feed; try again shortly.", aircraft: [] },
          status: 502,
        };
      }
      const aircraft = parseAircraft(payload, centre);
      return {
        body: {
          aircraft: aircraft.slice(0, 200),
          total: aircraft.length,
          airborne: aircraft.filter((entry) => !entry.onGround).length,
          source: "OpenSky Network",
          fetchedAt: new Date().toISOString(),
        },
      };
    }
  );
}
