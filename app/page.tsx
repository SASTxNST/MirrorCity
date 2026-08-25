"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ScenarioKey = "sewer" | "flood" | "evacuation";
type LayerKey = "buildings" | "sewer" | "power" | "mobility";
type ToolKey = "select" | "orbit" | "measure" | "line" | "area" | "building" | "asset";
type LineKind = "sewer" | "power" | "water" | "road";
type MapPoint = { x: number; y: number };
type DrawnLine = { id: number; kind: LineKind; points: MapPoint[] };
type DrawnArea = { id: number; points: MapPoint[] };
type PlannedBuilding = { id: number; x: number; y: number; floors: number };
type AssetDefinition = { id: string; name: string; category: string; code: string; description: string; size: string; tone: string };
type PlacedAsset = { id: number; x: number; y: number; asset: AssetDefinition };

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

const assetLibrary: AssetDefinition[] = [
  { id: "generator", name: "Backup generator", category: "Energy", code: "GEN", description: "250 kVA emergency diesel generator", size: "42 KB", tone: "yellow" },
  { id: "substation", name: "Compact substation", category: "Energy", code: "SUB", description: "11 kV prefabricated distribution unit", size: "68 KB", tone: "teal" },
  { id: "pump", name: "Flood pump station", category: "Water", code: "PMP", description: "High-volume portable dewatering pump", size: "51 KB", tone: "blue" },
  { id: "manhole", name: "Sewer manhole", category: "Water", code: "MH", description: "Inspection chamber with removable cover", size: "18 KB", tone: "sand" },
  { id: "tower", name: "Telecom tower", category: "Communications", code: "TEL", description: "30 m lattice emergency communications mast", size: "77 KB", tone: "slate" },
  { id: "barrier", name: "Flood barrier", category: "Response", code: "BAR", description: "Modular interlocking water barrier", size: "29 KB", tone: "yellow" },
  { id: "shelter", name: "Relief shelter", category: "Response", code: "SHL", description: "Rapid-deployment 40-person shelter", size: "63 KB", tone: "teal" },
  { id: "hospital", name: "Field hospital", category: "Health", code: "MED", description: "Expandable emergency treatment unit", size: "84 KB", tone: "blue" },
];

const lineKinds: Array<{ id: LineKind; label: string; color: string }> = [
  { id: "sewer", label: "Sewer", color: "#ffbb38" },
  { id: "power", label: "Power", color: "#50d2c5" },
  { id: "water", label: "Water", color: "#5caeff" },
  { id: "road", label: "Road", color: "#cbd4ce" },
];

function getSegments(points: MapPoint[]) {
  return points.slice(1).map((point, index) => {
    const previous = points[index];
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    return { left: previous.x, top: previous.y, width: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) * 180 / Math.PI };
  });
}

