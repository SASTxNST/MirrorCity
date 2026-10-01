// Shared helpers for the live-feed proxies.
//
// Every one of these upstreams is a free public service with its own fair-use
// limits, so the browser never calls them directly: requests go through the
// Worker, which caches at the edge for as long as the data is actually fresh.

export const USER_AGENT = "MirrorCity/0.2 (open spatial intelligence; https://github.com/SASTxNST/MirrorCity)";

type EdgeCache = { match(key: Request): Promise<Response | undefined>; put(key: Request, value: Response): Promise<void> };
declare const caches: { default?: EdgeCache } | undefined;

export function edgeCache(): EdgeCache | null {
  try {
    return typeof caches !== "undefined" ? caches.default ?? null : null;
  } catch {
    return null;
  }
}

export type Centre = { lat: number; lon: number };

// Reads and validates the lat/lon every live route takes. Returns a 400
// Response instead of a centre when the caller got it wrong.
export function readCentre(request: Request): Centre | Response {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return Response.json({ error: "lat must be a number between -90 and 90" }, { status: 400 });
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return Response.json({ error: "lon must be a number between -180 and 180" }, { status: 400 });
  }
  return { lat, lon };
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

// Fetches JSON with a timeout, returning null rather than throwing: a live
// layer that is briefly unavailable should dim, not break the page.
export async function fetchJson(url: string, timeoutMs = 15_000): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Caches a JSON payload at the edge under a stable key. `seconds` should match
// how often the upstream actually changes: polling faster buys nothing and
// spends someone else's rate limit.
export async function cachedJson(
  cacheKeyUrl: string,
  seconds: number,
  build: () => Promise<{ body: unknown; status?: number }>
): Promise<Response> {
  const cache = edgeCache();
  const key = new Request(cacheKeyUrl, { method: "GET" });
  const hit = await cache?.match(key);
  if (hit) return hit;

  const { body, status = 200 } = await build();
  const response = Response.json(body, {
    status,
    headers: { "Cache-Control": `public, max-age=${seconds}` },
  });
  if (cache && status === 200) await cache.put(key, response.clone()).catch(() => {});
  return response;
}
