// Turns an Overpass API response into a projected, renderable scene.
//
// OpenStreetMap describes the world as tagged ways and relations with no
// heights and no geometry classes. This module does the interpretation: which
// ways are buildings, how tall each one is, which roads carry traffic, and
// where every vertex lands in local metres. It is deliberately pure so the
// heuristics can be tested against captured Overpass fixtures.

import { centroid, project, signedArea, type LatLng, type Vec2 } from "./geo.ts";

export type RoadClass = "major" | "minor" | "path" | "rail";
export type AreaKind = "water" | "green";

export type OsmBuilding = {
  id: string;
  name: string | null;
  kind: string;
  heightM: number;
  levels: number | null;
  heightSource: "tag" | "levels" | "assumed";
  ring: Vec2[];
  holes: Vec2[][];
  centre: Vec2;
  footprintM2: number;
  tags: Record<string, string>;
};

export type OsmRoad = {
  id: string;
  name: string | null;
  kind: RoadClass;
  highway: string;
  widthM: number;
  lanes: number | null;
  points: Vec2[];
  lengthM: number;
  tags: Record<string, string>;
};

export type OsmArea = { id: string; name: string | null; kind: AreaKind; ring: Vec2[]; areaM2: number };

export type OsmScene = {
  origin: LatLng;
  radiusM: number;
  buildings: OsmBuilding[];
  roads: OsmRoad[];
  areas: OsmArea[];
};

type OverpassPoint = { lat: number; lon: number };
type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  geometry?: OverpassPoint[];
  members?: Array<{ type: string; role?: string; geometry?: OverpassPoint[] }>;
};

// A storey is ~3.2 m including floor structure; OSM's `building:levels` counts
// above-ground storeys only.
const METRES_PER_LEVEL = 3.2;

// Fallback heights, in metres, when a building carries neither `height` nor
// `building:levels` — which is most of the world outside mapped city centres.
const ASSUMED_HEIGHT: Record<string, number> = {
  house: 6,
  detached: 6,
  bungalow: 4,
  hut: 3,
  shed: 3,
  garage: 3,
  garages: 3,
  roof: 3,
  carport: 3,
  kiosk: 3,
  residential: 11,
  apartments: 17,
  dormitory: 14,
  hotel: 20,
  commercial: 14,
  retail: 9,
  supermarket: 8,
  office: 22,
  industrial: 10,
  warehouse: 10,
  hospital: 20,
  school: 9,
  college: 13,
  university: 16,
  church: 14,
  temple: 12,
  mosque: 14,
  train_station: 12,
  stadium: 24,
};
const DEFAULT_ASSUMED_HEIGHT = 8;

const ROAD_CLASS: Record<string, RoadClass> = {
  motorway: "major", motorway_link: "major", trunk: "major", trunk_link: "major",
  primary: "major", primary_link: "major", secondary: "major", secondary_link: "major",
  tertiary: "minor", tertiary_link: "minor", residential: "minor", unclassified: "minor",
  living_street: "minor", service: "minor", track: "minor",
  footway: "path", path: "path", pedestrian: "path", steps: "path", cycleway: "path", bridleway: "path",
};

// Rendered carriageway width when the way has no `width` or `lanes` tag.
const ASSUMED_ROAD_WIDTH: Record<RoadClass, number> = { major: 12, minor: 7, path: 2.5, rail: 4 };
const LANE_WIDTH_M = 3.2;

