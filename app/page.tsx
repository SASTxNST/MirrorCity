"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ModelViewer from "./ModelViewer";

type ScenarioKey = "sewer" | "flood" | "evacuation";
type LayerKey = "buildings" | "sewer" | "power" | "mobility" | "sensors" | "construction";
type ToolKey = "select" | "orbit" | "measure" | "line" | "area" | "building" | "asset";
type LineKind = "sewer" | "power" | "water" | "road";
type MapPoint = { x: number; y: number };
type DrawnLine = { id: number; kind: LineKind; points: MapPoint[] };
type DrawnArea = { id: number; points: MapPoint[] };
type PlannedBuilding = { id: number; x: number; y: number; floors: number };
type AssetDefinition = { id: string; name: string; category: string; code: string; description: string; size: string; tone: string; file?: string; format?: "OBJ" | "GLB"; preview?: string; stats?: Array<{ label: string; value: string }> };
type PlacedAsset = { id: number; x: number; y: number; rotation: number; scale: number; asset: AssetDefinition };

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
  { id: "iith-low-slope", name: "IITH low-slope terrain", category: "IITH terrain", code: "I01", description: "6,953-triangle ground surface from slope_0 with a fitted 0.54° grade", size: "165 KB", tone: "teal", file: "/models/iith/iith-low-slope.glb", format: "GLB", preview: "/models/iith/iith-low-slope.png", stats: [{ label: "SOURCE", value: "slope_0" }, { label: "GROUND POINTS", value: "17,732" }, { label: "FITTED GRADE", value: "0.54°" }, { label: "TRIANGLES", value: "6,953" }] },
  { id: "iith-medium-slope", name: "IITH medium-slope terrain", category: "IITH terrain", code: "I05", description: "6,932-triangle ground surface from slope_5 with a fitted 3.02° grade", size: "165 KB", tone: "teal", file: "/models/iith/iith-medium-slope.glb", format: "GLB", preview: "/models/iith/iith-medium-slope.png", stats: [{ label: "SOURCE", value: "slope_5" }, { label: "GROUND POINTS", value: "17,732" }, { label: "FITTED GRADE", value: "3.02°" }, { label: "TRIANGLES", value: "6,932" }] },
  { id: "iith-high-slope", name: "IITH high-slope terrain", category: "IITH terrain", code: "I10", description: "6,904-triangle ground surface from slope_10 with a fitted 6.59° grade", size: "165 KB", tone: "yellow", file: "/models/iith/iith-high-slope.glb", format: "GLB", preview: "/models/iith/iith-high-slope.png", stats: [{ label: "SOURCE", value: "slope_10" }, { label: "GROUND POINTS", value: "17,732" }, { label: "FITTED GRADE", value: "6.59°" }, { label: "TRIANGLES", value: "6,904" }] },
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
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ buildings: true, sewer: true, power: true, mobility: false, sensors: true, construction: true });
  const [inspectorTab, setInspectorTab] = useState<"simulation" | "operations" | "object">("simulation");
  const [operationalMode, setOperationalMode] = useState(true);
  const [compareMode, setCompareMode] = useState(false);
  const [incidentActive, setIncidentActive] = useState(false);
  const [liveTick, setLiveTick] = useState(0);
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
  const [importState, setImportState] = useState("IITH ground dataset · 11 PCD scans");
  const [toast, setToast] = useState("Digital twin synchronized · 2 min ago");
  const [addedAssets, setAddedAssets] = useState<PlacedAsset[]>([]);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetCategory, setAssetCategory] = useState("All");
  const [selectedAsset, setSelectedAsset] = useState<AssetDefinition>(assetLibrary[0]);
  const [viewerAsset, setViewerAsset] = useState<AssetDefinition | null>(null);
  const [selectedPlacedAssetId, setSelectedPlacedAssetId] = useState<number | null>(null);
  const [replaceAssetId, setReplaceAssetId] = useState<number | null>(null);
  const [movingAssetId, setMovingAssetId] = useState<number | null>(null);
  const [placementPreview, setPlacementPreview] = useState<MapPoint | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragOrigin = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const selected = buildings.find((building) => building.id === selectedId) ?? buildings[6];
  const flow = Math.round(68 + (population - 1500) * 0.054);
  const scenario = scenarios[activeScenario];
  const status = flow >= 90 ? "Capacity risk" : flow >= 80 ? "Watch closely" : "Within capacity";
  const assetCategories = ["All", ...Array.from(new Set(assetLibrary.map((asset) => asset.category)))];
  const filteredAssets = assetLibrary.filter((asset) => (assetCategory === "All" || asset.category === assetCategory) && `${asset.name} ${asset.category} ${asset.description}`.toLowerCase().includes(assetSearch.toLowerCase()));
  const selectedPlacedAsset = addedAssets.find((asset) => asset.id === selectedPlacedAssetId) ?? null;

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
    if (!operationalMode) return;
    const interval = window.setInterval(() => setLiveTick((current) => current + 1), 3000);
    return () => window.clearInterval(interval);
  }, [operationalMode]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDraftPoints([]);
        setTool("select");
        setAssetLibraryOpen(false);
        setViewerAsset(null);
        setReplaceAssetId(null);
        setMovingAssetId(null);
        setPlacementPreview(null);
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
    setSelectedPlacedAssetId(null);
    setPlacementPreview(null);
    setTool(nextTool);
    if (nextTool === "line") setToast("Click points on the map, then finish the utility line");
    if (nextTool === "area") setToast("Click three or more points to mark a planning zone");
    if (nextTool === "building") setToast("Click the map to place a proposed building");
    if (nextTool === "asset") { setReplaceAssetId(null); setAssetLibraryOpen(true); }
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
    if (asset.file) {
      const anchor = document.createElement("a");
      anchor.href = asset.file;
      anchor.download = `mirrorcity-${asset.id}.${asset.format?.toLowerCase() ?? "glb"}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setToast(`${asset.name}.${asset.format?.toLowerCase()} downloaded`);
      return;
    }
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
    if (replaceAssetId !== null) {
      setAddedAssets((current) => current.map((placed) => placed.id === replaceAssetId ? { ...placed, asset } : placed));
      setSelectedPlacedAssetId(replaceAssetId);
      setSelectedAsset(asset);
      setReplaceAssetId(null);
      setAssetLibraryOpen(false);
      setTool("select");
      setToast(`Asset replaced with ${asset.name}`);
      return;
    }
    setSelectedAsset(asset);
    setAssetLibraryOpen(false);
    setViewerAsset(null);
    setSelectedPlacedAssetId(null);
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
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)),
    };
    if (movingAssetId !== null) {
      setAddedAssets((current) => current.map((placed) => placed.id === movingAssetId ? { ...placed, ...point } : placed));
      return;
    }
    if (tool === "asset") setPlacementPreview(point);
    if (!dragging) return;
    setPan({
      x: dragOrigin.current.panX + event.clientX - dragOrigin.current.x,
      y: dragOrigin.current.panY + event.clientY - dragOrigin.current.y,
    });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (movingAssetId !== null) {
      setMovingAssetId(null);
      setToast("Asset position updated · Unsaved change");
      return;
    }
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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
    const id = Date.now();
    setAddedAssets((current) => [...current, { id, x: point.x, y: point.y, rotation: 0, scale: 1, asset: selectedAsset }]);
    setSelectedPlacedAssetId(id);
    setPlacementPreview(null);
    setTool("select");
    setToast(`${selectedAsset.name} placed · Unsaved change`);
  }

  function updatePlacedAsset(id: number, changes: Partial<Pick<PlacedAsset, "x" | "y" | "rotation" | "scale">>) {
    setAddedAssets((current) => current.map((asset) => asset.id === id ? { ...asset, ...changes } : asset));
  }

  function duplicatePlacedAsset(asset: PlacedAsset) {
    const duplicate = { ...asset, id: Date.now(), x: Math.min(96, asset.x + 4), y: Math.min(96, asset.y + 4) };
    setAddedAssets((current) => [...current, duplicate]);
    setSelectedPlacedAssetId(duplicate.id);
    setToast(`${asset.asset.name} duplicated`);
  }

  function deletePlacedAsset(id: number) {
    setAddedAssets((current) => current.filter((asset) => asset.id !== id));
    setSelectedPlacedAssetId(null);
    setToast("Asset removed from the district");
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
          <button className={`mode-switch ${operationalMode ? "live" : ""}`} onClick={() => { setOperationalMode((current) => !current); setToast(operationalMode ? "Twin paused in planning mode" : "Live operational feeds connected"); }}><span /> {operationalMode ? "LIVE TWIN" : "PLANNING MODE"}</button>
          <button className={`compare-button ${compareMode ? "active" : ""}`} onClick={() => { setCompareMode((current) => !current); setToast(compareMode ? "Showing current district" : "Comparing current and proposed design"); }}>◐ Compare</button>
          <button className="quiet-button" onClick={() => setToast("Snapshot saved to scenario history")}>Save snapshot</button>
          <button className="quiet-button asset-library-button" onClick={() => { setReplaceAssetId(null); setAssetLibraryOpen(true); }}>▦ Asset library</button>
          <button className="primary-button" onClick={() => fileRef.current?.click()}><Mark>＋</Mark> Import data</button>
          <input ref={fileRef} className="sr-only" type="file" accept=".las,.laz,.tif,.tiff,.obj,.ply,.glb,.gltf,.fbx,image/*" onChange={handleImport} />
          <button className="avatar" aria-label="Open account menu">NK</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="icon-rail" aria-label="Primary navigation">
          <button className="rail-button active" aria-label="City twin"><Mark>◇</Mark></button>
          <button className="rail-button" aria-label="Data catalogue"><Mark>▥</Mark></button>
          <button className="rail-button" aria-label="Assets" onClick={() => { setReplaceAssetId(null); setAssetLibraryOpen(true); }}><Mark>▦</Mark></button>
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
            <div><small>SOURCE DATA</small><strong>{importState}</strong><span>Ground / non-ground · 202,939 points</span></div>
            <span className="check-badge">✓</span>
          </section>

          <section className="iith-model-set">
            <div className="section-label"><span>IITH MODEL SET</span><button onClick={() => { setReplaceAssetId(null); setAssetCategory("IITH terrain"); setAssetLibraryOpen(true); }}>View all</button></div>
            {assetLibrary.filter((asset) => asset.category === "IITH terrain").map((asset) => <button className="iith-model-row" key={asset.id} onClick={() => setViewerAsset(asset)}>
              <span className="iith-model-thumb" style={{ backgroundImage: `url(${asset.preview})` }} />
              <span><strong>{asset.name.replace("IITH ", "")}</strong><small>{asset.stats?.[1].value} points · {asset.stats?.[3].value} tris</small></span>
              <em>{asset.stats?.[2].value}</em>
            </button>)}
          </section>

          <section className="side-section">
            <div className="section-label"><span>MAP LAYERS</span><button aria-label="Add map layer">＋</button></div>
            <div className="layer-list">
              {([
                ["buildings", "Buildings & terrain", "624 structures", "#dfe7df"],
                ["sewer", "Sewer network", "18.2 km", "#ffb936"],
                ["power", "Power grid", "46 assets", "#55d5c8"],
                ["mobility", "Mobility", "Live traffic", "#83a7ff"],
                ["sensors", "Live sensor feeds", "128 online", "#c9f36d"],
                ["construction", "Capital works", "7 active sites", "#ff7f63"],
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
              <button className={tool === "asset" ? "active" : ""} onClick={() => selectTool("asset")}><b>＋</b><span>3D asset</span></button>
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
            {tool === "asset" && <div className="chosen-asset"><i>{selectedAsset.code}</i><span><strong>{selectedAsset.name}</strong><small>{selectedAsset.category}</small></span><button onClick={() => { setReplaceAssetId(null); setAssetLibraryOpen(true); }}>Change</button></div>}
            {tool === "asset" && <div className="placement-instruction"><i>1</i><span><strong>Move over the district</strong><small>Click anywhere—including buildings—to place</small></span></div>}
            {(tool === "line" || tool === "area") && <div className="dock-actions"><span>{draftPoints.length} {draftPoints.length === 1 ? "point" : "points"}</span><button onClick={() => setDraftPoints((current) => current.slice(0, -1))} disabled={!draftPoints.length}>Undo point</button><button className="finish-button" onClick={finishDrawing}>Finish</button></div>}
          </div>}

          {selectedPlacedAsset && tool === "select" && <div className="asset-edit-dock">
            <div className="dock-heading"><span>EDIT PLACED ASSET</span><button onClick={() => setSelectedPlacedAssetId(null)}>×</button></div>
            <div className="edit-asset-heading"><i>{selectedPlacedAsset.asset.code}</i><span><strong>{selectedPlacedAsset.asset.name}</strong><small>Drag the asset directly to move it</small></span></div>
            <label className="transform-control"><span>ROTATION</span><input type="range" min="-180" max="180" step="5" value={selectedPlacedAsset.rotation} onChange={(event) => updatePlacedAsset(selectedPlacedAsset.id, { rotation: Number(event.target.value) })} /><strong>{selectedPlacedAsset.rotation}°</strong></label>
            <label className="transform-control"><span>SCALE</span><input type="range" min="0.5" max="2.5" step="0.1" value={selectedPlacedAsset.scale} onChange={(event) => updatePlacedAsset(selectedPlacedAsset.id, { scale: Number(event.target.value) })} /><strong>{selectedPlacedAsset.scale.toFixed(1)}×</strong></label>
            <div className="nudge-row"><span>NUDGE</span><button aria-label="Move left" onClick={() => updatePlacedAsset(selectedPlacedAsset.id, { x: Math.max(0, selectedPlacedAsset.x - 1) })}>←</button><button aria-label="Move up" onClick={() => updatePlacedAsset(selectedPlacedAsset.id, { y: Math.max(0, selectedPlacedAsset.y - 1) })}>↑</button><button aria-label="Move down" onClick={() => updatePlacedAsset(selectedPlacedAsset.id, { y: Math.min(100, selectedPlacedAsset.y + 1) })}>↓</button><button aria-label="Move right" onClick={() => updatePlacedAsset(selectedPlacedAsset.id, { x: Math.min(100, selectedPlacedAsset.x + 1) })}>→</button></div>
            <div className="edit-asset-actions"><button onClick={() => duplicatePlacedAsset(selectedPlacedAsset)}>⧉ Duplicate</button><button onClick={() => { setReplaceAssetId(selectedPlacedAsset.id); setAssetCategory("All"); setAssetLibraryOpen(true); }}>↺ Replace</button><button className="delete-action" onClick={() => deletePlacedAsset(selectedPlacedAsset.id)}>Delete</button></div>
          </div>}

          <div
            className={`map-stage tool-${tool} ${dragging ? "dragging" : ""}`}
            role="button"
            aria-label="Interactive district map"
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => { if (movingAssetId === null) setPlacementPreview(null); }}
            onClick={handleMapClick}
            onKeyDown={(event) => { if (event.key === "Escape") { setDraftPoints([]); setTool("select"); } }}
          >
            <div className="map-glow" />
            <div className="author-layer" aria-label="User-created map geometry">
              {drawnAreas.map((area) => <div key={area.id} className="drawn-area" style={{ clipPath: `polygon(${area.points.map((point) => `${point.x}% ${point.y}%`).join(",")})` }} />)}
              {tool === "area" && draftPoints.length >= 3 && <div className="drawn-area draft" style={{ clipPath: `polygon(${draftPoints.map((point) => `${point.x}% ${point.y}%`).join(",")})` }} />}
              {[...drawnLines, ...(tool === "line" && draftPoints.length > 1 ? [{ id: -1, kind: lineKind, points: draftPoints }] : [])].flatMap((line) => getSegments(line.points).map((segment, index) => <i key={`${line.id}-${index}`} className={`user-line kind-${line.kind} ${line.id === -1 ? "draft" : ""}`} style={{ left: `${segment.left}%`, top: `${segment.top}%`, width: `${segment.width}%`, transform: `rotate(${segment.angle}deg)` }} />))}
              {draftPoints.map((point, index) => <i key={`point-${index}`} className="draft-point" style={{ left: `${point.x}%`, top: `${point.y}%` }}>{index + 1}</i>)}
              {plannedBuildings.map((building) => <button key={building.id} className="planned-building" style={{ left: `${building.x}%`, top: `${building.y}%`, "--floors": building.floors } as React.CSSProperties} onClick={(event) => { if (["asset", "line", "area", "building"].includes(tool)) return; event.stopPropagation(); setToast(`Proposed ${building.floors}-floor building selected`); }}><i /><b>{building.floors}F</b></button>)}
              {placementPreview && tool === "asset" && <div className={`asset-placement-ghost tone-${selectedAsset.tone} ${selectedAsset.preview ? "is-terrain" : ""}`} style={{ left: `${placementPreview.x}%`, top: `${placementPreview.y}%`, backgroundImage: selectedAsset.preview ? `url(${selectedAsset.preview})` : undefined }}><i>{selectedAsset.code}</i><span>CLICK TO PLACE</span></div>}
              {addedAssets.map((asset) => <button
                key={asset.id}
                className={`placed-map-asset tone-${asset.asset.tone} ${asset.asset.preview ? "is-terrain" : ""} ${selectedPlacedAssetId === asset.id ? "selected" : ""} ${movingAssetId === asset.id ? "moving" : ""}`}
                style={{ left: `${asset.x}%`, top: `${asset.y}%`, transform: `translate(-50%,-50%) rotate(${asset.rotation}deg) scale(${asset.scale})`, backgroundImage: asset.asset.preview ? `url(${asset.asset.preview})` : undefined }}
                onPointerDown={(event) => { if (tool === "asset") return; event.stopPropagation(); setSelectedPlacedAssetId(asset.id); setMovingAssetId(asset.id); setTool("select"); }}
                onClick={(event) => { if (tool === "asset") return; event.stopPropagation(); setSelectedPlacedAssetId(asset.id); setTool("select"); setToast(`${asset.asset.name} selected · drag to move`); }}
                onKeyDown={(event) => {
                  const delta = event.shiftKey ? 5 : 1;
                  if (event.key === "ArrowLeft") updatePlacedAsset(asset.id, { x: Math.max(0, asset.x - delta) });
                  if (event.key === "ArrowRight") updatePlacedAsset(asset.id, { x: Math.min(100, asset.x + delta) });
                  if (event.key === "ArrowUp") updatePlacedAsset(asset.id, { y: Math.max(0, asset.y - delta) });
                  if (event.key === "ArrowDown") updatePlacedAsset(asset.id, { y: Math.min(100, asset.y + delta) });
                  if (event.key === "Delete" || event.key === "Backspace") deletePlacedAsset(asset.id);
                }}
                aria-label={`${asset.asset.name}. Drag to move, arrow keys to nudge.`}
              ><i>{asset.asset.code}</i><span>{asset.asset.name}</span></button>)}
            </div>
            {operationalMode && <div className="operations-layer" aria-label="Live district operations">
              {layers.mobility && <div className="live-fleet"><i className="vehicle v1">B12</i><i className="vehicle v2">A03</i><i className="vehicle v3">T41</i><i className="vehicle v4">E07</i></div>}
              {layers.sensors && <div className="sensor-feed"><button className="sensor s1" onClick={(event) => { event.stopPropagation(); setInspectorTab("operations"); setToast("Flow sensor SW-18 · 42.6 L/s"); }}>42.6</button><button className="sensor s2" onClick={(event) => { event.stopPropagation(); setInspectorTab("operations"); setToast("Air quality station AQ-04 · Good"); }}>AQ</button><button className="sensor s3" onClick={(event) => { event.stopPropagation(); setInspectorTab("operations"); setToast("Grid monitor E-14 · 71% load"); }}>71%</button></div>}
              {layers.construction && <div className="construction-feed"><button className="worksite w1" onClick={(event) => { event.stopPropagation(); setInspectorTab("operations"); setToast("River interceptor upgrade · 64% complete"); }}><i />64%<span>INTERCEPTOR</span></button><button className="worksite w2" onClick={(event) => { event.stopPropagation(); setInspectorTab("operations"); setToast("Emergency hub extension · 38% complete"); }}><i />38%<span>RESPONSE HUB</span></button></div>}
              {incidentActive && <button className="incident-marker" onClick={(event) => { event.stopPropagation(); setInspectorTab("operations"); }}>!<span>ROAD INCIDENT · 2 UNITS RESPONDING</span></button>}
              <span className="live-tick">FEED #{String(liveTick + 1842).padStart(6, "0")}</span>
            </div>}
            {compareMode && <div className="compare-overlay"><span className="compare-label current">CURRENT</span><span className="compare-label proposed">PROPOSED 2035</span><i className="compare-divider" /><div className="proposed-corridor"><i /><i /><i /></div></div>}
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
                    onClick={(event) => { if (["asset", "line", "area", "building"].includes(tool)) return; event.stopPropagation(); setSelectedId(building.id); setTool("select"); }}
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
          <div className="inspector-tabs triple"><button className={inspectorTab === "simulation" ? "active" : ""} onClick={() => setInspectorTab("simulation")}>SIMULATE</button><button className={inspectorTab === "operations" ? "active" : ""} onClick={() => setInspectorTab("operations")}>OPERATE</button><button className={inspectorTab === "object" ? "active" : ""} onClick={() => setInspectorTab("object")}>OBJECT</button></div>
          <div className="inspector-scroll">
            {inspectorTab === "simulation" && <>
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
            </>}

            {inspectorTab === "operations" && <>
              <section className="simulation-title operations-title">
                <span>LIVE DISTRICT OPERATIONS</span><h2>Common operating picture</h2><p>One spatial view of infrastructure, movement, construction and active response.</p>
              </section>
              <section className="ops-health"><div><i /><span><small>SYSTEM STATUS</small><strong>{incidentActive ? "Response active" : "District nominal"}</strong></span></div><em>{operationalMode ? "LIVE" : "PAUSED"}</em></section>
              <section className="ops-kpis"><div><small>ASSETS ONLINE</small><strong>97.8%</strong><span>125 / 128</span></div><div><small>ROAD FLOW</small><strong>{incidentActive ? "61" : "84"}%</strong><span>{incidentActive ? "−23%" : "+4%"}</span></div><div><small>GRID DEMAND</small><strong>71%</strong><span>6.2 MW</span></div><div><small>EMISSIONS</small><strong>−12%</strong><span>vs baseline</span></div></section>
              <section className="event-stream"><div className="section-label"><span>OPERATIONAL FEED</span><button onClick={() => setToast("Feed filters opened")}>Filter</button></div>
                {incidentActive && <article className="urgent"><i>!</i><div><strong>Market Road collision</strong><span>Ambulance A03 and patrol E07 dispatched</span><small>NOW · RESPONSE</small></div></article>}
                <article><i>↗</i><div><strong>Interceptor flow rising</strong><span>SW-18 reached 42.6 L/s after rainfall</span><small>2 MIN · WATER</small></div></article>
                <article><i>✓</i><div><strong>Substation inspection complete</strong><span>E-14 cleared for peak demand window</span><small>11 MIN · ENERGY</small></div></article>
                <article><i>▥</i><div><strong>Construction model updated</strong><span>River interceptor package now 64% complete</span><small>24 MIN · CAPITAL WORKS</small></div></article>
              </section>
              <section className="construction-progress"><div className="section-label"><span>CAPITAL WORKS</span><strong>2 / 7 SHOWN</strong></div><div><span><b>River interceptor upgrade</b><small>64% · On schedule</small></span><i><b style={{ width: "64%" }} /></i></div><div><span><b>Emergency hub extension</b><small>38% · 4 days ahead</small></span><i><b style={{ width: "38%" }} /></i></div></section>
              <button className={`incident-button ${incidentActive ? "resolve" : ""}`} onClick={() => { setIncidentActive((current) => !current); setToast(incidentActive ? "Incident resolved · normal routing restored" : "Incident injected · response routes recalculated"); }}>{incidentActive ? "✓ RESOLVE INCIDENT" : "+ SIMULATE LIVE INCIDENT"}</button>
            </>}

            {inspectorTab === "object" && <section className="selected-object object-tab">
              <div className="section-label"><span>SELECTED ASSET</span><button aria-label="Close selection" onClick={() => setSelectedId(0)}>×</button></div>
              <div className="asset-preview"><span className={`mini-building tone-${selected.tone}`} /><i>3D</i></div>
              <h3>{selected.name}</h3><p>{selected.type} · Asset MC-{String(selected.id).padStart(4, "0")}</p>
              <div className="asset-facts"><span><small>CONDITION</small><strong className="good">● Operational</strong></span><span><small>LAST INSPECTION</small><strong>12 Aug 2026</strong></span><span><small>LIVE LOAD</small><strong>71%</strong></span><span><small>SOURCE</small><strong>LiDAR + BIM</strong></span></div>
              <div className="asset-actions"><button onClick={() => setToast(`${selected.name} moved to edit mode`)}>Move</button><button onClick={() => setToast(`Replacement option opened for ${selected.name}`)}>Replace</button><button onClick={() => setToast("Asset details panel expanded")}>Details</button></div>
              <div className="section-label change-heading"><span>CHANGE HISTORY</span><button onClick={() => setCompareMode(true)}>Compare</button></div>
              <div className="change-log"><article><i>26</i><span><strong>Model geometry refreshed</strong><small>Aug 2026 · Drone survey</small></span></article><article><i>12</i><span><strong>Inspection record linked</strong><small>Aug 2026 · Field team</small></span></article><article><i>04</i><span><strong>Design alternative added</strong><small>Aug 2026 · Capital works</small></span></article></div>
            </section>}
          </div>
        </aside>
      </section>

      {assetLibraryOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) { setAssetLibraryOpen(false); setReplaceAssetId(null); } }}>
        <section className="asset-library" role="dialog" aria-modal="true" aria-labelledby="asset-library-title">
          <header className="library-header">
            <div><span>{replaceAssetId !== null ? "REPLACE SELECTED ASSET" : "3D CONTENT CATALOGUE"}</span><h2 id="asset-library-title">Civic asset library</h2><p>{replaceAssetId !== null ? "Choose a model below to swap it into the same position." : "Place optimized planning assets in the twin or download a model for your own 3D pipeline."}</p></div>
            <button aria-label="Close asset library" onClick={() => { setAssetLibraryOpen(false); setReplaceAssetId(null); }}>×</button>
          </header>
          <div className="library-controls">
            <label><span>⌕</span><input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Search pumps, power, shelters…" /></label>
            <div>{assetCategories.map((category) => <button key={category} className={assetCategory === category ? "active" : ""} onClick={() => setAssetCategory(category)}>{category}</button>)}</div>
          </div>
          <div className="asset-catalogue">
            {filteredAssets.map((asset) => <article className="catalogue-card" key={asset.id}>
              <div className={`catalogue-preview tone-${asset.tone} ${asset.preview ? "lidar-preview" : ""}`} style={asset.preview ? { backgroundImage: `url(${asset.preview})` } : undefined}>{!asset.preview && <span className={`asset-model model-${asset.id}`}><i /><b /></span>}<em>{asset.preview ? "OPEN3D" : "LOW POLY"}</em></div>
              <div className="catalogue-copy"><span>{asset.category}</span><h3>{asset.name}</h3><p>{asset.description}</p><small>{asset.format ?? "OBJ"} · Metric scale · {asset.size}</small></div>
              <div className={`catalogue-actions ${asset.file ? "has-view" : ""}`}>{asset.file && <button className="view-button" onClick={() => { setReplaceAssetId(null); setViewerAsset(asset); setAssetLibraryOpen(false); }}>◉ View 3D</button>}<button className="place-button" onClick={() => beginAssetPlacement(asset)}>{replaceAssetId !== null ? "↺ Use this model" : "＋ Place in twin"}</button><button className="download-button" onClick={() => downloadAsset(asset)}>↓ Download {asset.format ?? "OBJ"}</button></div>
            </article>)}
            {!filteredAssets.length && <div className="empty-assets"><strong>No assets found</strong><span>Try a different search or category.</span></div>}
          </div>
          <footer className="library-footer"><span><i /> {assetLibrary.length} verified planning assets</span><p>Includes three Open3D terrain reconstructions generated from the supplied IITH dataset.</p></footer>
        </section>
      </div>}

      {viewerAsset?.file && <div className="model-viewer-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setViewerAsset(null); }}>
        <section className="model-viewer-dialog" role="dialog" aria-modal="true" aria-labelledby="model-viewer-title">
          <header className="model-viewer-header">
            <div><span>IITH TERRAIN MODEL · {viewerAsset.code}</span><h2 id="model-viewer-title">{viewerAsset.name}</h2><p>{viewerAsset.description}</p></div>
            <button aria-label="Close 3D model viewer" onClick={() => setViewerAsset(null)}>×</button>
          </header>
          <div className="model-viewer-body">
            <ModelViewer src={viewerAsset.file} />
            <aside className="model-metadata">
              <div><span>RECONSTRUCTION DETAILS</span><h3>Survey-derived surface</h3><p>Generated from the supplied labelled IITH point cloud with Open3D. Ground returns are filtered, triangulated and exported as a browser-ready GLB.</p></div>
              <div className="model-stat-grid">{viewerAsset.stats?.map((stat) => <span key={stat.label}><small>{stat.label}</small><strong>{stat.value}</strong></span>)}</div>
              <div className="model-source"><i>✓</i><span><small>VERIFIED LOCAL SOURCE</small><strong>IITH labelled ground dataset</strong><em>Metric geometry · {viewerAsset.size} GLB</em></span></div>
              <div className="model-viewer-actions"><button onClick={() => beginAssetPlacement(viewerAsset)}>＋ Place in district</button><button onClick={() => downloadAsset(viewerAsset)}>↓ Download GLB</button></div>
            </aside>
          </div>
        </section>
      </div>}

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
