import assert from "node:assert/strict";
import test from "node:test";
import { parseCaltrans, parseTfl } from "../app/api/live/cameras/route.ts";

const LONDON = { lat: 51.4973, lon: -0.1371 };
const BAY = { lat: 37.7936, lon: -122.3989 };

// Shaped exactly as the live TfL response, including its key/value property bag.
function jamcam(overrides = {}) {
  return {
    id: "JamCams_00002.00865",
    commonName: "A406 Billet Upass E",
    lat: 51.60067,
    lon: -0.01594,
    additionalProperties: [
      { key: "available", value: "true" },
      { key: "imageUrl", value: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.jpg" },
      { key: "videoUrl", value: "https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.mp4" },
    ],
    ...overrides,
  };
}

function caltrans(overrides = {}) {
  return {
    cctv: {
      index: "TV102",
      location: { locationName: "TV102 -- I-580 : West of SR-24", latitude: "37.82539", longitude: "-122.27291" },
      imageData: {
        static: { currentImageURL: "https://cwwp2.dot.ca.gov/data/d4/cctv/image/tv102/tv102.jpg" },
        streamingVideoURL: "https://wzmedia.dot.ca.gov/D4/W580_JWO_24_IC.stream/playlist.m3u8",
      },
      ...overrides,
    },
  };
}

test("TfL: image and video URLs are lifted out of the property bag", () => {
  const [camera] = parseTfl([jamcam()], LONDON, "Transport for London");
  assert.equal(camera.id, "JamCams_00002.00865");
  assert.equal(camera.name, "A406 Billet Upass E");
  assert.match(camera.imageUrl, /\.jpg$/);
  assert.match(camera.videoUrl, /\.mp4$/);
  // Westminster to the North Circular is roughly 14 km.
  assert.ok(camera.distanceM > 10_000 && camera.distanceM < 20_000, `${camera.distanceM} m`);
});

test("TfL: cameras the operator marks unavailable are dropped", () => {
  const down = jamcam({ additionalProperties: [{ key: "available", value: "false" }] });
  assert.equal(parseTfl([down], LONDON, "TfL").length, 0);
});

test("TfL: records without a position are skipped, and junk yields nothing", () => {
  assert.equal(parseTfl([jamcam({ lat: undefined })], LONDON, "TfL").length, 0);
  for (const payload of [null, undefined, {}, "no", { places: [] }]) {
    assert.deepEqual(parseTfl(payload, LONDON, "TfL"), []);
  }
});

test("Caltrans: string coordinates are read as numbers", () => {
  const [camera] = parseCaltrans({ data: [caltrans()] }, BAY, "Caltrans D4");
  assert.equal(camera.lat, 37.82539);
  assert.equal(camera.lon, -122.27291);
  assert.match(camera.videoUrl, /\.m3u8$/);
  assert.ok(camera.distanceM > 1000);
});

test("Caltrans: unsurveyed (0,0) positions and out-of-service cameras are dropped", () => {
  const atNullIsland = caltrans();
  atNullIsland.cctv.location = { locationName: "Unsurveyed", latitude: "0", longitude: "0" };
  const offline = caltrans();
  offline.cctv.inService = "false";

  const cameras = parseCaltrans({ data: [atNullIsland, offline, caltrans()] }, BAY, "Caltrans D4");
  assert.equal(cameras.length, 1, "only the working, located camera survives");
});

test("Caltrans: a camera with no still image still returns, with a null URL", () => {
  const noImage = caltrans();
  noImage.cctv.imageData = { streamingVideoURL: "https://example.invalid/s.m3u8" };
  const [camera] = parseCaltrans({ data: [noImage] }, BAY, "Caltrans D4");
  assert.equal(camera.imageUrl, null);
  assert.ok(camera.videoUrl);
});

test("Caltrans: a malformed payload yields no cameras rather than throwing", () => {
  for (const payload of [null, {}, { data: "no" }, { data: [{}] }, "junk"]) {
    assert.deepEqual(parseCaltrans(payload, BAY, "Caltrans"), []);
  }
});
