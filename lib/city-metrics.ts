// Summary written by scripts/flood/run_simulation.py (run in the browser by app/flood-worker.ts).
export type FloodResults = {
  peak_depth_m: number;
  peak_time_s: number;
  water_volume_m3: number;
  rain_soaked_in_fraction: number;
  rain_drained_fraction: number;
  flooded_street_fraction: number;
  high_hazard_street_fraction: number;
  drain_network?: { captured_m3: number; returned_m3: number; discharged_m3: number; inlets: number; inlets_backed_up: number } | null;
};

export type FloodRun = {
  results: FloodResults;
  timeline: { time_s: number[]; max_depth_m: number[] };
  // Row j = y. cell_kind: 0 street, 1 building or wall, 2 outside the survey.
  maps: FloodMaps;
};

// origin_m: grid corner in the terrain's own (LiDAR) coordinates, when known.
// inlets: [row, column, 1 if it ever backed up].
export type FloodMaps = { origin_m: [number, number] | null; cell_m: number; inlets?: number[][]; peak_depth_m: number[][]; elevation_m: number[][]; cell_kind: number[][] };

export function floodMetrics(results: FloodResults | null) {
  if (!results) {
    return ["Peak depth", "Flooded street", "Standing water"].map((label) => ({ value: "—", label, trend: "Run to compute" }));
  }
  const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;
  return [
    { value: `${results.peak_depth_m.toFixed(2)} m`, label: "Peak depth", trend: `at ${Math.round(results.peak_time_s / 60)} min${results.drain_network?.inlets_backed_up ? ` · ${results.drain_network.inlets_backed_up} drains backed up` : ""}` },
    { value: percent(results.flooded_street_fraction), label: "Flooded street", trend: `${percent(results.high_hazard_street_fraction)} high hazard` },
    { value: `${Math.round(results.water_volume_m3)} m³`, label: "Standing water", trend: `${percent(results.rain_soaked_in_fraction)} soaked · ${percent(results.rain_drained_fraction)} drained` },
  ];
}