// Reads OSM's loosely-typed numeric tags: "12", "12.5 m", "40'" (feet), "12;14".
export function parseLength(raw: string | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim().split(";")[0];
  const match = /^(-?\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|')?$/i.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = (match[2] ?? "").toLowerCase();
  return unit === "ft" || unit === "feet" || unit === "'" ? value * 0.3048 : value;
}

function parseCount(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Height for one building, preferring surveyed tags over inference.
// `building:height` is a common alias; `min_height` lifts structures that sit
// on a podium, so the drawn extrusion is height minus that base.
export function buildingHeight(tags: Record<string, string>): {
  heightM: number;
  levels: number | null;
  source: OsmBuilding["heightSource"];
} {
  const levels = parseCount(tags["building:levels"]);
  const tagged = parseLength(tags.height) ?? parseLength(tags["building:height"]);
  if (tagged !== null) {
    const base = parseLength(tags.min_height) ?? 0;
    return { heightM: Math.max(2, tagged - base), levels, source: "tag" };
  }
  if (levels !== null) {
    const roof = parseCount(tags["roof:levels"]) ?? 0;
    return { heightM: Math.max(2, (levels + roof) * METRES_PER_LEVEL), levels, source: "levels" };
  }
  const kind = tags.building === "yes" ? tags["building:use"] ?? tags.amenity ?? "" : tags.building ?? "";
  return { heightM: ASSUMED_HEIGHT[kind] ?? DEFAULT_ASSUMED_HEIGHT, levels: null, source: "assumed" };
}

// Rendered width for one road.
export function roadWidth(tags: Record<string, string>, kind: RoadClass): { widthM: number; lanes: number | null } {
  const lanes = parseCount(tags.lanes);
  const tagged = parseLength(tags.width) ?? parseLength(tags["est_width"]);
  if (tagged !== null) return { widthM: Math.min(60, tagged), lanes };
  if (lanes !== null) return { widthM: Math.min(60, lanes * LANE_WIDTH_M), lanes };
  return { widthM: ASSUMED_ROAD_WIDTH[kind], lanes };
}

function toRing(geometry: OverpassPoint[], origin: LatLng): Vec2[] | null {
  // Overpass omits vertices that fall outside the query bbox, which can leave
  // a "way" with too few points to form a face.
  const points = geometry.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map((p) => project(p, origin));
  if (points.length < 4) return null;
  const first = points[0];
  const last = points[points.length - 1];
  // Drop the repeated closing vertex; Three.js shapes close themselves.
  if (Math.abs(first.x - last.x) < 0.01 && Math.abs(first.y - last.y) < 0.01) points.pop();
  return points.length >= 3 ? points : null;
}

function polylineLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function isBuilding(tags: Record<string, string>): boolean {
  const value = tags.building ?? tags["building:part"];
  return Boolean(value) && value !== "no";
}

function areaKind(tags: Record<string, string>): AreaKind | null {
  if (tags.natural === "water" || tags.waterway === "riverbank" || tags.landuse === "reservoir" || tags.landuse === "basin") {
    return "water";
  }
  if (
    tags.leisure === "park" || tags.leisure === "garden" || tags.leisure === "pitch" ||
    tags.leisure === "golf_course" || tags.leisure === "recreation_ground" ||
    tags.natural === "wood" || tags.natural === "scrub" || tags.natural === "grassland" ||
    tags.landuse === "grass" || tags.landuse === "forest" || tags.landuse === "meadow" ||
    tags.landuse === "recreation_ground" || tags.landuse === "village_green"
  ) {
    return "green";
  }
  return null;
}

function roadClass(tags: Record<string, string>): RoadClass | null {
  if (tags.railway && tags.railway !== "abandoned" && tags.railway !== "razed") return "rail";
  const highway = tags.highway;
  if (!highway) return null;
  // Construction and proposed alignments are not on the ground yet.
  if (highway === "construction" || highway === "proposed" || highway === "raceway") return null;
  return ROAD_CLASS[highway] ?? "minor";
}


// ─── Clipping ────────────────────────────────────────────────────────────────
//
// Overpass returns each way's *complete* geometry whenever any part of it
// falls inside the query box, so a single national highway can arrive
// hundreds of kilometres long. Left alone it would both draw tails running
// off the scene and inflate every "road network" figure, so geometry is cut
// to the box that was actually requested.

type Box = { minX: number; maxX: number; minY: number; maxY: number };

function inside(point: Vec2, box: Box, edge: number): boolean {
  if (edge === 0) return point.x >= box.minX;
  if (edge === 1) return point.x <= box.maxX;
  if (edge === 2) return point.y >= box.minY;
  return point.y <= box.maxY;
}

// Where segment a→b crosses the given edge of the box.
function intersect(a: Vec2, b: Vec2, box: Box, edge: number): Vec2 {
  if (edge === 0 || edge === 1) {
    const x = edge === 0 ? box.minX : box.maxX;
    const t = (x - a.x) / (b.x - a.x);
    return { x, y: a.y + t * (b.y - a.y) };
  }
  const y = edge === 2 ? box.minY : box.maxY;
  const t = (y - a.y) / (b.y - a.y);
  return { x: a.x + t * (b.x - a.x), y };
}

// Sutherland–Hodgman against the four half-planes. The box is convex, so this
// is exact for any simple polygon.
export function clipRing(ring: Vec2[], box: Box): Vec2[] {
  let output = ring;
  for (let edge = 0; edge < 4 && output.length > 0; edge++) {
    const input = output;
    output = [];
    for (let i = 0, j = input.length - 1; i < input.length; j = i++) {
      const current = input[i];
      const previous = input[j];
      const currentIn = inside(current, box, edge);
      if (currentIn !== inside(previous, box, edge)) output.push(intersect(previous, current, box, edge));
      if (currentIn) output.push(current);
    }
  }
  return output.length >= 3 ? output : [];
}

// A polyline may leave and re-enter the box, so this returns each surviving
// run separately rather than joining them across the gap.
export function clipPolyline(points: Vec2[], box: Box): Vec2[][] {
  const within = (p: Vec2) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
  const runs: Vec2[][] = [];
  let run: Vec2[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const aIn = within(a);
    const bIn = within(b);

    if (aIn && bIn) {
      if (run.length === 0) run.push(a);
      run.push(b);
      continue;
    }

    // Walk the segment through each edge, trimming it to the part inside.
    let start = a;
    let end = b;
    let dropped = false;
    for (let edge = 0; edge < 4; edge++) {
      const startIn = inside(start, box, edge);
      const endIn = inside(end, box, edge);
      if (!startIn && !endIn) { dropped = true; break; }
      if (!startIn) start = intersect(start, end, box, edge);
      else if (!endIn) end = intersect(start, end, box, edge);
    }

    if (dropped) {
      if (run.length >= 2) runs.push(run);
      run = [];
      continue;
    }
    if (run.length === 0) run.push(start);
    run.push(end);
    // Leaving the box ends this run.
    if (!bIn) {
      if (run.length >= 2) runs.push(run);
      run = [];
    }
  }

  if (run.length >= 2) runs.push(run);
  return runs;
}

// Builds a scene from an Overpass `out geom` response. Unparseable elements
// are skipped rather than failing the whole request: OSM data is
// crowd-sourced and a single malformed way should not blank the map.
export function parseOverpass(payload: unknown, origin: LatLng, radiusM: number): OsmScene {
  const elements = (payload as { elements?: OverpassElement[] } | null)?.elements ?? [];
  const scene: OsmScene = { origin, radiusM, buildings: [], roads: [], areas: [] };
  const seen = new Set<string>();
  // The box Overpass was asked for, in local metres — `boundingBox` offsets
  // by exactly `radiusM` on both axes, so it projects back to a square.
  const box: Box = { minX: -radiusM, maxX: radiusM, minY: -radiusM, maxY: radiusM };

  for (const element of elements) {
    const tags = element.tags ?? {};
    const id = `${element.type}/${element.id}`;
    if (seen.has(id)) continue;

    // Rings for an area: a way contributes its own geometry, a multipolygon
    // relation contributes each outer member. Inner members become holes on
    // the first outer ring, which covers courtyard buildings.
    const outerGeometries: OverpassPoint[][] = [];
    const innerGeometries: OverpassPoint[][] = [];
    if (element.type === "way" && element.geometry) {
      outerGeometries.push(element.geometry);
    } else if (element.type === "relation" && element.members) {
      for (const member of element.members) {
        if (member.type !== "way" || !member.geometry) continue;
        (member.role === "inner" ? innerGeometries : outerGeometries).push(member.geometry);
      }
    }

    if (isBuilding(tags)) {
      const rings = outerGeometries.map((geometry) => toRing(geometry, origin)).filter((ring): ring is Vec2[] => ring !== null);
      if (rings.length === 0) continue;
      const holes = innerGeometries.map((geometry) => toRing(geometry, origin)).filter((ring): ring is Vec2[] => ring !== null);
      const { heightM, levels, source } = buildingHeight(tags);
      rings.forEach((ring, index) => {
        // Buildings are small enough that clipping them would only produce
        // sliced walls at the boundary, so whole ones are kept or dropped on
        // where their centre falls.
        const centre = centroid(ring);
        if (centre.x < box.minX || centre.x > box.maxX || centre.y < box.minY || centre.y > box.maxY) return;
        scene.buildings.push({
          id: rings.length > 1 ? `${id}#${index}` : id,
          name: tags.name ?? null,
          kind: tags.building === "yes" ? tags.amenity ?? tags["building:use"] ?? "building" : tags.building ?? "building",
          heightM,
          levels,
          heightSource: source,
          ring,
          // Holes belong to whichever outer ring encloses them; with one outer
          // ring — the overwhelming majority — that is unambiguous.
          holes: index === 0 ? holes : [],
          centre,
          footprintM2: Math.abs(signedArea(ring)),
          tags,
        });
      });
      seen.add(id);
      continue;
    }

    const kind = areaKind(tags);
    if (kind) {
      for (const [index, geometry] of outerGeometries.entries()) {
        const raw = toRing(geometry, origin);
        if (!raw) continue;
        const ring = clipRing(raw, box);
        if (ring.length < 3) continue;
        scene.areas.push({
          id: outerGeometries.length > 1 ? `${id}#${index}` : id,
          name: tags.name ?? null,
          kind,
          ring,
          areaM2: Math.abs(signedArea(ring)),
        });
      }
      seen.add(id);
      continue;
    }

    const road = roadClass(tags);
    if (road && element.type === "way" && element.geometry) {
      const full = element.geometry.map((p) => project(p, origin));
      if (full.length < 2) continue;
      const { widthM, lanes } = roadWidth(tags, road);
      const runs = clipPolyline(full, box);
      runs.forEach((points, index) => {
        scene.roads.push({
          id: runs.length > 1 ? `${id}#${index}` : id,
          name: tags.name ?? tags.ref ?? null,
          kind: road,
          highway: tags.highway ?? tags.railway ?? "road",
          widthM,
          lanes,
          points,
          lengthM: polylineLength(points),
          tags,
        });
      });
      seen.add(id);
    }
  }

  // Draw the largest areas first so a park never hides inside a landuse block.
  scene.areas.sort((a, b) => b.areaM2 - a.areaM2);
  return scene;
}

// The Overpass QL query behind a scene. Kept next to the parser so the tags
// requested and the tags interpreted stay in step.
export function overpassQuery(box: { south: number; west: number; north: number; east: number }, timeoutS = 30): string {
  const bbox = `${box.south.toFixed(6)},${box.west.toFixed(6)},${box.north.toFixed(6)},${box.east.toFixed(6)}`;
  return `[out:json][timeout:${timeoutS}];
(
  way["building"](${bbox});
  relation["building"](${bbox});
  way["highway"](${bbox});
  way["railway"~"^(rail|light_rail|subway|tram)$"](${bbox});
  way["natural"~"^(water|wood|scrub|grassland)$"](${bbox});
  way["waterway"="riverbank"](${bbox});
  way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|reservoir|basin)$"](${bbox});
  way["leisure"~"^(park|garden|pitch|golf_course|recreation_ground)$"](${bbox});
  relation["natural"="water"](${bbox});
  relation["leisure"~"^(park|garden)$"](${bbox});
);
out body geom;`;
}
