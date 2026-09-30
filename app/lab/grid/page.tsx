"use client";

/// <reference types="vite/client" />
import { useEffect, useRef, useState } from "react";
import GridWorker from "../../grid-worker.ts?worker";

// Lab page (not linked from the app): runs pandapower load flows in the
// browser on standard test networks, to evaluate it before modelling the
// district's power grid.

type Result =
  | { ok: true; bootMs: number; result: { ms: number; buses: number; lines: number; vm_min: number; vm_max: number; loading_max: number; busiest_line: string; losses_mw: number; grid_import_mw: number } }
  | { ok: false; error: string };

const NETWORKS = { cigre_mv: "CIGRE medium-voltage feeder (with PV and wind)", case30: "IEEE 30-bus", case118: "IEEE 118-bus" } as const;

export default function GridLab() {
  const workerRef = useRef<Worker | null>(null);
  const [network, setNetwork] = useState<keyof typeof NETWORKS>("cigre_mv");
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<Array<{ network: keyof typeof NETWORKS; result: Result }>>([]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  function run() {
    workerRef.current ??= new GridWorker();
    const worker = workerRef.current;
    const chosen = network;
    setRunning(true);
    worker.onmessage = (event: MessageEvent<Result>) => {
      setRuns((current) => [{ network: chosen, result: event.data }, ...current]);
      setRunning(false);
    };
    worker.postMessage({ network: chosen });
  }

  return (
    <main style={{ minHeight: "100vh", padding: 24, background: "#020611", color: "#dbe6ff", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Power-grid lab</h1>
      <p style={{ margin: "0 0 20px", color: "#8ea2c8", maxWidth: 680 }}>
        Runs pandapower (AC load flow) in your browser via Pyodide. The first run downloads Python, pandas, SciPy and pandapower, so it takes a while.
      </p>
      <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", marginBottom: 20 }}>
        <label>Network<br />
          <select value={network} onChange={(event) => setNetwork(event.target.value as keyof typeof NETWORKS)}>
            {Object.entries(NETWORKS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <button onClick={run} disabled={running}>{running ? "Running…" : "Run load flow"}</button>
      </div>
      {runs.map(({ network: name, result }, index) => (
        <section key={runs.length - index} style={{ border: "1px solid #1d2c52", borderRadius: 8, padding: 12, marginBottom: 12, maxWidth: 680 }}>
          <strong>{NETWORKS[name]}</strong>
          {result.ok ? (
            <table style={{ marginTop: 6 }}>
              <tbody>
                <tr><td style={{ paddingRight: 16 }}>Size</td><td>{result.result.buses} buses · {result.result.lines} lines</td></tr>
                <tr><td>Voltage range</td><td>{result.result.vm_min.toFixed(4)} – {result.result.vm_max.toFixed(4)} p.u.</td></tr>
                <tr><td>Most loaded line</td><td>{result.result.loading_max.toFixed(1)}% ({result.result.busiest_line})</td></tr>
                <tr><td>Losses</td><td>{result.result.losses_mw.toFixed(3)} MW</td></tr>
                <tr><td>Grid import</td><td>{result.result.grid_import_mw.toFixed(3)} MW</td></tr>
                <tr><td>Time</td><td>load flow {result.result.ms.toFixed(0)} ms{result.bootMs > 1000 ? ` · Python startup ${(result.bootMs / 1000).toFixed(1)} s` : ""}</td></tr>
              </tbody>
            </table>
          ) : (
            <p style={{ margin: "4px 0 0", color: "#ff8a7a" }}>Load flow failed: {result.error}</p>
          )}
        </section>
      ))}
    </main>
  );
}