function buildObjAsset(asset: AssetDefinition) {
  const height = asset.id === "tower" ? 4 : asset.id === "barrier" ? .8 : asset.id === "manhole" ? .35 : 1.8;
  const width = asset.id === "barrier" ? 3 : asset.id === "shelter" || asset.id === "hospital" ? 2.8 : 1.6;
  const depth = asset.id === "barrier" ? .45 : asset.id === "shelter" || asset.id === "hospital" ? 2.2 : 1.3;
  return `# MirrorCity civic asset\n# ${asset.name}\no ${asset.id}\nv ${-width / 2} 0 ${-depth / 2}\nv ${width / 2} 0 ${-depth / 2}\nv ${width / 2} 0 ${depth / 2}\nv ${-width / 2} 0 ${depth / 2}\nv ${-width / 2} ${height} ${-depth / 2}\nv ${width / 2} ${height} ${-depth / 2}\nv ${width / 2} ${height} ${depth / 2}\nv ${-width / 2} ${height} ${depth / 2}\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 2 6 7 3\nf 3 7 8 4\nf 5 1 4 8\n`;
}

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
  const [tool, setTool] = useState<ToolKey>("orbit");
  const [lineKind, setLineKind] = useState<LineKind>("sewer");
  const [draftPoints, setDraftPoints] = useState<MapPoint[]>([]);
  const [drawnLines, setDrawnLines] = useState<DrawnLine[]>([]);
  const [drawnAreas, setDrawnAreas] = useState<DrawnArea[]>([]);
  const [plannedBuildings, setPlannedBuildings] = useState<PlannedBuilding[]>([]);
  const [buildingFloors, setBuildingFloors] = useState(4);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [importState, setImportState] = useState("LiDAR scan · 2.8B points");
  const [toast, setToast] = useState("Digital twin synchronized · 2 min ago");
  const [addedAssets, setAddedAssets] = useState<PlacedAsset[]>([]);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetCategory, setAssetCategory] = useState("All");
  const [selectedAsset, setSelectedAsset] = useState<AssetDefinition>(assetLibrary[0]);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragOrigin = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const selected = buildings.find((building) => building.id === selectedId) ?? buildings[6];
  const flow = Math.round(68 + (population - 1500) * 0.054);
  const scenario = scenarios[activeScenario];
  const status = flow >= 90 ? "Capacity risk" : flow >= 80 ? "Watch closely" : "Within capacity";
  const assetCategories = ["All", ...Array.from(new Set(assetLibrary.map((asset) => asset.category)))];
  const filteredAssets = assetLibrary.filter((asset) => (assetCategory === "All" || asset.category === assetCategory) && `${asset.name} ${asset.category} ${asset.description}`.toLowerCase().includes(assetSearch.toLowerCase()));

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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDraftPoints([]);
        setTool("select");
        setAssetLibraryOpen(false);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoLast();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

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

  function selectTool(nextTool: ToolKey) {
    setDraftPoints([]);
    setTool(nextTool);
    if (nextTool === "line") setToast("Click points on the map, then finish the utility line");
    if (nextTool === "area") setToast("Click three or more points to mark a planning zone");
    if (nextTool === "building") setToast("Click the map to place a proposed building");
    if (nextTool === "asset") setAssetLibraryOpen(true);
  }

  function finishDrawing() {
    if (tool === "line" && draftPoints.length >= 2) {
      setDrawnLines((current) => [...current, { id: Date.now(), kind: lineKind, points: draftPoints }]);
      setToast(`${lineKinds.find((kind) => kind.id === lineKind)?.label} line created · ${draftPoints.length} nodes`);
    } else if (tool === "area" && draftPoints.length >= 3) {
      setDrawnAreas((current) => [...current, { id: Date.now(), points: draftPoints }]);
      setToast(`Planning zone created · ${draftPoints.length} vertices`);
    } else {
      setToast(tool === "area" ? "Add at least 3 points" : "Add at least 2 points");
      return;
    }
    setDraftPoints([]);
    setTool("select");
  }

  function undoLast() {
    if (draftPoints.length) {
      setDraftPoints((current) => current.slice(0, -1));
      return;
    }
    if (plannedBuildings.length) {
      setPlannedBuildings((current) => current.slice(0, -1));
      setToast("Last building removed");
      return;
    }
    if (addedAssets.length) {
      setAddedAssets((current) => current.slice(0, -1));
      setToast("Last asset removed");
      return;
    }
    if (drawnLines.length) {
      setDrawnLines((current) => current.slice(0, -1));
      setToast("Last line removed");
    }
  }

  function downloadAsset(asset: AssetDefinition) {
    const blob = new Blob([buildObjAsset(asset)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mirrorcity-${asset.id}.obj`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setToast(`${asset.name}.obj downloaded`);
  }

  function beginAssetPlacement(asset: AssetDefinition) {
    setSelectedAsset(asset);
    setAssetLibraryOpen(false);
    setTool("asset");
    setToast(`Click the map to place ${asset.name}`);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (["asset", "line", "area", "building"].includes(tool)) return;
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
    if (dragging || !["asset", "line", "area", "building"].includes(tool)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = { x: ((event.clientX - bounds.left) / bounds.width) * 100, y: ((event.clientY - bounds.top) / bounds.height) * 100 };
    if (tool === "line" || tool === "area") {
      setDraftPoints((current) => [...current, point]);
      return;
    }
    if (tool === "building") {
      setPlannedBuildings((current) => [...current, { id: Date.now(), x: point.x, y: point.y, floors: buildingFloors }]);
      setToast(`${buildingFloors}-floor proposed building placed`);
      return;
    }
    setAddedAssets((current) => [...current, { id: Date.now(), x: point.x, y: point.y, asset: selectedAsset }]);
    setTool("select");
    setToast(`${selectedAsset.name} placed · Unsaved change`);
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
          <button className="quiet-button asset-library-button" onClick={() => setAssetLibraryOpen(true)}>▦ Asset library</button>
          <button className="primary-button" onClick={() => fileRef.current?.click()}><Mark>＋</Mark> Import data</button>
          <input ref={fileRef} className="sr-only" type="file" accept=".las,.laz,.tif,.tiff,.obj,.ply,.glb,.gltf,.fbx,image/*" onChange={handleImport} />
          <button className="avatar" aria-label="Open account menu">NK</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="icon-rail" aria-label="Primary navigation">
          <button className="rail-button active" aria-label="City twin"><Mark>◇</Mark></button>
          <button className="rail-button" aria-label="Data catalogue"><Mark>▥</Mark></button>
          <button className="rail-button" aria-label="Assets" onClick={() => setAssetLibraryOpen(true)}><Mark>▦</Mark></button>
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

          <section className="side-section create-section">
            <div className="section-label"><span>CREATE</span><button aria-label="Undo last edit" onClick={undoLast}>↶</button></div>
            <div className="create-grid">
              <button className={tool === "line" ? "active" : ""} onClick={() => selectTool("line")}><b>⌁</b><span>Utility line</span></button>
              <button className={tool === "area" ? "active" : ""} onClick={() => selectTool("area")}><b>⬡</b><span>Plan zone</span></button>
              <button className={tool === "building" ? "active" : ""} onClick={() => selectTool("building")}><b>▥</b><span>Building</span></button>
              <button className={tool === "asset" ? "active" : ""} onClick={() => setAssetLibraryOpen(true)}><b>＋</b><span>3D asset</span></button>
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
            {([["select", "↖", "Select"], ["orbit", "↻", "Orbit"], ["measure", "↔", "Measure"], ["line", "⌁", "Draw utility"], ["area", "⬡", "Draw zone"], ["building", "▥", "Place building"], ["asset", "+", "Place 3D asset"]] as Array<[ToolKey, string, string]>).map(([key, icon, label]) => (
              <button key={key} className={tool === key ? "active" : ""} onClick={() => selectTool(key)} title={label} aria-label={label}>{icon}</button>
            ))}
          </div>

          {(tool === "line" || tool === "area" || tool === "building" || tool === "asset") && <div className="create-dock">
            <div className="dock-heading"><span>{tool === "line" ? "DRAW UTILITY LINE" : tool === "area" ? "DRAW PLANNING ZONE" : tool === "building" ? "PLACE BUILDING" : "PLACE 3D ASSET"}</span><button onClick={() => { setTool("select"); setDraftPoints([]); }}>×</button></div>
            {tool === "line" && <div className="line-kind-picker">{lineKinds.map((kind) => <button key={kind.id} className={lineKind === kind.id ? "active" : ""} style={{ "--kind": kind.color } as React.CSSProperties} onClick={() => setLineKind(kind.id)}><i />{kind.label}</button>)}</div>}
            {tool === "area" && <p>Click around the site boundary. Add at least three points.</p>}
            {tool === "building" && <label className="floor-control"><span>FLOORS</span><input type="range" min="1" max="18" value={buildingFloors} onChange={(event) => setBuildingFloors(Number(event.target.value))}/><strong>{buildingFloors}</strong></label>}
            {tool === "asset" && <div className="chosen-asset"><i>{selectedAsset.code}</i><span><strong>{selectedAsset.name}</strong><small>{selectedAsset.category}</small></span><button onClick={() => setAssetLibraryOpen(true)}>Change</button></div>}
            {(tool === "line" || tool === "area") && <div className="dock-actions"><span>{draftPoints.length} {draftPoints.length === 1 ? "point" : "points"}</span><button onClick={() => setDraftPoints((current) => current.slice(0, -1))} disabled={!draftPoints.length}>Undo point</button><button className="finish-button" onClick={finishDrawing}>Finish</button></div>}
          </div>}

          <div
            className={`map-stage tool-${tool} ${dragging ? "dragging" : ""}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onClick={handleMapClick}
          >
            <div className="map-glow" />
            <div className="author-layer" aria-label="User-created map geometry">
              {drawnAreas.map((area) => <div key={area.id} className="drawn-area" style={{ clipPath: `polygon(${area.points.map((point) => `${point.x}% ${point.y}%`).join(",")})` }} />)}
              {tool === "area" && draftPoints.length >= 3 && <div className="drawn-area draft" style={{ clipPath: `polygon(${draftPoints.map((point) => `${point.x}% ${point.y}%`).join(",")})` }} />}
              {[...drawnLines, ...(tool === "line" && draftPoints.length > 1 ? [{ id: -1, kind: lineKind, points: draftPoints }] : [])].flatMap((line) => getSegments(line.points).map((segment, index) => <i key={`${line.id}-${index}`} className={`user-line kind-${line.kind} ${line.id === -1 ? "draft" : ""}`} style={{ left: `${segment.left}%`, top: `${segment.top}%`, width: `${segment.width}%`, transform: `rotate(${segment.angle}deg)` }} />))}
              {draftPoints.map((point, index) => <i key={`point-${index}`} className="draft-point" style={{ left: `${point.x}%`, top: `${point.y}%` }}>{index + 1}</i>)}
              {plannedBuildings.map((building) => <button key={building.id} className="planned-building" style={{ left: `${building.x}%`, top: `${building.y}%`, "--floors": building.floors } as React.CSSProperties} onClick={(event) => { event.stopPropagation(); setToast(`Proposed ${building.floors}-floor building selected`); }}><i /><b>{building.floors}F</b></button>)}
              {addedAssets.map((asset) => <button key={asset.id} className={`placed-map-asset tone-${asset.asset.tone}`} style={{ left: `${asset.x}%`, top: `${asset.y}%` }} onClick={(event) => { event.stopPropagation(); setToast(`${asset.asset.name} selected`); }}><i>{asset.asset.code}</i><span>{asset.asset.name}</span></button>)}
            </div>
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

      {assetLibraryOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setAssetLibraryOpen(false)}>
        <section className="asset-library" role="dialog" aria-modal="true" aria-labelledby="asset-library-title" onMouseDown={(event) => event.stopPropagation()}>
          <header className="library-header">
            <div><span>3D CONTENT CATALOGUE</span><h2 id="asset-library-title">Civic asset library</h2><p>Place optimized planning assets in the twin or download an OBJ for your own 3D pipeline.</p></div>
            <button aria-label="Close asset library" onClick={() => setAssetLibraryOpen(false)}>×</button>
          </header>
          <div className="library-controls">
            <label><span>⌕</span><input autoFocus value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Search pumps, power, shelters…" /></label>
            <div>{assetCategories.map((category) => <button key={category} className={assetCategory === category ? "active" : ""} onClick={() => setAssetCategory(category)}>{category}</button>)}</div>
          </div>
          <div className="asset-catalogue">
            {filteredAssets.map((asset) => <article className="catalogue-card" key={asset.id}>
              <div className={`catalogue-preview tone-${asset.tone}`}><span className={`asset-model model-${asset.id}`}><i /><b /></span><em>LOW POLY</em></div>
              <div className="catalogue-copy"><span>{asset.category}</span><h3>{asset.name}</h3><p>{asset.description}</p><small>OBJ · Metric scale · {asset.size}</small></div>
              <div className="catalogue-actions"><button className="place-button" onClick={() => beginAssetPlacement(asset)}>＋ Place in twin</button><button className="download-button" onClick={() => downloadAsset(asset)}>↓ Download OBJ</button></div>
            </article>)}
            {!filteredAssets.length && <div className="empty-assets"><strong>No assets found</strong><span>Try a different search or category.</span></div>}
          </div>
          <footer className="library-footer"><span><i /> 8 verified planning assets</span><p>All assets are lightweight, editable and generated for this MirrorCity prototype.</p></footer>
        </section>
      </div>}

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
