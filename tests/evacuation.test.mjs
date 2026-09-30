import assert from "node:assert/strict";
import test from "node:test";
import { evacuate, maxFlow } from "../lib/evacuation.ts";

test("max flow: two parallel routes add up, and both form the cut", () => {
  // 0 → 1 (capacity 3) and 0 → 2 → 1 (capacities 5, 4): max flow 3 + 4 = 7.
  const edges = [
    { a: 0, b: 1, length: 1, capacity: 3, street: "direct" },
    { a: 0, b: 2, length: 1, capacity: 5, street: "detour in" },
    { a: 2, b: 1, length: 1, capacity: 4, street: "detour out" },
  ];
  const { flow, cut } = maxFlow(3, edges, [0], [1]);
  assert.equal(flow, 7);
  assert.deepEqual(cut.map((edge) => edge.street).sort(), ["detour out", "direct"]);
});

test("evacuation: every occupied building reaches an exit; only queueing grows with population", () => {
  const buildings = [
    { name: "Far corner", type: "Residential", x: 20, y: 20 },
    { name: "Near road", type: "Residential", x: 50, y: 48 },
    { name: "Substation", type: "Power infrastructure", x: 52, y: 64 },
  ];
  const small = evacuate(1000, buildings);
  const large = evacuate(2000, buildings);

  assert.ok(Number.isFinite(small.longestWalkM) && small.longestWalkM > 0);
  // The substation is farthest from every exit but has no occupants.
  assert.notEqual(small.longestFrom, "Substation", "unoccupied infrastructure isn't an origin");
  assert.ok(Math.abs(small.clearanceMin - (5 + small.walkMin + small.queueMin)) < 1e-9);
  assert.equal(large.walkMin, small.walkMin);
  assert.ok(Math.abs(large.queueMin - 2 * small.queueMin) < 1e-9, "queue = people ÷ max flow");
  assert.ok(small.bottlenecks.length > 0);
});
