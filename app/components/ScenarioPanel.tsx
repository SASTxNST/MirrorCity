import { useEffect, useRef } from "react";
import type { FloodRun } from "../../lib/city-metrics";
import { Icon } from "./Icon";

export type ScenarioKey = "sewer" | "flood" | "evacuation";

type Props = {
  scenario: { label: string; kicker: string };
  activeScenario: ScenarioKey;
  population: number;
  rainfall: number;
  stormMinutes: number;
  drainCapacity: number;
  floodRun: FloodRun | null;
  metrics: Array<{ value: string; label: string; trend: string }>;
  running: boolean;
  complete: boolean;
  onPopulationChange: (population: number) => void;
  onRainfallChange: (rainfall: number) => void;
  onStormMinutesChange: (minutes: number) => void;
  onRun: () => void;
  onOpenWorkspace: () => void;
};

export default function ScenarioPanel({ scenario, activeScenario, population, rainfall, stormMinutes, drainCapacity, floodRun, metrics, running, complete, onPopulationChange, onRainfallChange, onStormMinutesChange, onRun, onOpenWorkspace }: Props) {
  return (
    <section className="reference-side-card simulation-card">
      <header><div><span>{scenario.kicker}</span><h2>{scenario.label}</h2></div><button aria-label="Open scenario workspace" onClick={onOpenWorkspace}>•••</button></header>
      <p>{activeScenario === "sewer" ? "EPA SWMM on an illustrative sewer network: how the population's daily sewage peak loads the pipes." : activeScenario === "flood" ? `Flood model on a LiDAR-scanned street. Street drains assumed to carry ${drainCapacity} mm/h.` : "Model route load, clearance and emergency access."}</p>
      {activeScenario === "flood" ? (
        <>
          <label className="reference-population"><span><small>PEAK RAINFALL</small><strong>{rainfall} mm/h</strong></span><input aria-label="Peak rainfall" type="range" min="25" max="200" step="5" value={rainfall} onChange={(event) => onRainfallChange(Number(event.target.value))} /><i><small>25</small><small>100</small><small>200</small></i></label>
          <label className="reference-population"><span><small>STORM LENGTH</small><strong>{stormMinutes} min</strong></span><input aria-label="Storm length" type="range" min="30" max="180" step="15" value={stormMinutes} onChange={(event) => onStormMinutesChange(Number(event.target.value))} /><i><small>30</small><small>105</small><small>180</small></i></label>
        </>
      ) : <label className="reference-population"><span><small>POPULATION</small><strong>{population.toLocaleString()}</strong></span><input aria-label="Projected population" type="range" min="1500" max="2500" step="50" value={population} onChange={(event) => onPopulationChange(Number(event.target.value))} /><i><small>1,500</small><small>2,000</small><small>2,500</small></i></label>}
      <div className="reference-metrics">{metrics.map((metric) => <span key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong><em>{metric.trend}</em></span>)}</div>
      {activeScenario === "flood" && floodRun && <FloodMap run={floodRun} />}
      {activeScenario === "flood" ? (
        // The flood model has no confidence score: it passes benchmark tests (scripts/flood/validation.py) but hasn't been checked against real floods.
        <div className="reference-confidence"><span><small>MODEL STATUS</small><strong>Benchmarked</strong></span><p><em /> Checked against exact solutions · not calibrated against real floods</p></div>
      ) : activeScenario === "sewer" ? (
        // The sewer network is designed to CPHEEO rules (lib/sewer-network.ts), not surveyed, so there's no confidence score.
        <div className="reference-confidence"><span><small>MODEL STATUS</small><strong>Illustrative</strong></span><p><em /> Real SWMM engine · designed network, not surveyed pipes</p></div>
      ) : (
        <div className="reference-confidence"><span><small>MODEL CONFIDENCE</small><strong>91%</strong></span><i><b style={{ width: "91%" }} /></i><p><em /> Concept model · not calibrated</p></div>
      )}
      <button className={`reference-side-run ${running ? "running" : ""}`} disabled={running} onClick={onRun}>{running ? (activeScenario === "flood" ? "Running flood model…" : "Computing network…") : complete ? "✓ Simulation complete" : "Run simulation"}<Icon name="play" /></button>
    </section>
  );
}

const MAX_SHADE_DEPTH_M = 0.3;

// Peak water depth per cell (north up), and the deepest water over the storm.
function FloodMap({ run }: { run: FloodRun }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { peak_depth_m: depth, cell_kind: kind } = run.maps;
  const rows = depth.length;
  const columns = depth[0].length;

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, columns, rows);
    depth.forEach((row, j) => row.forEach((value, i) => {
      if (kind[j][i] === 2) return;
      const shade = Math.min(value / MAX_SHADE_DEPTH_M, 1);
      context.fillStyle = kind[j][i] === 1 ? "#34405c" : value < 0.01 ? "#0f1d36" : `rgb(${Math.round(90 - 80 * shade)}, ${Math.round(210 - 110 * shade)}, 255)`;
      context.fillRect(i, rows - 1 - j, 1, 1);
    }));
  }, [depth, kind, rows, columns]);

  const { time_s: time, max_depth_m: deepest } = run.timeline;
  const end = time[time.length - 1] || 1;
  const top = Math.max(...deepest, 0.01);
  const line = time.map((t, index) => `${(t / end) * 100},${30 - (deepest[index] / top) * 28}`).join(" ");

  return (
    <figure style={{ margin: "10px 0 4px" }}>
      <canvas ref={canvasRef} width={columns} height={rows} role="img" aria-label="Map of peak flood depth" style={{ width: "100%", aspectRatio: `${columns} / ${rows}`, imageRendering: "pixelated", borderRadius: 6, background: "rgba(255,255,255,0.03)" }} />
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-label="Deepest water over the storm" style={{ width: "100%", height: 32, display: "block", marginTop: 4 }}>
        <polyline points={line} fill="none" stroke="#5ac8ff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption style={{ fontSize: 11, opacity: 0.7 }}>Peak depth (light → {MAX_SHADE_DEPTH_M} m+ deep blue) · grey = buildings and walls · line: deepest water over the storm (max {top.toFixed(2)} m)</figcaption>
    </figure>
  );
}
