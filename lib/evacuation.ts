// Illustrative walking evacuation of the Varuna River Ward over the streets
// drawn in the 3D district. There is no surveyed street data, so every
// number below is an assumption.
//
// Clearance time = warning & response + longest walk + queueing, where the
// queue drains at the street network's maximum flow to the exits (people/s,
// from a max-flow over street capacities). The roads in the minimum cut are
// the bottlenecks that limit it.

type Point = { x: number; y: number }; // drawing percentages, as elsewhere in the app

// Same ward scale as the sewer model: 600 m × 450 m.
const WARD_M = { x: 600, y: 450 };

// Streets drawn in CityEngine (world rectangles converted to drawing
// percentages). Drawn widths aren't to scale; walkable width is assumed at
// 7 m per drawn unit.
const STREETS = [
  { name: "Main road (east–west)", from: { x: 0, y: 50 }, to: { x: 100, y: 50 }, drawnWidth: 1.15 },
  { name: "West road (north–south)", from: { x: 35.4, y: 0 }, to: { x: 35.4, y: 100 }, drawnWidth: 1.15 },
  { name: "East road (north–south)", from: { x: 67.5, y: 0 }, to: { x: 67.5, y: 88.9 }, drawnWidth: 1.05 },
  { name: "South road (east–west)", from: { x: 0, y: 78.9 }, to: { x: 100, y: 78.9 }, drawnWidth: 0.85 },
];
const METRES_PER_DRAWN_UNIT = 7;

// Crowd movement (SFPE Handbook): maximum specific flow 1.3 people per metre
// of width per second; unimpeded walking 1.2 m/s.
const SPECIFIC_FLOW = 1.3;
const WALK_SPEED = 1.2;
// Time for a warning to reach people and for them to start moving.
const RESPONSE_MIN = 5;

// Everyone starts in an occupied building (infrastructure excluded) and walks
// to the nearest street, then to the nearest exit.
export type EvacuationBuilding = { name: string; type: string; x: number; y: number };
const UNOCCUPIED = new Set(["Power infrastructure", "Utilities", "Energy"]);

const metres = (a: Point, b: Point) => Math.hypot(((a.x - b.x) / 100) * WARD_M.x, ((a.y - b.y) / 100) * WARD_M.y);
const onEdge = (p: Point) => p.x <= 0 || p.x >= 100 || p.y <= 0 || p.y >= 100;

type Edge = { a: number; b: number; length: number; capacity: number; street: string };

export type EvacuationResults = {
  clearanceMin: number;
  walkMin: number;
  queueMin: number;
  longestWalkM: number;
  longestFrom: string;
  maxFlow: number; // people per second
  bottlenecks: string[]; // streets in the minimum cut
};

// Builds the street graph: nodes at street ends, crossings and each
// building's access point (its projection onto the nearest street).
function streetGraph(buildings: EvacuationBuilding[]) {
  const nodes: Point[] = [];
  const nodeAt = (p: Point) => {
    const found = nodes.findIndex((n) => Math.abs(n.x - p.x) < 1e-6 && Math.abs(n.y - p.y) < 1e-6);
    return found >= 0 ? found : nodes.push(p) - 1;
  };

  // Points along each street (as distance-ordered parameters 0..1).
  const stops = STREETS.map(() => [0, 1]);
  STREETS.forEach((s, i) => STREETS.forEach((t, j) => {
    if (j <= i) return;
    const horizontal = (u: typeof s) => u.from.y === u.to.y;
    if (horizontal(s) === horizontal(t)) return;
    const [h, v, hi, vi] = horizontal(s) ? [s, t, i, j] : [t, s, j, i];
    const crossing = { x: v.from.x, y: h.from.y };
    const within = (u: typeof s, p: Point) => p.x >= Math.min(u.from.x, u.to.x) && p.x <= Math.max(u.from.x, u.to.x) && p.y >= Math.min(u.from.y, u.to.y) && p.y <= Math.max(u.from.y, u.to.y);
    if (!within(h, crossing) || !within(v, crossing)) return;
    stops[hi].push((crossing.x - h.from.x) / (h.to.x - h.from.x));
    stops[vi].push((crossing.y - v.from.y) / (v.to.y - v.from.y));
  }));

  const access = buildings.filter((b) => !UNOCCUPIED.has(b.type)).map((building) => {
    let best = { street: 0, t: 0, distance: Infinity };
    STREETS.forEach((street, index) => {
      const dx = street.to.x - street.from.x;
      const dy = street.to.y - street.from.y;
      const t = Math.min(1, Math.max(0, ((building.x - street.from.x) * dx + (building.y - street.from.y) * dy) / (dx * dx + dy * dy)));
      const distance = metres(building, { x: street.from.x + t * dx, y: street.from.y + t * dy });
      if (distance < best.distance) best = { street: index, t, distance };
    });
    stops[best.street].push(best.t);
    return { building, ...best };
  });

  const edges: Edge[] = [];
  STREETS.forEach((street, index) => {
    const points = [...new Set(stops[index])].sort((a, b) => a - b).map((t) => ({ x: street.from.x + t * (street.to.x - street.from.x), y: street.from.y + t * (street.to.y - street.from.y) }));
    for (let k = 1; k < points.length; k += 1) {
      edges.push({ a: nodeAt(points[k - 1]), b: nodeAt(points[k]), length: metres(points[k - 1], points[k]), capacity: SPECIFIC_FLOW * street.drawnWidth * METRES_PER_DRAWN_UNIT, street: street.name });
    }
  });

  const exits = nodes.map((node, index) => (onEdge(node) ? index : -1)).filter((index) => index >= 0);
  const sources = access.map(({ building, street, t, distance }) => {
    const s = STREETS[street];
    return { building, node: nodeAt({ x: s.from.x + t * (s.to.x - s.from.x), y: s.from.y + t * (s.to.y - s.from.y) }), accessM: distance };
  });

  return { nodes, edges, exits, sources };
}

