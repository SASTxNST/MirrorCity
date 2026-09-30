import assert from "node:assert/strict";
import test from "node:test";
import { boundingBox, centroid, distanceM, metresPerDegree, project, signedArea, unproject } from "../lib/geo.ts";
import { buildingHeight, clipPolyline, clipRing, overpassQuery, parseLength, parseOverpass, roadWidth } from "../lib/osm.ts";

const ORIGIN = { lat: 28.9986, lon: 77.0286 };

// A square of `side` metres with its south-west corner on the origin, written
// back out as lat/lon so the tests exercise the real projection both ways.
function squareAt(origin, side) {
  const scale = metresPerDegree(origin.lat);
  const dLat = side / scale.lat;
  const dLon = side / scale.lon;
  return [
    { lat: origin.lat, lon: origin.lon },
    { lat: origin.lat, lon: origin.lon + dLon },
    { lat: origin.lat + dLat, lon: origin.lon + dLon },
    { lat: origin.lat + dLat, lon: origin.lon },
    { lat: origin.lat, lon: origin.lon },
  ];
}

test("projection: round-trips, and a 100 m square measures 100 m on both axes", () => {
  const point = { lat: 28.9999, lon: 77.0301 };
  const back = unproject(project(point, ORIGIN), ORIGIN);
  assert.ok(Math.abs(back.lat - point.lat) < 1e-9);
  assert.ok(Math.abs(back.lon - point.lon) < 1e-9);

  const ring = squareAt(ORIGIN, 100).slice(0, 4).map((p) => project(p, ORIGIN));
  assert.ok(Math.abs(Math.abs(signedArea(ring)) - 10_000) < 1, "area within 1 m² of 100×100");
  const middle = centroid(ring);
  assert.ok(Math.abs(middle.x - 50) < 0.01 && Math.abs(middle.y - 50) < 0.01);
});

test("bounding box spans twice the radius through the origin", () => {
  const box = boundingBox(ORIGIN, 500);
  const northSouth = distanceM({ lat: box.south, lon: ORIGIN.lon }, { lat: box.north, lon: ORIGIN.lon });
  const eastWest = distanceM({ lat: ORIGIN.lat, lon: box.west }, { lat: ORIGIN.lat, lon: box.east });
  assert.ok(Math.abs(northSouth - 1000) < 5, `north-south ${northSouth}`);
  assert.ok(Math.abs(eastWest - 1000) < 5, `east-west ${eastWest}`);
});

test("bounding box stays valid at the poles, where a metre spans many degrees", () => {
  const box = boundingBox({ lat: 89.999, lon: 10 }, 1500);
  assert.ok(box.north <= 90 && box.south >= -90);
  assert.ok(box.east <= 180 && box.west >= -180);
});

test("parseLength reads the units OSM actually contains", () => {
  assert.equal(parseLength("12"), 12);
  assert.equal(parseLength(" 12.5 m "), 12.5);
  assert.equal(parseLength("8 meters"), 8);
  assert.ok(Math.abs(parseLength("40'") - 12.192) < 1e-6);
  assert.ok(Math.abs(parseLength("40 ft") - 12.192) < 1e-6);
  assert.equal(parseLength("12;14"), 12, "a multi-value tag takes the first");
  assert.equal(parseLength("about 12"), null);
  assert.equal(parseLength("0"), null, "zero height is not a height");
  assert.equal(parseLength(undefined), null);
});

test("building height prefers a surveyed tag, then storeys, then the building type", () => {
  assert.deepEqual(buildingHeight({ height: "24 m", "building:levels": "7" }), { heightM: 24, levels: 7, source: "tag" });

  // A tower on a 10 m podium is drawn as the 30 m that stands above it.
  assert.equal(buildingHeight({ height: "40", min_height: "10" }).heightM, 30);

  const levels = buildingHeight({ "building:levels": "5", "roof:levels": "1" });
  assert.equal(levels.source, "levels");
  assert.ok(Math.abs(levels.heightM - 6 * 3.2) < 1e-9);

  assert.deepEqual(buildingHeight({ building: "house" }), { heightM: 6, levels: null, source: "assumed" });
  assert.equal(buildingHeight({ building: "something_unmapped" }).heightM, 8, "unknown types get the default");
  assert.equal(buildingHeight({ building: "yes", amenity: "hospital" }).heightM, 20, "building=yes falls through to amenity");
});

