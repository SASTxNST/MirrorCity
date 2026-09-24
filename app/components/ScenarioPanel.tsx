import { Icon } from "./Icon";

export type ScenarioKey = "sewer" | "flood" | "evacuation";

type Props = {
  scenario: { label: string; kicker: string };
  activeScenario: ScenarioKey;
  population: number;
  metrics: Array<{ value: string; label: string; trend: string }>;
  running: boolean;
  complete: boolean;
  onPopulationChange: (population: number) => void;
  onRun: () => void;
  onOpenWorkspace: () => void;
};

export default function ScenarioPanel({ scenario, activeScenario, population, metrics, running, complete, onPopulationChange, onRun, onOpenWorkspace }: Props) {
  return (
    <section className="reference-side-card simulation-card">
      <header><div><span>{scenario.kicker}</span><h2>{scenario.label}</h2></div><button aria-label="Open scenario workspace" onClick={onOpenWorkspace}>•••</button></header>
      <p>{activeScenario === "sewer" ? "Test how occupancy changes pressure across the district network." : activeScenario === "flood" ? "See depth and exposure under severe monsoon rainfall." : "Model route load, clearance and emergency access."}</p>
      <label className="reference-population"><span><small>POPULATION</small><strong>{population.toLocaleString()}</strong></span><input aria-label="Projected population" type="range" min="1500" max="2500" step="50" value={population} onChange={(event) => onPopulationChange(Number(event.target.value))} /><i><small>1,500</small><small>2,000</small><small>2,500</small></i></label>
      <div className="reference-metrics">{metrics.map((metric) => <span key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong><em>{metric.trend}</em></span>)}</div>
      <div className="reference-confidence"><span><small>MODEL CONFIDENCE</small><strong>{activeScenario === "sewer" ? "94%" : activeScenario === "flood" ? "89%" : "91%"}</strong></span><i><b style={{ width: activeScenario === "flood" ? "89%" : activeScenario === "evacuation" ? "91%" : "94%" }} /></i><p><em /> Concept model · not calibrated</p></div>
      <button className={`reference-side-run ${running ? "running" : ""}`} disabled={running} onClick={onRun}>{running ? "Computing network…" : complete ? "✓ Simulation complete" : "Run simulation"}<Icon name="play" /></button>
    </section>
  );
}
