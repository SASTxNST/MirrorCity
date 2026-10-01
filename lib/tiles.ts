// Vector-tile source for the base scene.
//
// Overpass runs a live database query per request. Measured against the six
// starting places it answered in 20-30 seconds and failed outright a third of
// the time, which is why the map so often came up empty. These tiles are
// pre-built, served from a CDN with a ten-year cache header, and come back in
// under a second — so the scene always renders.
//
// The trade is detail: OpenFreeMap's building layer tops out at zoom 14 and
// generalises away small footprints. Connaught Place is 49 buildings here
// against Overpass's 451. The explorer therefore draws tiles first and lets
// Overpass replace them when it answers.

import { project, signedArea, centroid, type LatLng, type Vec2 } from "./geo.ts";
import { clipPolyline, clipRing, type OsmArea, type OsmBuilding, type OsmRoad, type OsmScene, type RoadClass } from "./osm.ts";

export type TileId = { z: number; x: number; y: number };

/**
 * How much of a wide scene to actually draw.
 *
 * A 10 km view holds about 126,000 building footprints, which is roughly
 * 400 MB of GPU geometry and more than a browser will hold. Most of them are
 * houses a few metres across that cover less than a pixel at that distance, so
 * detail is dropped by distance from the centre: everything near you, only
 * substantial structures far away. The scene reports what it dropped so the UI
 * can say so rather than quietly showing a thinner city.
 */
export type DetailBand = { beyondM: number; minFootprintM2: number };

export const DETAIL_BANDS: DetailBand[] = [
  { beyondM: 1500, minFootprintM2: 0 },
  { beyondM: 4000, minFootprintM2: 150 },
  { beyondM: 7000, minFootprintM2: 400 },
  { beyondM: Infinity, minFootprintM2: 900 },
];

// Minor roads and footpaths stop being legible well before buildings do.
const ROAD_DETAIL_LIMIT_M: Record<RoadClass, number> = {
  major: Infinity,
  minor: 4000,
  path: 2000,
  rail: Infinity,
};

function minFootprintAt(distanceM: number): number {
  for (const band of DETAIL_BANDS) if (distanceM <= band.beyondM) return band.minFootprintM2;
  return DETAIL_BANDS[DETAIL_BANDS.length - 1].minFootprintM2;
}

export type SceneDetail = { buildingsDropped: number; roadsDropped: number };

// OpenFreeMap serves the planet free, with no key and no referrer rules. The
// path carries a build date, so the template is read from its TileJSON rather
// than hard-coded here.
export const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
export const TILE_ZOOM = 14;
const EXTENT_FALLBACK = 4096;

// Heights in the tiles come from OSM's height and building:levels tags, and
// are 0 wherever nobody surveyed them.
const DEFAULT_HEIGHT_M = 8;

const ROAD_CLASS: Record<string, RoadClass> = {
  motorway: "major", trunk: "major", primary: "major", secondary: "major",
  motorway_construction: "major", trunk_construction: "major",
  tertiary: "minor", minor: "minor", service: "minor", track: "minor",
  path: "path", pedestrian: "path", footway: "path", steps: "path", cycleway: "path",
  rail: "rail", transit: "rail",
};

const ROAD_WIDTH_M: Record<RoadClass, number> = { major: 13, minor: 7, path: 2.5, rail: 4 };

