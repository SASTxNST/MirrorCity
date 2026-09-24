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

export function floodMetrics(population: number) {
  const depth = (1.4 + (population - 1500) * 0.0006).toFixed(1);
  const exposed = Math.round(10 + (population - 1500) * 0.006);
  const drainTime = Math.max(28, Math.round(55 - (population - 1500) * 0.015));
  const depthDelta = ((population - 1500) * 0.0006).toFixed(1);
  return [
    { value: `${depth} m`, label: "Peak depth", trend: `+${depthDelta} m` },
    { value: String(exposed), label: "Assets exposed", trend: `${Math.round(exposed * 0.2)} critical` },
    { value: `${drainTime} min`, label: "Drain-down", trend: drainTime < 47 ? `−${47 - drainTime}%` : `+${drainTime - 47}%` },
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
