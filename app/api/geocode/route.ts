// GET /api/geocode?q=… — place search against OpenStreetMap's Nominatim.
//
// Proxied rather than called from the browser for three reasons: Nominatim's
// usage policy requires an identifying User-Agent that a browser will not let
// us set, its CORS headers are not guaranteed, and proxying lets the edge
// cache absorb repeat searches so we stay inside its rate limit.

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "MirrorCity/0.1 (district digital twin; https://github.com/SASTxNST/MirrorCity)";
const CACHE_SECONDS = 86_400;

export type GeocodeResult = {
  id: string;
  name: string;
  address: string;
  kind: string;
  lat: number;
  lon: number;
  // Suggested scene radius in metres, from the extent Nominatim reports.
  radiusM: number;
};

type NominatimPlace = {
  place_id: number;
  osm_type?: string;
  osm_id?: number;
  name?: string;
  display_name: string;
  type?: string;
  class?: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
};

// A radius that frames the whole place, bounded so a search for "India" does
// not ask Overpass for a subcontinent and a shopfront still gets context.
function suggestedRadius(place: NominatimPlace): number {
  const box = place.boundingbox?.map(Number);
  if (!box || box.some((value) => !Number.isFinite(value))) return 500;
  const [south, north, west, east] = box;
  const midLat = ((south + north) / 2) * (Math.PI / 180);
  const halfHeight = ((north - south) / 2) * 111_320;
  const halfWidth = ((east - west) / 2) * 111_320 * Math.cos(midLat);
  return Math.round(Math.min(1500, Math.max(300, Math.max(halfHeight, halfWidth) * 1.15)));
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return Response.json({ error: "q must be at least 2 characters" }, { status: 400 });
  }
  if (query.length > 200) {
    return Response.json({ error: "q must be at most 200 characters" }, { status: 400 });
  }

  const upstream = new URL(NOMINATIM);
  upstream.searchParams.set("q", query);
  upstream.searchParams.set("format", "jsonv2");
  upstream.searchParams.set("limit", "6");
  upstream.searchParams.set("addressdetails", "0");

  let response: Response;
  try {
    response = await fetch(upstream, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return Response.json({ error: "Place search is unreachable. Check the network and try again." }, { status: 502 });
  }

  if (!response.ok) {
    return Response.json({ error: `Place search failed (${response.status})` }, { status: 502 });
  }

  let places: NominatimPlace[];
  try {
    places = (await response.json()) as NominatimPlace[];
  } catch {
    return Response.json({ error: "Place search returned an unreadable response" }, { status: 502 });
  }

  const results: GeocodeResult[] = (Array.isArray(places) ? places : [])
    .map((place) => {
      const lat = Number(place.lat);
      const lon = Number(place.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const parts = place.display_name.split(",").map((part) => part.trim());
      return {
        id: `${place.osm_type ?? "place"}/${place.osm_id ?? place.place_id}`,
        name: place.name?.trim() || parts[0] || place.display_name,
        address: parts.slice(1).join(", "),
        kind: (place.type ?? place.class ?? "place").replace(/_/g, " "),
        lat,
        lon,
        radiusM: suggestedRadius(place),
      };
    })
    .filter((result): result is GeocodeResult => result !== null);

  return Response.json(
    { results },
    { headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}` } }
  );
}