export function lonLatToTile(point: LatLng, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = ((point.lon + 180) / 360) * n;
  const latRad = (point.lat * Math.PI) / 180;
  const y = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

// Every tile touching the square of `radiusM` around `centre`. At zoom 14 a
// district needs one to four.
export function tilesCovering(centre: LatLng, radiusM: number, zoom = TILE_ZOOM): TileId[] {
  const metresPerDegLat = 111_320;
  const metresPerDegLon = Math.max(1, 111_320 * Math.cos((centre.lat * Math.PI) / 180));
  const south = centre.lat - radiusM / metresPerDegLat;
  const north = centre.lat + radiusM / metresPerDegLat;
  const west = centre.lon - radiusM / metresPerDegLon;
  const east = centre.lon + radiusM / metresPerDegLon;

  const topLeft = lonLatToTile({ lat: north, lon: west }, zoom);
  const bottomRight = lonLatToTile({ lat: south, lon: east }, zoom);
  const limit = 2 ** zoom;

  const tiles: TileId[] = [];
  for (let x = Math.floor(topLeft.x); x <= Math.floor(bottomRight.x); x++) {
    for (let y = Math.floor(topLeft.y); y <= Math.floor(bottomRight.y); y++) {
      if (x < 0 || y < 0 || x >= limit || y >= limit) continue;
      tiles.push({ z: zoom, x, y });
    }
  }
  return tiles;
}

// Tile-local coordinates (0..extent) back to geographic.
function unprojectTile(tile: TileId, extent: number, px: number, py: number): LatLng {
  const n = 2 ** tile.z;
  const x = (tile.x + px / extent) / n;
  const y = (tile.y + py / extent) / n;
  return {
    lon: x * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
  };
}

// The slice of @mapbox/vector-tile this module needs, declared structurally so
// the parser can be tested with plain objects.
type TileFeature = {
  type: number;
  properties: Record<string, unknown>;
  loadGeometry(): Array<Array<{ x: number; y: number }>>;
};
type TileLayer = { extent?: number; length: number; feature(index: number): TileFeature };
export type DecodedTile = { layers: Record<string, TileLayer | undefined> };

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function ringToVec2(ring: Array<{ x: number; y: number }>, tile: TileId, extent: number, origin: LatLng): Vec2[] {
  return ring.map((point) => project(unprojectTile(tile, extent, point.x, point.y), origin));
}

// Vector tiles wind outer rings clockwise and holes counter-clockwise, in tile
// space where y grows downward. Projecting to metres puts north at +y, which
// preserves that handedness, so an outer ring stays clockwise and keeps a
// positive signed area.
function isHole(ring: Vec2[]): boolean {
  return signedArea(ring) < 0;
}

// Builds a scene from already-decoded tiles. Geometry is clipped to the same
// box the Overpass path uses, so the two sources are interchangeable and the
// statistics mean the same thing either way.
export function tilesToScene(
  decoded: Array<{ tile: TileId; data: DecodedTile }>,
  origin: LatLng,
  radiusM: number,
  detail?: SceneDetail
): OsmScene {
  const dropped = detail ?? { buildingsDropped: 0, roadsDropped: 0 };
  const scene: OsmScene = { origin, radiusM, buildings: [], roads: [], areas: [] };
  const box = { minX: -radiusM, maxX: radiusM, minY: -radiusM, maxY: radiusM };

  for (const { tile, data } of decoded) {
    const key = `${tile.z}/${tile.x}/${tile.y}`;

    const buildings = data.layers.building;
    if (buildings) {
      const extent = buildings.extent ?? EXTENT_FALLBACK;
      for (let i = 0; i < buildings.length; i++) {
        const feature = buildings.feature(i);
        if (feature.type !== 3) continue;
        const rings = feature.loadGeometry().map((ring) => ringToVec2(ring, tile, extent, origin));
        const outer = rings.filter((ring) => ring.length >= 3 && !isHole(ring));
        const holes = rings.filter((ring) => ring.length >= 3 && isHole(ring));
        if (outer.length === 0) continue;

        const tagged = num(feature.properties.render_height);
        const base = num(feature.properties.render_min_height) ?? 0;
        // A tile height of 0 means nobody surveyed it, not a flat building.
        const surveyed = tagged !== null && tagged > 0;
        const heightM = surveyed ? Math.max(2, tagged - base) : DEFAULT_HEIGHT_M;

        outer.forEach((raw, index) => {
          const ring = clipRing(raw, box);
          if (ring.length < 3) return;
          const centre = centroid(ring);
          const footprint = Math.abs(signedArea(ring));
          // Chebyshev distance, matching the square the scene is clipped to.
          const away = Math.max(Math.abs(centre.x), Math.abs(centre.y));
          if (footprint < minFootprintAt(away)) {
            dropped.buildingsDropped++;
            return;
          }
          scene.buildings.push({
            id: `tile/${key}/b${i}${outer.length > 1 ? `#${index}` : ""}`,
            name: null,
            kind: "building",
            heightM,
            levels: null,
            heightSource: surveyed ? "tag" : "assumed",
            ring,
            holes: index === 0 ? holes : [],
            centre,
            footprintM2: footprint,
            tags: { source: "openfreemap", ...(surveyed ? { height: String(tagged) } : {}) },
          });
        });
      }
    }

    const transportation = data.layers.transportation;
    if (transportation) {
      const extent = transportation.extent ?? EXTENT_FALLBACK;
      for (let i = 0; i < transportation.length; i++) {
        const feature = transportation.feature(i);
        if (feature.type !== 2) continue;
        const className = String(feature.properties.class ?? "minor");
        const kind = ROAD_CLASS[className];
        if (!kind) continue;
        for (const [part, line] of feature.loadGeometry().entries()) {
          const points = ringToVec2(line, tile, extent, origin);
          for (const [run, clipped] of clipPolyline(points, box).entries()) {
            const away = Math.max(
              ...clipped.map((point) => Math.max(Math.abs(point.x), Math.abs(point.y)))
            );
            if (away > ROAD_DETAIL_LIMIT_M[kind]) {
              dropped.roadsDropped++;
              continue;
            }
            scene.roads.push({
              id: `tile/${key}/r${i}-${part}-${run}`,
              name: typeof feature.properties.name === "string" ? feature.properties.name : null,
              kind,
              highway: className,
              widthM: ROAD_WIDTH_M[kind],
              lanes: null,
              points: clipped,
              lengthM: clipped.reduce(
                (sum, point, index) => (index === 0 ? 0 : sum + Math.hypot(point.x - clipped[index - 1].x, point.y - clipped[index - 1].y)),
                0
              ),
              tags: { class: className },
            });
          }
        }
      }
    }

    for (const [layerName, areaKind] of [["water", "water"], ["park", "green"], ["landcover", "green"]] as const) {
      const layer = data.layers[layerName];
      if (!layer) continue;
      const extent = layer.extent ?? EXTENT_FALLBACK;
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        if (feature.type !== 3) continue;
        // landcover carries sand and ice as well as vegetation.
        if (layerName === "landcover") {
          const className = String(feature.properties.class ?? "");
          if (!["wood", "grass", "farmland", "scrub"].includes(className)) continue;
        }
        for (const [part, ring] of feature.loadGeometry().entries()) {
          const projected = ringToVec2(ring, tile, extent, origin);
          if (projected.length < 3 || isHole(projected)) continue;
          const clipped = clipRing(projected, box);
          if (clipped.length < 3) continue;
          scene.areas.push({
            id: `tile/${key}/${layerName}${i}-${part}`,
            name: typeof feature.properties.name === "string" ? feature.properties.name : null,
            kind: areaKind,
            ring: clipped,
            areaM2: Math.abs(signedArea(clipped)),
          });
        }
      }
    }
  }

  scene.areas.sort((a, b) => b.areaM2 - a.areaM2);
  return scene;
}

