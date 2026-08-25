"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ScenarioKey = "sewer" | "flood" | "evacuation";
type LayerKey = "buildings" | "sewer" | "power" | "mobility";

const buildings = [
  { id: 1, name: "Civic Hospital", type: "Critical facility", x: 17, y: 18, w: 86, d: 70, h: 92, tone: "teal" },
  { id: 2, name: "Riverfront Tower", type: "Residential", x: 35, y: 12, w: 61, d: 58, h: 122, tone: "blue" },
  { id: 3, name: "Market Complex", type: "Commercial", x: 52, y: 18, w: 98, d: 58, h: 54, tone: "sand" },
  { id: 4, name: "District Office", type: "Government", x: 69, y: 12, w: 74, d: 65, h: 82, tone: "teal" },
  { id: 5, name: "Ward Housing 04", type: "Residential", x: 23, y: 45, w: 78, d: 68, h: 70, tone: "slate" },
  { id: 6, name: "Primary School", type: "Education", x: 44, y: 48, w: 102, d: 62, h: 42, tone: "sand" },
  { id: 7, name: "Substation E-14", type: "Power infrastructure", x: 65, y: 45, w: 65, d: 64, h: 36, tone: "yellow" },
  { id: 8, name: "Transit Depot", type: "Mobility", x: 79, y: 42, w: 86, d: 52, h: 44, tone: "slate" },
  { id: 9, name: "Water Treatment", type: "Utilities", x: 17, y: 73, w: 94, d: 62, h: 48, tone: "blue" },
  { id: 10, name: "Community Block", type: "Mixed use", x: 39, y: 73, w: 70, d: 62, h: 76, tone: "teal" },
  { id: 11, name: "Emergency Hub", type: "Response center", x: 61, y: 70, w: 78, d: 66, h: 58, tone: "yellow" },
  { id: 12, name: "Solar Microgrid", type: "Energy", x: 80, y: 72, w: 82, d: 64, h: 25, tone: "sand" },
];

const scenarios = {
  sewer: { label: "Sewer capacity", kicker: "FLOW SIMULATION", accent: "#ffbb38" },
  flood: { label: "Monsoon flood", kicker: "HAZARD MODEL", accent: "#4ecdc4" },
  evacuation: { label: "Rapid evacuation", kicker: "MOBILITY MODEL", accent: "#79a7ff" },
};

function Mark({ children }: { children: React.ReactNode }) {
  return <span className="mark" aria-hidden="true">{children}</span>;
}