// Shortest walking distance from every node to its nearest exit (Dijkstra).
function distanceToExit(nodeCount: number, edges: Edge[], exits: number[]) {
  const distance = new Array(nodeCount).fill(Infinity);
  const done = new Array(nodeCount).fill(false);
  exits.forEach((exit) => (distance[exit] = 0));
  for (let round = 0; round < nodeCount; round += 1) {
    let current = -1;
    distance.forEach((value, index) => { if (!done[index] && (current < 0 || value < distance[current])) current = index; });
    if (current < 0 || distance[current] === Infinity) break;
    done[current] = true;
    edges.forEach(({ a, b, length }) => {
      if (a === current) distance[b] = Math.min(distance[b], distance[a] + length);
      if (b === current) distance[a] = Math.min(distance[a], distance[b] + length);
    });
  }
  return distance;
}

// Maximum flow (Edmonds–Karp) from the sources to the exits over undirected
// streets; returns the flow and the streets in the minimum cut.
export function maxFlow(nodeCount: number, edges: Edge[], sources: number[], sinks: number[]) {
  const source = nodeCount;
  const sink = nodeCount + 1;
  const size = nodeCount + 2;
  const residual = Array.from({ length: size }, () => new Array(size).fill(0));
  edges.forEach(({ a, b, capacity }) => { residual[a][b] += capacity; residual[b][a] += capacity; });
  sources.forEach((node) => (residual[source][node] = Infinity));
  sinks.forEach((node) => (residual[node][sink] = Infinity));

  let flow = 0;
  for (;;) {
    const parent = new Array(size).fill(-1);
    parent[source] = source;
    const queue = [source];
    while (queue.length && parent[sink] < 0) {
      const u = queue.shift()!;
      for (let v = 0; v < size; v += 1) if (parent[v] < 0 && residual[u][v] > 1e-12) { parent[v] = u; queue.push(v); }
    }
    if (parent[sink] < 0) break;
    let push = Infinity;
    for (let v = sink; v !== source; v = parent[v]) push = Math.min(push, residual[parent[v]][v]);
    if (push === Infinity) return { flow: Infinity, cut: [] as Edge[] };
    for (let v = sink; v !== source; v = parent[v]) { residual[parent[v]][v] -= push; residual[v][parent[v]] += push; }
    flow += push;
  }

  // Minimum cut: streets from the source side to the rest.
  const reachable = new Array(size).fill(false);
  const queue = [source];
  reachable[source] = true;
  while (queue.length) {
    const u = queue.shift()!;
    for (let v = 0; v < size; v += 1) if (!reachable[v] && residual[u][v] > 1e-12) { reachable[v] = true; queue.push(v); }
  }
  const cut = edges.filter(({ a, b }) => reachable[a] !== reachable[b]);
  return { flow, cut };
}

export function evacuate(population: number, buildings: EvacuationBuilding[]): EvacuationResults {
  const { nodes, edges, exits, sources } = streetGraph(buildings);
  const distance = distanceToExit(nodes.length, edges, exits);

  const longest = sources.reduce((top, source) => {
    const walk = source.accessM + distance[source.node];
    return walk > top.walk ? { walk, name: source.building.name } : top;
  }, { walk: 0, name: "" });

  const { flow, cut } = maxFlow(nodes.length, edges, [...new Set(sources.map((source) => source.node))], exits);

  const walkMin = longest.walk / WALK_SPEED / 60;
  const queueMin = population / flow / 60;
  return {
    clearanceMin: RESPONSE_MIN + walkMin + queueMin,
    walkMin,
    queueMin,
    longestWalkM: longest.walk,
    longestFrom: longest.name,
    maxFlow: flow,
    bottlenecks: [...new Set(cut.map((edge) => edge.street))],
  };
}

export function evacuationMetrics(results: EvacuationResults) {
  return [
    { value: `${Math.round(results.clearanceMin)} min`, label: "Clearance time", trend: `${RESPONSE_MIN} warning + ${results.walkMin.toFixed(1)} walk + ${results.queueMin.toFixed(1)} queue` },
    { value: `${Math.round(results.longestWalkM)} m`, label: "Longest walk", trend: `from ${results.longestFrom}` },
    { value: `${Math.round(results.maxFlow)}/s`, label: "Exit capacity", trend: `limited by ${results.bottlenecks.length} road${results.bottlenecks.length === 1 ? "" : "s"}` },
  ];
}
