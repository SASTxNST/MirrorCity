"use client";

/// <reference types="vite/client" />
import { useEffect, useRef, useState } from "react";
import FloodWorker from "../../flood-worker.ts?worker";

// Lab page (not linked from the app): runs the real Python flood solver in
// the browser via Pyodide, to evaluate feasibility before wiring it into the
// "Monsoon flood" scenario.

type Result =
  | { ok: true; summary: { grid: { nx: number; ny: number; dx_m: number; dy_m: number }; results: Record<string, number> }; bootMs: number; runMs: number }
  | { ok: false; error: string };

const LABELS: Record<string, string> = {
  max_depth_m: "Peak depth (m)",
  max_velocity_m_per_s: "Peak velocity (m/s)",
  water_volume_m3: "Water volume (m³)",
  rainfall_depth_m: "Rainfall depth (m)",
  infiltration_depth_mean_m: "Mean infiltration (m)",
  boundary_outflow_m3: "Boundary outflow (m³)",
};

export default function FloodLab() {
  const workerRef = useRef<Worker | null>(null);
  const [rainfall, setRainfall] = useState(100);
  const [duration, setDuration] = useState(1800);
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<Array<{ rainfall: number; duration: number; result: Result }>>([]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  function run() {
    workerRef.current ??= new FloodWorker();
    const worker = workerRef.current;
    const inputs = { rainfall, duration };
    setRunning(true);
    worker.onmessage = (event: MessageEvent<Result>) => {
      setRuns((current) => [{ ...inputs, result: event.data }, ...current]);
      setRunning(false);
    };
    worker.postMessage(inputs);
  }

  return (
    <main style={{ minHeight: "100vh", padding: 24, background: "#020611", color: "#dbe6ff", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Flood solver lab</h1>
      <p style={{ margin: "0 0 20px", color: "#8ea2c8", maxWidth: 640 }}>
        Runs <code>scripts/flood</code> unchanged in your browser (Pyodide + NumPy) on the solver&apos;s built-in 160 × 120 m test terrain. The first run downloads Python, so it takes longer.
      </p>
      <div style={{ display: "flex", gap: 16, alignItems: "end", flexWrap: "wrap", marginBottom: 20 }}>
        <label>Peak rainfall (mm/h)<br /><input type="number" min={1} value={rainfall} onChange={(event) => setRainfall(Number(event.target.value))} /></label>
        <label>Duration (s)<br /><input type="number" min={60} step={60} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label>
        <button onClick={run} disabled={running}>{running ? "Running…" : "Run solver"}</button>
      </div>
      {runs.map(({ rainfall: r, duration: d, result }, index) => (
        <section key={runs.length - index} style={{ border: "1px solid #1d2c52", borderRadius: 8, padding: 12, marginBottom: 12, maxWidth: 640 }}>
          <strong>{r} mm/h for {d} s</strong>
          {result.ok ? (
            <>
              <p style={{ margin: "4px 0 8px", color: "#8ea2c8" }}>
                Grid {result.summary.grid.nx} × {result.summary.grid.ny} at {result.summary.grid.dx_m} m · Python startup {(result.bootMs / 1000).toFixed(1)} s · solver {(result.runMs / 1000).toFixed(2)} s
              </p>
              <table>
                <tbody>
                  {Object.entries(LABELS).map(([key, label]) => (
                    <tr key={key}><td style={{ paddingRight: 16 }}>{label}</td><td>{result.summary.results[key]?.toPrecision(6)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p style={{ margin: "4px 0 0", color: "#ff8a7a" }}>Solver failed: {result.error}</p>
          )}
        </section>
      ))}
    </main>
  );
}
