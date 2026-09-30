// GET /api/osm?lat=&lon=&radius= — raw OpenStreetMap geometry for one scene.
//
// Overpass is a shared volunteer service with strict fair-use limits, so this
// route is the only place MirrorCity touches it: coordinates are rounded to a
// ~11 m grid before the request so nearby views share an edge-cache entry,
// mirrors are tried in turn, and the radius is capped. The response is passed
// through unparsed — `lib/osm.ts` interprets it on the client, keeping the
// Worker's CPU budget free.

import { boundingBox } from "../../../lib/geo";
import { overpassQuery } from "../../../lib/osm";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const USER_AGENT = "MirrorCity/0.1 (district digital twin; https://github.com/SASTxNST/MirrorCity)";
// Kept short so that when the first mirror is queueing, the fallback and the
// eventual error still reach the user quickly.
const MIRROR_TIMEOUT_MS = 30_000;

// A real Overpass JSON response, as opposed to one of its HTML error pages.
function looksLikeData(body: string): boolean {
  return body.trimStart().startsWith("{") && body.includes('"elements"');
}

export const MIN_RADIUS_M = 100;
// Beyond ~1.5 km a dense city centre returns tens of megabytes and the scene
// stops being interactive on ordinary hardware.
export const MAX_RADIUS_M = 1500;
const CACHE_SECONDS = 43_200;

// Cloudflare's cache API, declared locally: the Worker entry deliberately
// avoids pulling the global Workers types into the app's type space.
type EdgeCache = { match(key: Request): Promise<Response | undefined>; put(key: Request, value: Response): Promise<void> };
declare const caches: { default?: EdgeCache } | undefined;

function edgeCache(): EdgeCache | null {
  try {
    return typeof caches !== "undefined" ? caches.default ?? null : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const radius = Number(params.get("radius") ?? 500);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return Response.json({ error: "lat must be a number between -90 and 90" }, { status: 400 });
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return Response.json({ error: "lon must be a number between -180 and 180" }, { status: 400 });
  }
  if (!Number.isFinite(radius) || radius < MIN_RADIUS_M || radius > MAX_RADIUS_M) {
    return Response.json({ error: `radius must be between ${MIN_RADIUS_M} and ${MAX_RADIUS_M} metres` }, { status: 400 });
  }

  // Snap to a shared grid so panning a few metres reuses the cached tile.
  const snappedLat = Number(lat.toFixed(4));
  const snappedLon = Number(lon.toFixed(4));
  const snappedRadius = Math.round(radius / 50) * 50;

  const cache = edgeCache();
  const cacheKey = new Request(
    `https://mirrorcity.osm/v1?lat=${snappedLat}&lon=${snappedLon}&radius=${snappedRadius}`,
    { method: "GET" }
  );
  const cached = await cache?.match(cacheKey);
  if (cached) return cached;

  const query = overpassQuery(boundingBox({ lat: snappedLat, lon: snappedLon }, snappedRadius));

  let body: string | null = null;
  let lastError = "OpenStreetMap's Overpass servers are unreachable";
  for (const mirror of MIRRORS) {
    try {
      const upstream = await fetch(mirror, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS),
      });
      if (upstream.ok) {
        const text = await upstream.text();
        // Overpass reports overload as an HTML page — sometimes under a 200 —
        // so the body is checked rather than the status. Caching one of those
        // for half a day would leave the area permanently blank.
        if (looksLikeData(text)) {
          body = text;
          break;
        }
        lastError = "Overpass is overloaded and returned an error page instead of data";
      } else if (upstream.status === 429) {
        lastError = "Overpass rate-limited this request";
      } else {
        // 504 here is Overpass's own dispatcher queue timing out, not us.
        lastError = `Overpass is busy (HTTP ${upstream.status})`;
      }
    } catch {
      lastError = `Overpass did not answer within ${MIRROR_TIMEOUT_MS / 1000}s`;
    }
  }

  if (body === null) {
    return Response.json(
      { error: `${lastError}. It is a free shared service — wait a moment, or try a smaller radius.` },
      { status: 502 }
    );
  }

  const response = new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      "X-MirrorCity-Origin": `${snappedLat},${snappedLon},${snappedRadius}`,
    },
  });

  // Serve the client immediately; the cache write can settle afterwards.
  if (cache) await cache.put(cacheKey, response.clone()).catch(() => {});
  return response;
}
