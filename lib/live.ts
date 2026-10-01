// Parsers for the public feeds behind the live layers.
//
// Each upstream has its own shape and its own idea of units: OpenSky sends
// positional arrays with nulls scattered through them, USGS sends GeoJSON in
// kilometres, Open-Meteo sends parallel arrays of current values. Everything
// is normalised here, in SI units, so the UI never has to know which service a
// number came from. Pure functions, so the handling of real malformed
// responses can be tested without the network.

import { distanceM, type LatLng } from "./geo.ts";

export type Aircraft = {
  id: string;
  callsign: string | null;
  country: string;
  lat: number;
  lon: number;
  /** Geometric altitude in metres, falling back to barometric. */
  altitudeM: number | null;
  /** Ground speed, metres per second. */
  speedMs: number | null;
  /** True track, degrees clockwise from north. */
  headingDeg: number | null;
  verticalRateMs: number | null;
  onGround: boolean;
  /** Metres from the scene centre. */
  distanceM: number;
};

export type Quake = {
  id: string;
  magnitude: number;
  place: string;
  lat: number;
  lon: number;
  depthKm: number;
  time: number;
  url: string;
  distanceM: number;
};

export type AirReading = {
  temperatureC: number | null;
  humidityPercent: number | null;
  precipitationMm: number | null;
  windKph: number | null;
  pm25: number | null;
  pm10: number | null;
  usAqi: number | null;
  observedAt: string | null;
};

// OpenSky's state vector is a fixed-position array. These are the indices the
// API documents; anything can be null on any given sweep.
const OS = {
  icao24: 0, callsign: 1, country: 2, lon: 5, lat: 6, baroAltitude: 7,
  onGround: 8, velocity: 9, track: 10, verticalRate: 11, geoAltitude: 13,
} as const;

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseAircraft(payload: unknown, centre: LatLng): Aircraft[] {
  const states = (payload as { states?: unknown[][] } | null)?.states;
  if (!Array.isArray(states)) return [];

  const out: Aircraft[] = [];
  for (const state of states) {
    if (!Array.isArray(state)) continue;
    const lat = finite(state[OS.lat]);
    const lon = finite(state[OS.lon]);
    // A state vector with no position is still broadcast; it just cannot be drawn.
    if (lat === null || lon === null) continue;

    const callsign = typeof state[OS.callsign] === "string" ? (state[OS.callsign] as string).trim() : "";
    out.push({
      id: String(state[OS.icao24] ?? `${lat},${lon}`),
      callsign: callsign.length > 0 ? callsign : null,
      country: typeof state[OS.country] === "string" ? (state[OS.country] as string) : "Unknown",
      lat,
      lon,
      altitudeM: finite(state[OS.geoAltitude]) ?? finite(state[OS.baroAltitude]),
      speedMs: finite(state[OS.velocity]),
      headingDeg: finite(state[OS.track]),
      verticalRateMs: finite(state[OS.verticalRate]),
      onGround: state[OS.onGround] === true,
      distanceM: distanceM(centre, { lat, lon }),
    });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

export function parseQuakes(payload: unknown, centre: LatLng): Quake[] {
  const features = (payload as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];

  const out: Quake[] = [];
  for (const entry of features) {
    const feature = entry as {
      id?: string;
      properties?: { mag?: number; place?: string; time?: number; url?: string };
      geometry?: { coordinates?: number[] };
    };
    const coordinates = feature.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const lon = finite(coordinates[0]);
    const lat = finite(coordinates[1]);
    const magnitude = finite(feature.properties?.mag);
    // USGS publishes unreviewed events with a null magnitude; they carry no
    // information for a severity readout.
    if (lat === null || lon === null || magnitude === null) continue;

    out.push({
      id: feature.id ?? `${lat},${lon},${feature.properties?.time ?? 0}`,
      magnitude,
      place: feature.properties?.place ?? "Unknown location",
      lat,
      lon,
      depthKm: finite(coordinates[2]) ?? 0,
      time: finite(feature.properties?.time) ?? 0,
      url: feature.properties?.url ?? "",
      distanceM: distanceM(centre, { lat, lon }),
    });
  }
  return out;
}

export function parseAir(weather: unknown, air: unknown): AirReading {
  const current = (weather as { current?: Record<string, unknown> } | null)?.current ?? {};
  const quality = (air as { current?: Record<string, unknown> } | null)?.current ?? {};
  return {
    temperatureC: finite(current.temperature_2m),
    humidityPercent: finite(current.relative_humidity_2m),
    precipitationMm: finite(current.precipitation),
    windKph: finite(current.wind_speed_10m),
    pm25: finite(quality.pm2_5),
    pm10: finite(quality.pm10),
    usAqi: finite(quality.us_aqi),
    observedAt: typeof quality.time === "string" ? quality.time : typeof current.time === "string" ? current.time : null,
  };
}

// US EPA bands. Named rather than coloured here so the UI decides how to show
// severity, and so the thresholds live in one place.
export function aqiBand(aqi: number | null): { label: string; severity: 0 | 1 | 2 | 3 | 4 | 5 } {
  if (aqi === null) return { label: "No reading", severity: 0 };
  if (aqi <= 50) return { label: "Good", severity: 1 };
  if (aqi <= 100) return { label: "Moderate", severity: 2 };
  if (aqi <= 150) return { label: "Unhealthy for sensitive groups", severity: 3 };
  if (aqi <= 200) return { label: "Unhealthy", severity: 4 };
  return { label: "Hazardous", severity: 5 };
}

// A degrees-wide box around a point, for feeds that take a bbox rather than a
// radius. Clamped so a request near a pole or the antimeridian stays valid.
export function degreeBox(centre: LatLng, degrees: number) {
  return {
    lamin: Math.max(-90, centre.lat - degrees),
    lamax: Math.min(90, centre.lat + degrees),
    lomin: Math.max(-180, centre.lon - degrees),
    lomax: Math.min(180, centre.lon + degrees),
  };
}

export function compass(from: LatLng, to: LatLng): string {
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const bearing =
    (Math.atan2(
      Math.sin(dLon) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
    ) *
      180) /
    Math.PI;
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round(((bearing + 360) % 360) / 45) % 8];
}
