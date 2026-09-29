export function sewerLoad(population: number) {
  const dailyLitres = population * 135;          // Explicit prototype assumption; not a calibrated engineering input.
  const peakFactor = population < 2000 ? 3.2 : population < 2500 ? 3.0 : 2.8;
  const peakLps = (dailyLitres * peakFactor) / 86400;
  const capacity = 60;                           // system capacity: 60 L/s
  const load = Math.min(100, Math.round((peakLps / capacity) * 100));
  const riskNodes = load >= 90 ? 3 : load >= 80 ? 1 : 0;
  const status = load >= 90 ? "Capacity risk" : load >= 80 ? "Watch closely" : "Within capacity";
  return { load, peakFlow: Math.round(peakLps * 10) / 10, riskNodes, status };
}

// Summary written by scripts/flood/run_simulation.py (run in the browser by app/flood-worker.ts).
export type FloodResults = {
  peak_depth_m: number;
  peak_time_s: number;
  water_volume_m3: number;
  rain_soaked_in_fraction: number;
  rain_drained_fraction: number;
  flooded_street_fraction: number;
  high_hazard_street_fraction: number;
};

export type FloodRun = {
  results: FloodResults;
  timeline: { time_s: number[]; max_depth_m: number[] };
  // Row j = y. cell_kind: 0 street, 1 building or wall, 2 outside the survey.
  maps: FloodMaps;
};

// origin_m: grid corner in the terrain's own (LiDAR) coordinates, when known.
export type FloodMaps = { origin_m: [number, number] | null; cell_m: number; peak_depth_m: number[][]; elevation_m: number[][]; cell_kind: number[][] };

export function floodMetrics(results: FloodResults | null) {
  if (!results) {
    return ["Peak depth", "Flooded street", "Standing water"].map((label) => ({ value: "—", label, trend: "Run to compute" }));
  }
  const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;
  return [
    { value: `${results.peak_depth_m.toFixed(2)} m`, label: "Peak depth", trend: `at ${Math.round(results.peak_time_s / 60)} min` },
    { value: percent(results.flooded_street_fraction), label: "Flooded street", trend: `${percent(results.high_hazard_street_fraction)} high hazard` },
    { value: `${Math.round(results.water_volume_m3)} m³`, label: "Standing water", trend: `${percent(results.rain_soaked_in_fraction)} soaked · ${percent(results.rain_drained_fraction)} drained` },
  ];
}

export function evacuationMetrics(population: number) {
  const clearance = Math.round(24 + (population - 1500) * 0.009);
  const routed = Math.round(population * 0.97);
  const bottlenecks = population >= 2500 ? 4 : population >= 2000 ? 2 : 1;
  return [
    { value: `${clearance} min`, label: "Clearance time", trend: clearance <= 31 ? `−${31 - clearance} min` : `+${clearance - 31} min` },
    { value: routed.toLocaleString(), label: "People routed", trend: "97%" },
    { value: String(bottlenecks), label: "Bottlenecks", trend: bottlenecks > 2 ? "Action needed" : "Review" },
  ];
}
