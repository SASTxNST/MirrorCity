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

// Summary fields written by scripts/flood (run in the browser by app/flood-worker.ts).
export type FloodResults = { max_depth_m: number; max_velocity_m_per_s: number; water_volume_m3: number; rainfall_depth_m: number; infiltration_depth_mean_m: number; rain_soaked_in_fraction: number };

export function floodMetrics(results: FloodResults | null) {
  if (!results) {
    return ["Peak depth", "Peak velocity", "Standing water"].map((label) => ({ value: "—", label, trend: "Run to compute" }));
  }
  const soaked = Math.round(results.rain_soaked_in_fraction * 100);
  return [
    { value: `${results.max_depth_m.toFixed(2)} m`, label: "Peak depth", trend: "LiDAR street scan" },
    { value: `${results.max_velocity_m_per_s.toFixed(2)} m/s`, label: "Peak velocity", trend: "Surface flow" },
    { value: `${Math.round(results.water_volume_m3)} m³`, label: "Standing water", trend: `${soaked}% soaked in` },
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