test("road width prefers a width tag, then lane count, then the road class", () => {
  assert.equal(roadWidth({ width: "18" }, "major").widthM, 18);
  assert.equal(roadWidth({ lanes: "4" }, "major").widthM, 4 * 3.2);
  assert.equal(roadWidth({}, "major").widthM, 12);
  assert.equal(roadWidth({}, "path").widthM, 2.5);
  assert.equal(roadWidth({ width: "900" }, "major").widthM, 60, "an absurd width tag is clamped");
});

test("parseOverpass classifies ways and measures them in metres", () => {
  const scene = parseOverpass(
    {
      elements: [
        { type: "way", id: 1, tags: { building: "apartments", name: "Block A", "building:levels": "4" }, geometry: squareAt(ORIGIN, 30) },
        { type: "way", id: 2, tags: { highway: "primary", name: "Ring Road", lanes: "4" }, geometry: squareAt(ORIGIN, 80).slice(0, 2) },
        { type: "way", id: 3, tags: { highway: "footway" }, geometry: squareAt(ORIGIN, 40).slice(0, 2) },
        { type: "way", id: 4, tags: { natural: "water", name: "Tank" }, geometry: squareAt(ORIGIN, 50) },
        { type: "way", id: 5, tags: { leisure: "park" }, geometry: squareAt(ORIGIN, 70) },
        { type: "way", id: 6, tags: { highway: "construction" }, geometry: squareAt(ORIGIN, 20).slice(0, 2) },
        { type: "way", id: 7, tags: { building: "no" }, geometry: squareAt(ORIGIN, 20) },
      ],
    },
    ORIGIN,
    500
  );

  assert.equal(scene.buildings.length, 1);
  const [block] = scene.buildings;
  assert.equal(block.id, "way/1");
  assert.equal(block.name, "Block A");
  assert.ok(Math.abs(block.heightM - 4 * 3.2) < 1e-9);
  assert.ok(Math.abs(block.footprintM2 - 900) < 1, "30 m square is 900 m²");
  assert.equal(block.ring.length, 4, "the repeated closing vertex is dropped");

  assert.equal(scene.roads.length, 2, "construction alignments are not on the ground");
  const ring = scene.roads.find((road) => road.name === "Ring Road");
  assert.equal(ring.kind, "major");
  assert.ok(Math.abs(ring.lengthM - 80) < 0.5);
  assert.equal(scene.roads.find((road) => road.highway === "footway").kind, "path");

  // Areas come back largest first so a park never renders inside a bigger block.
  assert.deepEqual(scene.areas.map((area) => area.kind), ["green", "water"]);
});

test("parseOverpass turns a multipolygon relation into a ring with a courtyard", () => {
  const scene = parseOverpass(
    {
      elements: [
        {
          type: "relation",
          id: 9,
          tags: { type: "multipolygon", building: "university", name: "Academic Block" },
          members: [
            { type: "way", role: "outer", geometry: squareAt(ORIGIN, 60) },
            { type: "way", role: "inner", geometry: squareAt({ lat: ORIGIN.lat + 0.0001, lon: ORIGIN.lon + 0.0001 }, 20) },
          ],
        },
      ],
    },
    ORIGIN,
    500
  );

  assert.equal(scene.buildings.length, 1);
  const [block] = scene.buildings;
  assert.equal(block.id, "relation/9");
  assert.equal(block.holes.length, 1, "the inner member becomes a courtyard");
  assert.equal(block.heightM, 16, "building=university falls back to its assumed height");
});

test("parseOverpass survives the bad data a crowd-sourced map contains", () => {
  const scene = parseOverpass(
    {
      elements: [
        { type: "way", id: 1, tags: { building: "yes" } },                                   // no geometry
        { type: "way", id: 2, tags: { building: "yes" }, geometry: squareAt(ORIGIN, 10).slice(0, 2) }, // clipped to a line
        { type: "way", id: 3, tags: { highway: "residential" }, geometry: [{ lat: 28.9, lon: 77 }] },  // single point
        { type: "way", id: 4, tags: { building: "yes" }, geometry: [{ lat: NaN, lon: 77 }, ...squareAt(ORIGIN, 25)] },
      ],
    },
    ORIGIN,
    500
  );
  assert.equal(scene.buildings.length, 1, "only the recoverable building survives");
  assert.equal(scene.roads.length, 0);
});

