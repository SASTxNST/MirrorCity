import assert from "node:assert/strict";
import test from "node:test";
import { lonLatToTile, tilesToFacilities } from "../lib/tiles.ts";

const DELHI = { lat: 28.6318, lon: 77.2194 };
const EXTENT = 4096;
const TILE = (() => {
  const { x, y } = lonLatToTile(DELHI, 14);
  return { z: 14, x: Math.floor(x), y: Math.floor(y) };
})();
const CENTRE_PX = (() => {
  const { x, y } = lonLatToTile(DELHI, 14);
  return { x: (x - TILE.x) * EXTENT, y: (y - TILE.y) * EXTENT };
})();

const point = (properties, dx = 0, dy = 0) => ({
  type: 1,
  properties,
  loadGeometry: () => [[{ x: CENTRE_PX.x + dx, y: CENTRE_PX.y + dy }]],
});

const poiLayer = (features) => ({ extent: EXTENT, length: features.length, feature: (i) => features[i] });

function run(features, radius = 700) {
  return tilesToFacilities([{ tile: TILE, data: { layers: { poi: poiLayer(features) } } }], DELHI, radius);
}

test("facility classes map onto the five kinds the renderer draws", () => {
  const facilities = run([
    point({ class: "hospital", subclass: "clinic", name: "NDMC Polyclinic" }),
    point({ class: "police", name: "Connaught Place PS" }, 10),
    point({ class: "fire_station", name: "CP Fire Station" }, 20),
    point({ class: "college", name: "Delhi College" }, 30),
    point({ class: "railway", name: "Rajiv Chowk" }, 40),
  ]);

  assert.equal(facilities.length, 5);
  assert.deepEqual(
    facilities.map((f) => f.kind).sort(),
    ["fire", "hospital", "police", "school", "transit"],
    "hospital, police, fire_station, college and railway each map to a kind"
  );
  assert.equal(facilities.find((f) => f.name === "CP Fire Station").kind, "fire");
  assert.equal(facilities.find((f) => f.name === "NDMC Polyclinic").detail, "clinic");
});

test("unnamed facilities are dropped: an unnamed clinic cannot be acted on", () => {
  assert.equal(run([point({ class: "hospital" }), point({ class: "hospital", name: "   " }, 10)]).length, 0);
});

test("classes that are not facilities are ignored", () => {
  assert.equal(run([point({ class: "cafe", name: "Coffee" }), point({ class: "atm", name: "ATM" }, 10)]).length, 0);
});

test("facilities outside the requested box are dropped", () => {
  // ~3000 tile px east is far beyond a 200 m scene.
  assert.equal(run([point({ class: "hospital", name: "Far hospital" }, 3000)], 200).length, 0);
});

test("the same facility repeated across a tile seam appears once", () => {
  const shared = { class: "hospital", name: "Kalawati Saran Children's Hospital" };
  const facilities = tilesToFacilities(
    [
      { tile: TILE, data: { layers: { poi: poiLayer([point(shared)]) } } },
      { tile: TILE, data: { layers: { poi: poiLayer([point(shared)]) } } },
    ],
    DELHI,
    700
  );
  assert.equal(facilities.length, 1);
});

test("a tile with no POI layer yields no facilities", () => {
  assert.deepEqual(tilesToFacilities([{ tile: TILE, data: { layers: {} } }], DELHI, 700), []);
});

test("polygons in the POI layer are ignored; facilities are points", () => {
  const polygon = { type: 3, properties: { class: "hospital", name: "Campus" }, loadGeometry: () => [[{ x: 1, y: 1 }]] };
  assert.equal(run([polygon]).length, 0);
});
