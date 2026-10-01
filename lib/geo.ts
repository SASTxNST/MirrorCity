// Geographic maths for district-scale scenes.
//
// Everything MirrorCity renders sits inside a few square kilometres, so an
// equirectangular projection about a fixed origin is enough: across 2 km it
// differs from a proper UTM transform by centimetres, and unlike UTM it has a
// trivial inverse, which the picking and placement code needs.

export type LatLng = { lat: number; lon: number };
export type Vec2 = { x: number; y: number };
export type BoundingBox = { south: number; west: number; north: number; east: number };

const EARTH_RADIUS_M = 6_378_137;
const DEG = Math.PI / 180;

// Metres covered by one degree of latitude and of longitude at `lat`.
// Latitude uses a spherical approximation (~111.32 km); the true ellipsoidal
// value varies by ±0.5% from pole to equator, which district-scale work can
// absorb.
export function metresPerDegree(lat: number): { lat: number; lon: number } {
  return { lat: EARTH_RADIUS_M * DEG, lon: EARTH_RADIUS_M * DEG * Math.cos(lat * DEG) };
}

// Geographic point to local metres east (x) and north (y) of `origin`.
export function project(point: LatLng, origin: LatLng): Vec2 {
  const scale = metresPerDegree(origin.lat);
  return { x: (point.lon - origin.lon) * scale.lon, y: (point.lat - origin.lat) * scale.lat };
}

// Inverse of `project`.
export function unproject(point: Vec2, origin: LatLng): LatLng {
  const scale = metresPerDegree(origin.lat);
  return { lat: origin.lat + point.y / scale.lat, lon: origin.lon + point.x / scale.lon };
}

// Square bounding box of `radiusM` around `origin`, clamped to valid ranges.
export function boundingBox(origin: LatLng, radiusM: number): BoundingBox {
  const scale = metresPerDegree(origin.lat);
  const dLat = radiusM / scale.lat;
  // Near the poles cos(lat) collapses and the longitude span explodes; clamp
  // rather than emit a bbox Overpass will reject.
  const dLon = Math.min(180, radiusM / Math.max(scale.lon, 1));
  return {
    south: Math.max(-90, origin.lat - dLat),
    west: Math.max(-180, origin.lon - dLon),
    north: Math.min(90, origin.lat + dLat),
    east: Math.min(180, origin.lon + dLon),
  };
}

// Great-circle distance in metres.
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Signed area of a projected ring, in m². Positive means clockwise, since
// projected coordinates put north at +y.
export function signedArea(ring: Vec2[]): number {
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    total += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return total / 2;
}

// Area-weighted centroid of a projected ring, falling back to the vertex mean
// for degenerate (zero-area) rings.
export function centroid(ring: Vec2[]): Vec2 {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
    twiceArea += cross;
    x += (ring[j].x + ring[i].x) * cross;
    y += (ring[j].y + ring[i].y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) {
    const mean = ring.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: mean.x / ring.length, y: mean.y / ring.length };
  }
  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}