export type { OsmArea, OsmBuilding, OsmRoad };

// ─── Critical facilities ─────────────────────────────────────────────────────
//
// The tiles already carry a named POI layer, so the facilities a resilience
// view cares about cost nothing extra to extract: the Connaught Place tile
// alone holds 173 of them. This works anywhere on Earth, unlike the camera
// feeds, which only a handful of transport authorities publish.

export type FacilityKind = "hospital" | "police" | "fire" | "school" | "transit";

export type Facility = {
  id: string;
  name: string;
  kind: FacilityKind;
  /** The OpenMapTiles subclass, e.g. "clinic" under "hospital". */
  detail: string;
  point: Vec2;
};

const FACILITY_KIND: Record<string, FacilityKind> = {
  hospital: "hospital",
  police: "police",
  fire_station: "fire",
  school: "school",
  college: "school",
  bus: "transit",
  railway: "transit",
};

export function tilesToFacilities(
  decoded: Array<{ tile: TileId; data: DecodedTile }>,
  origin: LatLng,
  radiusM: number
): Facility[] {
  const out: Facility[] = [];
  const seen = new Set<string>();

  for (const { tile, data } of decoded) {
    const layer = data.layers.poi;
    if (!layer) continue;
    const extent = layer.extent ?? EXTENT_FALLBACK;

    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      // POIs are points; anything else in this layer is not a facility.
      if (feature.type !== 1) continue;
      const kind = FACILITY_KIND[String(feature.properties.class ?? "")];
      if (!kind) continue;
      const name = typeof feature.properties.name === "string" ? feature.properties.name.trim() : "";
      // An unnamed clinic cannot be acted on, so it is noise in a list.
      if (name.length === 0) continue;

      const geometry = feature.loadGeometry()[0]?.[0];
      if (!geometry) continue;
      const point = project(unprojectTile(tile, extent, geometry.x, geometry.y), origin);
      if (Math.abs(point.x) > radiusM || Math.abs(point.y) > radiusM) continue;

      // Tiles repeat a POI across tile seams; the name and rounded position
      // identify it well enough to drop the duplicate.
      const key = `${name}|${Math.round(point.x)}|${Math.round(point.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        id: `poi/${tile.z}/${tile.x}/${tile.y}/${i}`,
        name,
        kind,
        detail: String(feature.properties.subclass ?? kind).replace(/_/g, " "),
        point,
      });
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}
