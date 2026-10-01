// GET /api/live/cameras?lat=&lon=&radius= — public traffic cameras near the
// scene.
//
// These are cameras transport authorities publish for the public to watch:
// Transport for London's JamCams and Caltrans' highway CCTV. Both are keyless.
// Coverage is the catch — no Indian city publishes an equivalent open feed, so
// outside the regions below the route returns an empty list and says why
// rather than pretending the layer is broken.

import { distanceM } from "../../../../lib/geo.ts";
import { cachedJson, fetchJson, isResponse, readCentre, type Centre } from "../_shared.ts";

// TfL refreshes JamCam stills roughly every five minutes; Caltrans every
// minute or so. The catalogues themselves barely move, so they cache longer
// and the image URLs are cache-busted client-side instead.
const CACHE_SECONDS = 900;
const DEFAULT_RADIUS_M = 4000;
const MAX_RADIUS_M = 25_000;
const MAX_RESULTS = 40;

export type Camera = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Still image, refreshed by the operator. */
  imageUrl: string | null;
  /** Video, where the operator publishes one (MP4 for TfL, HLS for Caltrans). */
  videoUrl: string | null;
  operator: string;
  distanceM: number;
};

type Region = { name: string; operator: string; south: number; west: number; north: number; east: number; url: string };

// Caltrans splits its cameras by district, so only the districts that cover a
// populated region are listed here.
const REGIONS: Region[] = [
  { name: "London", operator: "Transport for London", south: 51.25, west: -0.55, north: 51.72, east: 0.35, url: "https://api.tfl.gov.uk/Place/Type/JamCam" },
  { name: "Bay Area", operator: "Caltrans D4", south: 36.9, west: -123.2, north: 38.9, east: -121.2, url: "https://cwwp2.dot.ca.gov/data/d4/cctv/cctvStatusD04.json" },
  { name: "Los Angeles", operator: "Caltrans D7", south: 33.2, west: -119.3, north: 34.9, east: -117.4, url: "https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json" },
  { name: "San Diego", operator: "Caltrans D11", south: 32.4, west: -117.7, north: 33.5, east: -115.8, url: "https://cwwp2.dot.ca.gov/data/d11/cctv/cctvStatusD11.json" },
  { name: "Sacramento", operator: "Caltrans D3", south: 38.2, west: -122.1, north: 39.6, east: -120.3, url: "https://cwwp2.dot.ca.gov/data/d3/cctv/cctvStatusD03.json" },
];

function regionFor(centre: Centre): Region | null {
  return (
    REGIONS.find(
      (region) =>
        centre.lat >= region.south && centre.lat <= region.north && centre.lon >= region.west && centre.lon <= region.east
    ) ?? null
  );
}

type TflPlace = {
  id?: string;
  commonName?: string;
  lat?: number;
  lon?: number;
  additionalProperties?: Array<{ key?: string; value?: string }>;
};

export function parseTfl(payload: unknown, centre: Centre, operator: string): Camera[] {
  if (!Array.isArray(payload)) return [];
  const out: Camera[] = [];
  for (const entry of payload as TflPlace[]) {
    const lat = entry.lat;
    const lon = entry.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const props = new Map((entry.additionalProperties ?? []).map((item) => [item.key, item.value]));
    // TfL marks cameras that are temporarily down; they return a stale frame.
    if (props.get("available") === "false") continue;
    out.push({
      id: entry.id ?? `${lat},${lon}`,
      name: entry.commonName ?? "Camera",
      lat,
      lon,
      imageUrl: props.get("imageUrl") ?? null,
      videoUrl: props.get("videoUrl") ?? null,
      operator,
      distanceM: distanceM(centre, { lat, lon }),
    });
  }
  return out;
}

type CaltransEntry = {
  cctv?: {
    index?: string;
    location?: { locationName?: string; latitude?: string | number; longitude?: string | number };
    imageData?: { static?: { currentImageURL?: string }; streamingVideoURL?: string };
    inService?: string;
  };
};

export function parseCaltrans(payload: unknown, centre: Centre, operator: string): Camera[] {
  const rows = (payload as { data?: CaltransEntry[] } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: Camera[] = [];
  for (const row of rows) {
    const cctv = row.cctv;
    if (!cctv?.location) continue;
    // Caltrans publishes latitude and longitude as strings, and uses "0" for
    // cameras whose position has not been surveyed.
    const lat = Number(cctv.location.latitude);
    const lon = Number(cctv.location.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    if (cctv.inService === "false") continue;
    out.push({
      id: cctv.index ?? `${lat},${lon}`,
      name: cctv.location.locationName ?? "Camera",
      lat,
      lon,
      imageUrl: cctv.imageData?.static?.currentImageURL ?? null,
      videoUrl: cctv.imageData?.streamingVideoURL ?? null,
      operator,
      distanceM: distanceM(centre, { lat, lon }),
    });
  }
  return out;
}

export async function GET(request: Request) {
  const centre = readCentre(request);
  if (isResponse(centre)) return centre;

  const requested = Number(new URL(request.url).searchParams.get("radius") ?? DEFAULT_RADIUS_M);
  const radius = Number.isFinite(requested) ? Math.min(MAX_RADIUS_M, Math.max(250, requested)) : DEFAULT_RADIUS_M;

  const region = regionFor(centre);
  if (!region) {
    return Response.json({
      cameras: [],
      region: null,
      note: "No open camera feed covers this area. The layer is wired to Transport for London and Caltrans, the authorities that publish one.",
    });
  }

  return cachedJson(
    `https://mirrorcity.live/cameras?region=${encodeURIComponent(region.name)}&lat=${centre.lat.toFixed(2)}&lon=${centre.lon.toFixed(2)}&radius=${Math.round(radius)}`,
    CACHE_SECONDS,
    async () => {
      const payload = await fetchJson(region.url, 25_000);
      if (payload === null) {
        return { body: { error: `${region.operator} is not responding.`, cameras: [], region: region.name }, status: 502 };
      }

      const all = region.url.includes("tfl.gov.uk")
        ? parseTfl(payload, centre, region.operator)
        : parseCaltrans(payload, centre, region.operator);

      const near = all.filter((camera) => camera.distanceM <= radius).sort((a, b) => a.distanceM - b.distanceM);

      return {
        body: {
          cameras: near.slice(0, MAX_RESULTS),
          nearby: near.length,
          total: all.length,
          region: region.name,
          operator: region.operator,
          fetchedAt: new Date().toISOString(),
        },
      };
    }
  );
}
