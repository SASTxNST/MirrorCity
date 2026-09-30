import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseSewerReport, sewerMetrics, sewerNetwork } from "../lib/sewer-network.ts";

// Fixtures are reports from a native build of EPA SWMM 5.2.4 running
// sewerNetwork(2000) and sewerNetwork(12000).
const report = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

test("sewer network: sewage load and daily pattern follow CPHEEO assumptions", () => {
  const input = sewerNetwork(2000);
  const baseline = [...input.matchAll(/^MH\d FLOW (\S+) "DIURNAL"$/gm)].reduce((sum, [, value]) => sum + Number(value), 0);
  assert.ok(Math.abs(baseline - (2000 * 135 * 0.8) / 86400) < 1e-6, "average flow = population × 135 L/day × 80%");

  const pattern = input.match(/^DIURNAL HOURLY (.+)$/m)[1].split(" ").map(Number);
  assert.equal(pattern.length, 24);
  assert.ok(Math.abs(pattern.reduce((a, b) => a + b) / 24 - 1) < 0.002, "pattern averages 1");
  assert.equal(Math.max(...pattern), 3, "peak factor 3.0");

  const inverts = [...input.matchAll(/^(?:MH\d|OUT) ([\d.]+)/gm)].map(([, value]) => Number(value));
  assert.ok(inverts.every((value, index) => index === 0 || value < inverts[index - 1]), "pipes fall toward the outfall");
});

test("sewer report: normal load is read correctly", () => {
  const results = parseSewerReport(report("swmm-ward-2000.rpt"));
  assert.deepEqual(results.pipes.map((pipe) => pipe.name), ["P1", "P2", "P3", "P4"]);
  assert.equal(results.outfallPeakLps, 7.5);
  assert.equal(results.surchargedManholes, 0);
  assert.deepEqual(sewerMetrics(results).map((metric) => metric.value), ["32%", "7.5 L/s", "0"]);
});

test("sewer report: an overloaded network reports surcharged manholes", () => {
  const results = parseSewerReport(report("swmm-ward-12000.rpt"));
  assert.equal(results.surchargedManholes, 4);
  assert.ok(Math.max(...results.pipes.map((pipe) => pipe.flowRatio)) > 1);
  assert.equal(sewerMetrics(results)[2].value, "4");
});
