import assert from "node:assert/strict";
import test from "node:test";
import { lonLatToTile, tilesCovering, tilesToScene } from "../lib/tiles.ts";

const DELHI = { lat: 28.6318, lon: 77.2194 };
const EXTENT = 4096;

// A stand-in for @mapbox/vector-tile's decoded layer, which is all the parser
// touches. Keeps the geometry maths testable without a binary fixture.
function layer(features) {
  return {
    extent: EXTENT,
    length: features.length,
    feature: (index) => features[index],
  };
}

function polygon(ring, properties = {}) {
  return { type: 3, properties, loadGeometry: () => [ring] };
}

function line(points, properties = {}) {
  return { type: 2, properties, loadGeometry: () => [points] };
}

// Clockwise in tile space (y grows downward) = an outer ring.
function square(cx, cy, size) {
  const h = size / 2;
  return [
    { x: cx - h, y: cy - h },
    { x: cx + h, y: cy - h },
    { x: cx + h, y: cy + h },
    { x: cx - h, y: cy + h },
    { x: cx - h, y: cy - h },
  ];
}

const TILE = (() => {
  const { x, y } = lonLatToTile(DELHI, 14);
  return { z: 14, x: Math.floor(x), y: Math.floor(y) };
})();

// Tile-local pixel coordinates of the scene centre, so fixtures can be placed
// relative to it.
const CENTRE_PX = (() => {
  const { x, y } = lonLatToTile(DELHI, 14);
  return { x: (x - TILE.x) * EXTENT, y: (y - TILE.y) * EXTENT };
})();

test("tile maths: a known coordinate lands in the expected z14 tile", () => {
  assert.deepEqual(TILE, { z: 14, x: 11706, y: 6831 }, "Connaught Place at zoom 14");
});

test("tilesCovering returns every tile the area touches, and stays in range", () => {
  const small = tilesCovering(DELHI, 300);
  assert.ok(small.length >= 1 && small.length <= 4, `${small.length} tiles for a 300 m scene`);
  assert.ok(small.some((tile) => tile.x === TILE.x && tile.y === TILE.y));

  for (const tile of tilesCovering({ lat: 85, lon: 179.9 }, 1500)) {
    assert.ok(tile.x >= 0 && tile.x < 2 ** 14 && tile.y >= 0 && tile.y < 2 ** 14);
  }
});

test("buildings: a surveyed height is used, a zero height falls back and is marked", () => {
  const scene = tilesToScene(
    [
      {
        tile: TILE,
        data: {
          layers: {
            building: layer([
              polygon(square(CENTRE_PX.x, CENTRE_PX.y, 40), { render_height: 91, render_min_height: 0 }),
              polygon(square(CENTRE_PX.x + 60, CENTRE_PX.y, 40), { render_height: 0 }),
            ]),
          },
        },
      },
    ],
    DELHI,
    700
  );

  assert.equal(scene.buildings.length, 2);
  const [tall, unsurveyed] = scene.buildings;
  assert.equal(tall.heightM, 91);
  assert.equal(tall.heightSource, "tag");
  assert.equal(unsurveyed.heightM, 8, "a tile height of 0 means unsurveyed, not flat");
  assert.equal(unsurveyed.heightSource, "assumed");
});

test("buildings: a podium height is subtracted, as in the Overpass path", () => {
  const scene = tilesToScene(
    [{ tile: TILE, data: { layers: { building: layer([polygon(square(CENTRE_PX.x, CENTRE_PX.y, 40), { render_height: 40, render_min_height: 10 })]) } } }],
    DELHI,
    700
  );
  assert.equal(scene.buildings[0].heightM, 30);
});

test("geometry is clipped to the requested box, exactly as Overpass geometry is", () => {
  // A ring far outside the 200 m scene, and a road running clean through it.
  const scene = tilesToScene(
    [
      {
        tile: TILE,
        data: {
          layers: {
            building: layer([polygon(square(CENTRE_PX.x + 3000, CENTRE_PX.y, 40), { render_height: 20 })]),
            transportation: layer([
              line(
                [{ x: CENTRE_PX.x - 3000, y: CENTRE_PX.y }, { x: CENTRE_PX.x + 3000, y: CENTRE_PX.y }],
                { class: "primary", name: "Through road" }
              ),
            ]),
          },
        },
      },
    ],
    DELHI,
    200
  );

  assert.equal(scene.buildings.length, 0, "a building outside the box is dropped");
  assert.equal(scene.roads.length, 1);
  assert.ok(Math.abs(scene.roads[0].lengthM - 400) < 2, `clipped to ${scene.roads[0].lengthM} m`);
  assert.equal(scene.roads[0].kind, "major");
});

test("roads: OpenMapTiles classes map onto the renderer's four kinds", () => {
  const across = (cls) =>
    tilesToScene(
      [{ tile: TILE, data: { layers: { transportation: layer([line([{ x: CENTRE_PX.x - 50, y: CENTRE_PX.y }, { x: CENTRE_PX.x + 50, y: CENTRE_PX.y }], { class: cls })]) } } }],
      DELHI,
      700
    ).roads[0]?.kind ?? null;

  assert.equal(across("motorway"), "major");
  assert.equal(across("tertiary"), "minor");
  assert.equal(across("path"), "path");
  assert.equal(across("rail"), "rail");
  assert.equal(across("ferry"), null, "an unmapped class is skipped, not guessed");
});

test("areas: parks and water are kept, non-vegetation landcover is not", () => {
  const data = {
    layers: {
      park: layer([polygon(square(CENTRE_PX.x, CENTRE_PX.y, 200), { name: "Central Park" })]),
      water: layer([polygon(square(CENTRE_PX.x, CENTRE_PX.y, 100), {})]),
      landcover: layer([
        polygon(square(CENTRE_PX.x, CENTRE_PX.y, 160), { class: "wood" }),
        polygon(square(CENTRE_PX.x, CENTRE_PX.y, 150), { class: "ice" }),
      ]),
    },
  };
  const scene = tilesToScene([{ tile: TILE, data }], DELHI, 700);

  assert.equal(scene.areas.length, 3, "park + water + wood, but not ice");
  assert.deepEqual(
    scene.areas.map((area) => area.kind),
    ["green", "green", "water"],
    "largest first, so a park never hides inside a bigger block"
  );
  assert.equal(scene.areas[0].name, "Central Park");
});

test("a tile with no layers yields an empty scene rather than throwing", () => {
  const scene = tilesToScene([{ tile: TILE, data: { layers: {} } }], DELHI, 700);
  assert.deepEqual([scene.buildings.length, scene.roads.length, scene.areas.length], [0, 0, 0]);
  assert.equal(scene.radiusM, 700);
});

test("points and unknown geometry types are ignored", () => {
  const scene = tilesToScene(
    [{ tile: TILE, data: { layers: { building: layer([{ type: 1, properties: {}, loadGeometry: () => [[{ x: 10, y: 10 }]] }]) } } }],
    DELHI,
    700
  );
  assert.equal(scene.buildings.length, 0);
});