export default function Home() {
  const [activeScenario, setActiveScenario] = useState<ScenarioKey>("sewer");
  const [population, setPopulation] = useState(2000);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ buildings: true, sewer: true, power: true, mobility: false });
  const [selectedId, setSelectedId] = useState(7);
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [tool, setTool] = useState("orbit");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [importState, setImportState] = useState("LiDAR scan · 2.8B points");
  const [toast, setToast] = useState("Digital twin synchronized · 2 min ago");
  const [addedAssets, setAddedAssets] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragOrigin = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const selected = buildings.find((building) => building.id === selectedId) ?? buildings[6];
  const flow = Math.round(68 + (population - 1500) * 0.054);
  const scenario = scenarios[activeScenario];
  const status = flow >= 90 ? "Capacity risk" : flow >= 80 ? "Watch closely" : "Within capacity";

  const metricSet = useMemo(() => {
    if (activeScenario === "flood") return [
      { value: "1.8 m", label: "Peak depth", trend: "+0.4 m" },
      { value: "14", label: "Assets exposed", trend: "3 critical" },
      { value: "47 min", label: "Drain-down", trend: "−12%" },
    ];
    if (activeScenario === "evacuation") return [
      { value: "31 min", label: "Clearance time", trend: "−8 min" },
      { value: "3,240", label: "People routed", trend: "96%" },
      { value: "2", label: "Bottlenecks", trend: "Review" },
    ];
    return [
      { value: `${flow}%`, label: "Network load", trend: `+${Math.max(0, flow - 68)}%` },
      { value: "42.6 L/s", label: "Peak outflow", trend: "+7.8 L/s" },
      { value: flow >= 90 ? "3" : "1", label: "Risk nodes", trend: flow >= 90 ? "Action needed" : "Monitored" },
    ];
  }, [activeScenario, flow]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function toggleLayer(key: LayerKey) {
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  }

  function runSimulation() {
    setRunning(true);
    setComplete(false);
    setToast("Running district network model…");
    window.setTimeout(() => {
      setRunning(false);
      setComplete(true);
      setToast(`${scenario.label} simulation complete`);
    }, 1800);
  }

  function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportState(`Processing · ${file.name}`);
    setToast("Aligning imagery and point cloud…");
    window.setTimeout(() => {
      setImportState(`${file.name} · Ready`);
      setToast("New scan registered to the district model");
    }, 1700);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (tool === "asset") return;
    dragOrigin.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setPan({
      x: dragOrigin.current.panX + event.clientX - dragOrigin.current.x,
      y: dragOrigin.current.panY + event.clientY - dragOrigin.current.y,
    });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleMapClick(event: React.MouseEvent<HTMLDivElement>) {
    if (tool !== "asset" || dragging) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setAddedAssets((current) => [
      ...current,
      { id: Date.now(), x: ((event.clientX - bounds.left) / bounds.width) * 100, y: ((event.clientY - bounds.top) / bounds.height) * 100 },
    ]);
    setTool("select");
    setToast("Backup generator placed · Unsaved change");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-glyph" aria-hidden="true"><i /><i /><i /></span>
          <span>MIRROR<span>CITY</span></span>
        </div>
        <div className="project-switcher">
          <span className="project-dot" />
          <div><small>ACTIVE DISTRICT</small><strong>Varuna River Ward</strong></div>
          <button aria-label="Open district switcher">⌄</button>
        </div>
        <div className="top-actions">
          <div className="sync-status"><span /> MODEL LIVE</div>
          <button className="quiet-button" onClick={() => setToast("Snapshot saved to scenario history")}>Save snapshot</button>
          <button className="primary-button" onClick={() => fileRef.current?.click()}><Mark>＋</Mark> Import data</button>
          <input ref={fileRef} className="sr-only" type="file" accept=".las,.laz,.tif,.tiff,.obj,.ply,image/*" onChange={handleImport} />
          <button className="avatar" aria-label="Open account menu">NK</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="icon-rail" aria-label="Primary navigation">
          <button className="rail-button active" aria-label="City twin"><Mark>◇</Mark></button>
          <button className="rail-button" aria-label="Data catalogue"><Mark>▥</Mark></button>
          <button className="rail-button" aria-label="Assets"><Mark>⌁</Mark></button>
          <button className="rail-button" aria-label="Analytics"><Mark>⌁</Mark></button>
          <span className="rail-spacer" />
          <button className="rail-button" aria-label="Help"><Mark>?</Mark></button>
          <button className="rail-button" aria-label="Settings"><Mark>⚙</Mark></button>
        </aside>

        <aside className="sidebar">
          <div className="sidebar-heading">
            <div><p>PROJECT SPACE</p><h1>District twin</h1></div>
            <button className="icon-button" aria-label="Project options">•••</button>
          </div>

          <section className="data-card">
            <div className="data-thumb"><span className="scan-grid" /><span className="scan-pulse" /></div>
            <div><small>SOURCE DATA</small><strong>{importState}</strong><span>12.4 cm ground resolution</span></div>
            <span className="check-badge">✓</span>
          </section>

          <section className="side-section">
            <div className="section-label"><span>MAP LAYERS</span><button aria-label="Add map layer">＋</button></div>
            <div className="layer-list">
              {([
                ["buildings", "Buildings & terrain", "624 structures", "#dfe7df"],
                ["sewer", "Sewer network", "18.2 km", "#ffb936"],
                ["power", "Power grid", "46 assets", "#55d5c8"],
                ["mobility", "Mobility", "Live traffic", "#83a7ff"],
              ] as Array<[LayerKey, string, string, string]>).map(([key, name, meta, color]) => (
                <button className={`layer-row ${layers[key] ? "on" : ""}`} key={key} onClick={() => toggleLayer(key)}>
                  <span className="layer-swatch" style={{ "--swatch": color } as React.CSSProperties} />
                  <span className="layer-name"><strong>{name}</strong><small>{meta}</small></span>
                  <span className="layer-toggle"><i /></span>
                </button>
              ))}
            </div>
          </section>

          <section className="side-section scenarios-section">
            <div className="section-label"><span>ACTIVE SCENARIO</span><button aria-label="Scenario options">•••</button></div>
            {(Object.keys(scenarios) as ScenarioKey[]).map((key) => (
              <button className={`scenario-row ${activeScenario === key ? "active" : ""}`} key={key} onClick={() => { setActiveScenario(key); setComplete(false); }}>
                <span className="scenario-icon" style={{ "--scenario": scenarios[key].accent } as React.CSSProperties}>{key === "sewer" ? "≋" : key === "flood" ? "⌁" : "↗"}</span>
                <span><strong>{scenarios[key].label}</strong><small>{key === "sewer" ? "1,500 → 2,000 people" : key === "flood" ? "100-year rainfall" : "East zone clearance"}</small></span>
                {activeScenario === key && <span className="live-pill">LIVE</span>}
              </button>
            ))}
          </section>

          <button className="add-scenario" onClick={() => setToast("New scenario template opened")}><Mark>＋</Mark> New simulation</button>
        </aside>

        <section className="map-panel">
          <div className="map-context">
            <span>INDIA</span><b>/</b><span>UTTAR PRADESH</span><b>/</b><strong>VARUNA RIVER WARD</strong>
          </div>

          <div className="map-tools" aria-label="Map tools">
            {[["select", "↖", "Select"], ["orbit", "↻", "Orbit"], ["measure", "↔", "Measure"], ["asset", "+", "Place asset"]].map(([key, icon, label]) => (
              <button key={key} className={tool === key ? "active" : ""} onClick={() => { setTool(key); if (key === "asset") setToast("Click anywhere on the map to place a backup generator"); }} title={label} aria-label={label}>{icon}</button>
            ))}
          </div>

          <div
            className={`map-stage tool-${tool} ${dragging ? "dragging" : ""}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onClick={handleMapClick}
          >
            <div className="map-glow" />
            <div className="city-world" style={{ transform: `translate(calc(-50% + ${pan.x}px), calc(-48% + ${pan.y}px)) scale(${zoom}) rotateX(57deg) rotateZ(-36deg)` }}>
              <div className="district-base">
                <div className="river"><i /><i /></div>
                <div className="road road-a" /><div className="road road-b" /><div className="road road-c" /><div className="road road-d" />
                <div className="block-grid" />
                {layers.sewer && <div className={`network sewer-network ${activeScenario === "sewer" && running ? "flowing" : ""}`}><i className="pipe p1" /><i className="pipe p2" /><i className="pipe p3" /><i className="pipe p4" /><i className="node n1" /><i className="node n2" /><i className="node n3 warning" /><i className="node n4" /></div>}
                {layers.power && <div className="network power-network"><i className="power-line l1" /><i className="power-line l2" /><i className="power-line l3" /><i className="power-node pn1" /><i className="power-node pn2" /><i className="power-node pn3" /></div>}
                {layers.mobility && <div className="mobility-network"><i /><i /><i /><i /><i /></div>}
                {layers.buildings && buildings.map((building) => (
                  <button
                    key={building.id}
                    className={`building tone-${building.tone} ${selectedId === building.id ? "selected" : ""}`}
                    style={{ left: `${building.x}%`, top: `${building.y}%`, width: building.w, height: building.d, "--height": `${building.h}px` } as React.CSSProperties}
                    onClick={(event) => { event.stopPropagation(); setSelectedId(building.id); setTool("select"); }}
                    aria-label={`Select ${building.name}`}
                  ><span className="building-top" /><span className="building-side-a" /><span className="building-side-b" /><i className="building-pin">{building.id === 7 ? "E-14" : building.id}</i></button>
                ))}
                {addedAssets.map((asset) => <button key={asset.id} className="added-asset" style={{ left: `${asset.x}%`, top: `${asset.y}%` }} onClick={(event) => { event.stopPropagation(); setToast("Backup Generator G-02 selected"); }}>G-02</button>)}
              </div>
            </div>

            <div className="north-indicator"><b>N</b><span /></div>
            <div className="zoom-control">
              <button onClick={() => setZoom((value) => Math.min(1.35, value + .1))} aria-label="Zoom in">＋</button>
              <button onClick={() => setZoom(1)} aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
              <button onClick={() => setZoom((value) => Math.max(.72, value - .1))} aria-label="Zoom out">−</button>
            </div>
            <div className="map-scale"><span />100 m</div>
            <div className="coordinates">25.3291° N&nbsp;&nbsp; 82.9876° E&nbsp;&nbsp; | &nbsp;&nbsp;ELV 82.4 m</div>
          </div>

          <div className="timebar">
            <button aria-label="Play timeline">▶</button><strong>08:30</strong>
            <input aria-label="Time of day" type="range" min="0" max="24" step=".5" defaultValue="8.5" />
            <span>12:00</span><span>16:00</span><span>20:00</span>
            <button className="calendar-button">26 AUG 2026</button>
          </div>
        </section>

        <aside className="inspector">
          <div className="inspector-tabs"><button className="active">SIMULATION</button><button>OBJECT</button></div>
          <div className="inspector-scroll">
            <section className="simulation-title">
              <span style={{ color: scenario.accent }}>{scenario.kicker}</span>
              <h2>{scenario.label}</h2>
              <p>{activeScenario === "sewer" ? "Test how the district network responds as occupancy changes." : activeScenario === "flood" ? "Estimate depth, exposure and recovery under severe rainfall." : "Model clearance time, route load and response access."}</p>
            </section>

            {activeScenario === "sewer" && <section className="population-control">
              <div className="control-heading"><span>POPULATION</span><strong>{population.toLocaleString()} <small>people</small></strong></div>
              <input aria-label="Projected population" type="range" min="1500" max="2500" step="50" value={population} onChange={(event) => { setPopulation(Number(event.target.value)); setComplete(false); }} />
              <div className="range-labels"><span>1,500<br/><small>Current</small></span><span>2,000<br/><small>Planned</small></span><span>2,500<br/><small>Stress</small></span></div>
            </section>}

            <section className="metrics-grid">
              {metricSet.map((metric, index) => <div key={metric.label} className={index === 0 && flow >= 90 && activeScenario === "sewer" ? "risk" : ""}><small>{metric.label}</small><strong>{metric.value}</strong><span>{metric.trend}</span></div>)}
            </section>

            <section className={`capacity-card ${flow >= 90 && activeScenario === "sewer" ? "at-risk" : ""}`}>
              <div className="capacity-header"><span>MODEL CONFIDENCE</span><strong>{activeScenario === "sewer" ? "94%" : activeScenario === "flood" ? "89%" : "91%"}</strong></div>
              <div className="capacity-bar"><i /></div>
              <p><span /> {activeScenario === "sewer" ? status : activeScenario === "flood" ? "3 priority interventions found" : "Routes remain operational"}</p>
            </section>

            <button className={`run-button ${running ? "running" : ""}`} disabled={running} onClick={runSimulation}>{running ? <><i /> COMPUTING NETWORK…</> : complete ? "✓ SIMULATION COMPLETE" : "▶ RUN SIMULATION"}</button>

            {complete && <section className="recommendation">
              <div className="recommendation-icon">!</div>
              <div><span>RECOMMENDED ACTION</span><strong>{activeScenario === "sewer" ? "Upgrade node SW-18 before occupancy permit" : activeScenario === "flood" ? "Stage pumps at River Gate 03" : "Reverse Market Road during clearance"}</strong><button onClick={() => setToast("Intervention added to district action plan")}>Add to action plan →</button></div>
            </section>}

            <section className="selected-object">
              <div className="section-label"><span>SELECTED ASSET</span><button aria-label="Close selection" onClick={() => setSelectedId(0)}>×</button></div>
              <div className="asset-preview"><span className={`mini-building tone-${selected.tone}`} /><i>3D</i></div>
              <h3>{selected.name}</h3><p>{selected.type} · Asset MC-{String(selected.id).padStart(4, "0")}</p>
              <div className="asset-facts"><span><small>CONDITION</small><strong className="good">● Operational</strong></span><span><small>LAST INSPECTION</small><strong>12 Aug 2026</strong></span></div>
              <div className="asset-actions"><button onClick={() => setToast(`${selected.name} moved to edit mode`)}>Move</button><button onClick={() => setToast(`Replacement option opened for ${selected.name}`)}>Replace</button><button onClick={() => setToast("Asset details panel expanded")}>Details</button></div>
            </section>
          </div>
        </aside>
      </section>

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
