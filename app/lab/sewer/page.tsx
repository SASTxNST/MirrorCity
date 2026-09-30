"use client";

/// <reference types="vite/client" />
import { useState } from "react";
import { runSwmm } from "../../../lib/swmm";
import streetNetwork from "./street.inp?raw";

// Lab page (not linked from the app): runs EPA SWMM (5.2.2, compiled to
// WebAssembly by @fileops/swmm-wasm-web) in the browser on a small test
// sewer network, to evaluate it before replacing the Sewer scenario's formula.

// Report sections worth showing; each runs until the next blank-line gap.
const SECTIONS = ["Node Depth Summary", "Node Flooding Summary", "Link Flow Summary", "Flow Routing Continuity"];

function section(report: string, title: string) {
  const start = report.indexOf(title);
  if (start < 0) return `${title}: none`;
  return report.slice(start).split(/\n[ \t]*\n[ \t]*\n/)[0].trimEnd();
}

export default function SewerLab() {
  const [network, setNetwork] = useState(streetNetwork);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ code: number; runMs: number; report: string } | null>(null);

  async function run() {
    setRunning(true);
    const started = performance.now();
    const { code, report } = await runSwmm(network);
    setResult({ code, runMs: performance.now() - started, report });
    setRunning(false);
  }

  return (
    <main style={{ minHeight: "100vh", padding: 24, background: "#020611", color: "#dbe6ff", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Sewer model lab</h1>
      <p style={{ margin: "0 0 16px", color: "#8ea2c8", maxWidth: 720 }}>
        Runs EPA SWMM in your browser on the network below (SWMM input format: 2 catchments, 3 manholes, 3 pipes, 1-hour storm). Edit it and run again.
      </p>
      <textarea aria-label="SWMM network" value={network} onChange={(event) => setNetwork(event.target.value)} spellCheck={false} style={{ width: "100%", maxWidth: 720, height: 220, fontFamily: "ui-monospace, monospace", fontSize: 12, background: "#0a1428", color: "#dbe6ff", border: "1px solid #1d2c52", borderRadius: 6 }} />
      <div style={{ margin: "12px 0 20px" }}>
        <button onClick={run} disabled={running}>{running ? "Running…" : "Run SWMM"}</button>
      </div>
      {result && (
        <section>
          <p style={{ color: result.code ? "#ff8a7a" : "#8ea2c8" }}>
            {result.code ? `SWMM error ${result.code} — see the report below` : "Run complete"} · {result.runMs.toFixed(0)} ms (includes loading the engine on the first run)
          </p>
          <pre style={{ fontSize: 12, overflowX: "auto", maxWidth: "100%" }}>
            {result.code ? result.report : SECTIONS.map((title) => section(result.report, title)).join("\n\n")}
          </pre>
        </section>
      )}
    </main>
  );
}