test("parseOverpass returns an empty scene rather than throwing on junk", () => {
  for (const payload of [null, undefined, {}, { elements: null }, "nope"]) {
    const scene = parseOverpass(payload, ORIGIN, 500);
    assert.deepEqual([scene.buildings.length, scene.roads.length, scene.areas.length], [0, 0, 0]);
  }
});

test("overpassQuery asks for every layer the parser reads, inside the bbox", () => {
  const query = overpassQuery(boundingBox(ORIGIN, 400));
  assert.match(query, /\[out:json\]\[timeout:30\]/);
  assert.match(query, /out body geom;$/);
  for (const key of ['way\\["building"\\]', 'relation\\["building"\\]', 'way\\["highway"\\]', '"natural"', '"landuse"', '"leisure"']) {
    assert.match(query, new RegExp(key));
  }
  assert.equal(query.match(/28\.99\d+,77\.0\d+,29\.00\d+,77\.0\d+/g).length, 10, "every clause is bounded");
});

test("clipping: a polyline is cut to the box and split where it leaves and returns", () => {
  const box = { minX: -100, maxX: 100, minY: -100, maxY: 100 };

  // Straight through: one run, trimmed to the two crossings.
  const [through] = clipPolyline([{ x: -300, y: 0 }, { x: 300, y: 0 }], box);
  assert.equal(through.length, 2);
  assert.ok(Math.abs(through[0].x + 100) < 1e-9 && Math.abs(through[1].x - 100) < 1e-9);

  // Out and back: two separate runs, not one line bridging the gap.
  const runs = clipPolyline(
    [{ x: -50, y: 0 }, { x: -50, y: 300 }, { x: 50, y: 300 }, { x: 50, y: 0 }],
    box
  );
  assert.equal(runs.length, 2);
  for (const run of runs) {
    for (const point of run) assert.ok(point.y <= 100 + 1e-9 && point.y >= -100 - 1e-9);
  }

  assert.deepEqual(clipPolyline([{ x: 500, y: 500 }, { x: 600, y: 600 }], box), [], "wholly outside");
});

test("clipping: a ring larger than the box becomes the box", () => {
  const box = { minX: -100, maxX: 100, minY: -100, maxY: 100 };
  const ring = clipRing([{ x: -900, y: -900 }, { x: 900, y: -900 }, { x: 900, y: 900 }, { x: -900, y: 900 }], box);
  assert.equal(ring.length, 4);
  assert.ok(Math.abs(Math.abs(signedArea(ring)) - 200 * 200) < 1e-6);
  assert.deepEqual(clipRing([{ x: 400, y: 400 }, { x: 500, y: 400 }, { x: 500, y: 500 }], box), []);
});

test("a way running far past the scene is measured only inside it", () => {
  const scale = metresPerDegree(ORIGIN.lat);
  // A 20 km highway through the origin, of which 400 m lies in a 200 m scene.
  const scene = parseOverpass(
    {
      elements: [
        {
          type: "way",
          id: 77,
          tags: { highway: "trunk", name: "NH-44" },
          geometry: [
            { lat: ORIGIN.lat, lon: ORIGIN.lon - 10_000 / scale.lon },
            { lat: ORIGIN.lat, lon: ORIGIN.lon + 10_000 / scale.lon },
          ],
        },
        // A forest covering the whole district, clipped to the scene's 400 m square.
        {
          type: "way",
          id: 78,
          tags: { landuse: "forest" },
          geometry: squareAt({ lat: ORIGIN.lat - 5000 / scale.lat, lon: ORIGIN.lon - 5000 / scale.lon }, 10_000),
        },
        // A building 2 km away that Overpass returned because its way touched the box.
        { type: "way", id: 79, tags: { building: "house" }, geometry: squareAt({ lat: ORIGIN.lat + 2000 / scale.lat, lon: ORIGIN.lon }, 12) },
      ],
    },
    ORIGIN,
    200
  );

  assert.equal(scene.roads.length, 1);
  assert.ok(Math.abs(scene.roads[0].lengthM - 400) < 1, `clipped to ${scene.roads[0].lengthM} m, not 20 km`);
  assert.equal(scene.areas.length, 1);
  assert.ok(Math.abs(scene.areas[0].areaM2 - 400 * 400) < 1, "the forest is cut to the scene");
  assert.equal(scene.buildings.length, 0, "a building outside the scene is dropped");
});
