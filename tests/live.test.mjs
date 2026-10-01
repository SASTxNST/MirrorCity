import assert from "node:assert/strict";
import test from "node:test";
import { aqiBand, compass, degreeBox, parseAir, parseAircraft, parseQuakes } from "../lib/live.ts";

const DELHI = { lat: 28.6318, lon: 77.2194 };

// A real OpenSky state vector, trimmed to the documented 17 positions.
function state(overrides = {}) {
  const base = [
    "80162f", "AIC4TJ  ", "India", 1790826896, 1790826896,
    77.2194, 28.6318, 5783.58, false, 180.98, 94.5, 2.6, null, 6088.38, null, false, 0,
  ];
  for (const [index, value] of Object.entries(overrides)) base[Number(index)] = value;
  return base;
}

test("aircraft: callsigns are trimmed, geometric altitude wins, results sort by distance", () => {
  const near = state();
  const far = state({ 0: "abc123", 5: 78.2, 6: 29.6, 1: "  " });
  const [first, second] = parseAircraft({ states: [far, near] }, DELHI);

  assert.equal(first.id, "80162f", "the closer aircraft comes first");
  assert.equal(first.callsign, "AIC4TJ", "OpenSky pads callsigns to eight characters");
  assert.equal(first.altitudeM, 6088.38, "geometric altitude is preferred over barometric");
  assert.ok(first.distanceM < 50, "a state vector at the centre is metres away");
  assert.equal(second.callsign, null, "a blank callsign is null, not an empty string");
  assert.ok(second.distanceM > 100_000);
});

test("aircraft: barometric altitude is the fallback, and on-ground is preserved", () => {
  const [one] = parseAircraft({ states: [state({ 13: null, 8: true })] }, DELHI);
  assert.equal(one.altitudeM, 5783.58);
  assert.equal(one.onGround, true);
});

test("aircraft: vectors without a position are skipped rather than drawn at null island", () => {
  const scene = parseAircraft(
    { states: [state({ 5: null }), state({ 6: null }), state(), "nonsense", null] },
    DELHI
  );
  assert.equal(scene.length, 1);
});

test("aircraft: a malformed payload yields no aircraft rather than throwing", () => {
  for (const payload of [null, undefined, {}, { states: null }, { states: "no" }, "junk"]) {
    assert.deepEqual(parseAircraft(payload, DELHI), []);
  }
});

test("quakes: magnitude, depth and distance are read; unreviewed events are dropped", () => {
  const quakes = parseQuakes(
    {
      features: [
        { id: "us1", properties: { mag: 5.4, place: "Nepal", time: 1790826460310, url: "u" }, geometry: { coordinates: [85.3, 27.7, 12.4] } },
        { id: "us2", properties: { mag: null, place: "Unreviewed" }, geometry: { coordinates: [80, 20, 5] } },
        { id: "us3", properties: { mag: 2.1 }, geometry: { coordinates: [] } },
      ],
    },
    DELHI
  );

  assert.equal(quakes.length, 1, "only the reviewed, located event survives");
  const [quake] = quakes;
  assert.equal(quake.magnitude, 5.4);
  assert.equal(quake.depthKm, 12.4);
  // Delhi to Kathmandu is roughly 800 km.
  assert.ok(quake.distanceM > 700_000 && quake.distanceM < 900_000, `${quake.distanceM} m`);
});

test("quakes: a malformed payload yields none", () => {
  for (const payload of [null, {}, { features: "no" }, "junk"]) {
    assert.deepEqual(parseQuakes(payload, DELHI), []);
  }
});

test("air: the two Open-Meteo responses merge into one reading", () => {
  const reading = parseAir(
    { current: { temperature_2m: 31.4, relative_humidity_2m: 44, precipitation: 0, wind_speed_10m: 11.2, time: "2026-10-01T03:45" } },
    { current: { pm2_5: 79.9, pm10: 182.1, us_aqi: 168, time: "2026-10-01T03:00" } }
  );
  assert.equal(reading.temperatureC, 31.4);
  assert.equal(reading.pm25, 79.9);
  assert.equal(reading.usAqi, 168);
  assert.equal(reading.observedAt, "2026-10-01T03:00", "air quality timestamp wins, being the coarser one");
});

test("air: one endpoint failing still yields the other's values", () => {
  const reading = parseAir(null, { current: { us_aqi: 168, pm2_5: 79.9 } });
  assert.equal(reading.usAqi, 168);
  assert.equal(reading.temperatureC, null);
});

test("aqi bands follow the US EPA breakpoints", () => {
  assert.equal(aqiBand(null).severity, 0);
  assert.equal(aqiBand(50).label, "Good");
  assert.equal(aqiBand(51).label, "Moderate");
  assert.equal(aqiBand(150).severity, 3);
  assert.equal(aqiBand(168).label, "Unhealthy");
  assert.equal(aqiBand(400).label, "Hazardous");
});

test("degreeBox stays inside valid coordinates near the poles", () => {
  const box = degreeBox({ lat: 89.5, lon: 179.5 }, 3);
  assert.ok(box.lamax <= 90 && box.lamin >= -90);
  assert.ok(box.lomax <= 180 && box.lomin >= -180);
});

test("compass names the direction from the scene to an event", () => {
  assert.equal(compass(DELHI, { lat: 30.0, lon: 77.2194 }), "N");
  assert.equal(compass(DELHI, { lat: 28.6318, lon: 79.0 }), "E");
  assert.equal(compass(DELHI, { lat: 27.0, lon: 77.2194 }), "S");
  assert.equal(compass(DELHI, { lat: 28.6318, lon: 75.0 }), "W");
});
