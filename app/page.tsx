"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import CityEngine from "./CityEngine";
import { CityEngineErrorBoundary } from "./CityEngineErrorBoundary";
import ModelViewer from "./ModelViewer";

type ScenarioKey = "sewer" | "flood" | "evacuation";
type ViewKey = "twin" | "scenarios" | "infrastructure" | "assets" | "data" | "operations" | "settings" | "help";
type LayerKey = "buildings" | "sewer" | "power" | "mobility" | "sensors" | "construction";
type ToolKey = "select" | "orbit" | "measure" | "line" | "area" | "building" | "asset";
type LineKind = "sewer" | "power" | "water" | "road";
type MapPoint = { x: number; y: number };
type DrawnLine = { id: number; kind: LineKind; points: MapPoint[] };
type DrawnArea = { id: number; points: MapPoint[] };
type PlannedBuilding = { id: number; x: number; y: number; floors: number };
type AssetDefinition = { id: string; name: string; category: string; code: string; description: string; size: string; tone: string; file?: string; format?: "OBJ" | "GLB"; preview?: string; stats?: Array<{ label: string; value: string }> };
type PlacedAsset = { id: number; x: number; y: number; rotation: number; scale: number; asset: AssetDefinition };
type DataTab = "catalogue" | "quality" | "standards";
type DatasetRecord = {
  id: string;
  name: string;
  family: "LiDAR" | "Terrain" | "Telemetry";
  status: "Published" | "Source" | "Prototype";
  format: string;
  headline: string;
  description: string;
  quality: number;
  updated: string;
  source: string;
  file?: string;
  preview?: string;
  stats: Array<{ label: string; value: string }>;
  checks: Array<{ label: string; state: "pass" | "warn" | "missing"; detail: string }>;
};

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
  sewer: { label: "Sewer capacity", kicker: "FLOW SIMULATION", accent: "#4f6fff" },
  flood: { label: "Monsoon flood", kicker: "HAZARD MODEL", accent: "#00cfff" },
  evacuation: { label: "Rapid evacuation", kicker: "MOBILITY MODEL", accent: "#75a7ff" },
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
  { id: "sewer", label: "Sewer", color: "#4f6fff" },
  { id: "power", label: "Power", color: "#00dfff" },
  { id: "water", label: "Water", color: "#168cff" },
  { id: "road", label: "Road", color: "#b8cbff" },
];

const datasetInventory: DatasetRecord[] = [
  {
    id: "semantic-corridor", name: "Registered semantic corridor", family: "LiDAR", status: "Source", format: "PLY", headline: "1,231,246 points", description: "Ten registered SemanticKITTI-compatible Velodyne frames combined into the master classified corridor cloud.", quality: 82, updated: "Static survey", source: "project-example.zip · Open3D 0.19.0", stats: [{ label: "FRAMES", value: "10" }, { label: "POINTS", value: "1,231,246" }, { label: "REGISTRATION", value: "Combined" }, { label: "CRS", value: "Unspecified" }], checks: [{ label: "Geometry", state: "pass", detail: "Registered source cloud available" }, { label: "Semantics", state: "pass", detail: "SemanticKITTI-compatible labels" }, { label: "Coordinate reference", state: "missing", detail: "CRS is not recorded in the manifest" }, { label: "Source terms", state: "warn", detail: "Redistribution terms require confirmation" }],
  },
  {
    id: "road-terrain", name: "Road and terrain surface", family: "LiDAR", status: "Published", format: "GLB · OBJ · PLY", headline: "21,374 triangles", description: "Triangulated road, parking, sidewalk, lane-marking and terrain surface reconstructed from 36,143 source points.", quality: 91, updated: "Open3D pipeline", source: "project-example.zip · road-terrain", file: "/models/lidar/road-terrain.glb", preview: "/models/lidar/road-terrain.png", stats: [{ label: "SOURCE POINTS", value: "36,143" }, { label: "VERTICES", value: "10,951" }, { label: "TRIANGLES", value: "21,374" }, { label: "WEB MODEL", value: "GLB ready" }], checks: [{ label: "Geometry", state: "pass", detail: "Watertightness not asserted" }, { label: "Web delivery", state: "pass", detail: "GLB, OBJ and mesh PLY exported" }, { label: "Coordinate reference", state: "missing", detail: "CRS is not recorded in the manifest" }, { label: "Provenance", state: "pass", detail: "Source bundle and toolkit recorded" }],
  },
  {
    id: "building-masses", name: "Building mass extraction", family: "LiDAR", status: "Published", format: "GLB · OBJ · PLY", headline: "9 objects", description: "Nine clustered building and structure volumes extracted from 8,901 classified source points.", quality: 88, updated: "Open3D pipeline", source: "project-example.zip · building-masses", file: "/models/lidar/building-masses.glb", preview: "/models/lidar/building-masses.png", stats: [{ label: "SOURCE POINTS", value: "8,901" }, { label: "OBJECTS", value: "9" }, { label: "VERTICES", value: "72" }, { label: "TRIANGLES", value: "108" }], checks: [{ label: "Geometry", state: "pass", detail: "Nine simplified massing objects" }, { label: "Object identity", state: "warn", detail: "Stable semantic feature IDs not yet assigned" }, { label: "Coordinate reference", state: "missing", detail: "CRS is not recorded in the manifest" }, { label: "Web delivery", state: "pass", detail: "GLB and editable formats available" }],
  },
  {
    id: "street-assets", name: "Street asset extraction", family: "LiDAR", status: "Published", format: "GLB · OBJ · PLY", headline: "40 objects", description: "Vehicles, trunks, poles and traffic assets reconstructed from 49,893 source points.", quality: 86, updated: "Open3D pipeline", source: "project-example.zip · street-assets", file: "/models/lidar/street-assets.glb", preview: "/models/lidar/street-assets.png", stats: [{ label: "SOURCE POINTS", value: "49,893" }, { label: "OBJECTS", value: "40" }, { label: "VERTICES", value: "1,684" }, { label: "TRIANGLES", value: "3,208" }], checks: [{ label: "Geometry", state: "pass", detail: "Forty extracted planning objects" }, { label: "Classification", state: "warn", detail: "Classes are grouped, not object-level verified" }, { label: "Coordinate reference", state: "missing", detail: "CRS is not recorded in the manifest" }, { label: "Web delivery", state: "pass", detail: "GLB and source PLY available" }],
  },
  ...([[
    "iith-low-slope", "IITH low-slope terrain", "0.54°", "6,953", "5,308", "9,364", "/models/iith/iith-low-slope.glb", "/models/iith/iith-low-slope.png",
  ], [
    "iith-medium-slope", "IITH medium-slope terrain", "3.02°", "6,932", "5,309", "9,413", "/models/iith/iith-medium-slope.glb", "/models/iith/iith-medium-slope.png",
  ], [
    "iith-high-slope", "IITH high-slope terrain", "6.59°", "6,904", "5,318", "9,513", "/models/iith/iith-high-slope.glb", "/models/iith/iith-high-slope.png",
  ]] as Array<[string, string, string, string, string, string, string, string]>).map(([id, name, grade, triangles, vertices, sourcePoints, file, preview]) => ({
    id, name, family: "Terrain" as const, status: "Published" as const, format: "GLB · OBJ · PLY", headline: `${grade} fitted grade`, description: "Label-derived terrain surface with ground and non-ground context preserved as separate source products.", quality: 90, updated: "Open3D pipeline", source: "IITH_LiDAR_ground_dataset_labelled_raw.zip · Open3D 0.19.0", file, preview, stats: [{ label: "LABELLED POINTS", value: "18,449" }, { label: "GROUND / OTHER", value: "17,732 / 717" }, { label: "VERTICES", value: vertices }, { label: "TRIANGLES", value: triangles }, { label: "SOURCE POINTS", value: sourcePoints }, { label: "FITTED GRADE", value: grade }], checks: [{ label: "Geometry", state: "pass" as const, detail: `${triangles} browser-ready triangles` }, { label: "Classification", state: "pass" as const, detail: "Ground and non-ground counts recorded" }, { label: "Coordinate reference", state: "missing" as const, detail: "CRS is not recorded in the manifest" }, { label: "Source terms", state: "warn" as const, detail: "Original dataset terms require confirmation" }],
  })),
  {
    id: "district-telemetry", name: "District telemetry adapter", family: "Telemetry", status: "Prototype", format: "JSON API", headline: "4 observed metrics", description: "Room-scale sensor ingestion for temperature, humidity, occupancy and CO₂ with latest-value and 168-hour history endpoints.", quality: 74, updated: "Realtime-capable", source: "/api/ingest · D1 sensor_readings", stats: [{ label: "METRICS", value: "4" }, { label: "HISTORY", value: "168 h" }, { label: "MAX SAMPLES", value: "200" }, { label: "MODEL", value: "Room-scale" }], checks: [{ label: "Ingestion", state: "pass", detail: "Device auto-registration and reading insert" }, { label: "History", state: "pass", detail: "Metric and time-window queries available" }, { label: "District linkage", state: "warn", detail: "Sensors are linked to rooms, not city features" }, { label: "Interoperability", state: "missing", detail: "No SensorThings entity mapping yet" }],
  },
];

function buildObjAsset(asset: AssetDefinition) {
  const height = asset.id === "tower" ? 4 : asset.id === "barrier" ? .8 : asset.id === "manhole" ? .35 : 1.8;
  const width = asset.id === "barrier" ? 3 : asset.id === "shelter" || asset.id === "hospital" ? 2.8 : 1.6;
  const depth = asset.id === "barrier" ? .45 : asset.id === "shelter" || asset.id === "hospital" ? 2.2 : 1.3;
  return `# MirrorCity civic asset\n# ${asset.name}\no ${asset.id}\nv ${-width / 2} 0 ${-depth / 2}\nv ${width / 2} 0 ${-depth / 2}\nv ${width / 2} 0 ${depth / 2}\nv ${-width / 2} 0 ${depth / 2}\nv ${-width / 2} ${height} ${-depth / 2}\nv ${width / 2} ${height} ${-depth / 2}\nv ${width / 2} ${height} ${depth / 2}\nv ${-width / 2} ${height} ${depth / 2}\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 2 6 7 3\nf 3 7 8 4\nf 5 1 4 8\n`;
}

type IconName = "twin" | "scenario" | "layers" | "assets" | "data" | "activity" | "settings" | "help" | "search" | "bell" | "plus" | "compare" | "import" | "play" | "orbit" | "measure" | "building";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    twin: <><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M8 15V9l4-2 4 2v6l-4 2-4-2Z"/><path d="m8 9 4 2 4-2M12 11v6"/></>,
    scenario: <><circle cx="12" cy="12" r="8.5"/><path d="M10 8.5 15.5 12 10 15.5v-7Z"/></>,
    layers: <><path d="m12 3.5 8.5 4.3L12 12 3.5 7.8 12 3.5Z"/><path d="m4.5 12 7.5 3.8 7.5-3.8M4.5 16.2 12 20l7.5-3.8"/></>,
    assets: <><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z"/><path d="m4 8.5 8 4.5 8-4.5M12 13v7"/></>,
    data: <><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    activity: <><path d="M4 19V9M9.3 19V5M14.7 19v-7M20 19V3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.5 2.5 0 1 1 3.2 2.4c-.7.3-.9.8-.9 1.6M12 17h.01"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7M10 20h4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    compare: <><path d="M8 4H4v4M16 20h4v-4M4 8c1.7-3 4.3-4.5 8-4.5 3 0 5.3 1 7 3M20 16c-1.7 3-4.3 4.5-8 4.5-3 0-5.3-1-7-3"/></>,
    import: <><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 14v6h14v-6"/></>,
    play: <path d="m9 7 8 5-8 5V7Z"/>,
    orbit: <><circle cx="12" cy="12" r="3"/><path d="M4 12a8 3.5 0 0 0 16 0 8 3.5 0 0 0-16 0Z"/></>,
    measure: <><path d="M4 17 17 4l3 3L7 20l-3-3Z"/><path d="m8 13 3 3M11 10l3 3M14 7l3 3"/></>,
    building: <><path d="M5 21V5l9-2v18M14 9h5v12M8 8h2M8 12h2M8 16h2M17 13v2M17 18v3M3 21h18"/></>,
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

// ─── DB row mappers ───────────────────────────────────────────────────────────

function mapDbAsset(row: { id: number; assetId: string; x: number; y: number; rotation: number; scale: number }): PlacedAsset {
  const def = assetLibrary.find((a) => a.id === row.assetId) ?? assetLibrary[3]; // fallback to generator
  return { id: row.id, x: row.x, y: row.y, rotation: row.rotation, scale: row.scale, asset: def };
}

function mapDbLine(row: { id: number; kind: string; points: string }): DrawnLine {
  return { id: row.id, kind: row.kind as LineKind, points: JSON.parse(row.points) };
}

function mapDbArea(row: { id: number; points: string }): DrawnArea {
  return { id: row.id, points: JSON.parse(row.points) };
}

// ─── Simulation functions ─────────────────────────────────────────────────────

function sewerLoad(population: number) {
  const dailyLitres = population * 135;          // Explicit prototype assumption; not a calibrated engineering input.
  const peakFactor = population < 2000 ? 3.2 : population < 2500 ? 3.0 : 2.8;
  const peakLps = (dailyLitres * peakFactor) / 86400;
  const capacity = 60;                           // system capacity: 60 L/s
  const load = Math.min(100, Math.round((peakLps / capacity) * 100));
  const riskNodes = load >= 90 ? 3 : load >= 80 ? 1 : 0;
  const status = load >= 90 ? "Capacity risk" : load >= 80 ? "Watch closely" : "Within capacity";
  return { load, peakFlow: Math.round(peakLps * 10) / 10, riskNodes, status };
}

function floodMetrics(population: number) {
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

function evacuationMetrics(population: number) {
  const clearance = Math.round(24 + (population - 1500) * 0.009);
  const routed = Math.round(population * 0.97);
  const bottlenecks = population >= 2500 ? 4 : population >= 2000 ? 2 : 1;
  return [
    { value: `${clearance} min`, label: "Clearance time", trend: clearance <= 31 ? `−${31 - clearance} min` : `+${clearance - 31} min` },
    { value: routed.toLocaleString(), label: "People routed", trend: "97%" },
    { value: String(bottlenecks), label: "Bottlenecks", trend: bottlenecks > 2 ? "Action needed" : "Review" },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [activeView, setActiveView] = useState<ViewKey>("twin");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [districtName, setDistrictName] = useState("Varuna River Ward");
  const [loading, setLoading] = useState(true);
  const [activeScenario, setActiveScenario] = useState<ScenarioKey>("sewer");
  const [population, setPopulation] = useState(2000);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ buildings: true, sewer: true, power: true, mobility: false, sensors: true, construction: true });
  const [, setInspectorTab] = useState<"simulation" | "operations" | "object">("simulation");
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
  const zoom = 1.18;
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
  const [dataTab, setDataTab] = useState<DataTab>("catalogue");
  const [dataQuery, setDataQuery] = useState("");
  const [dataFamily, setDataFamily] = useState<"All" | DatasetRecord["family"]>("All");
  const [selectedDatasetId, setSelectedDatasetId] = useState(datasetInventory[0].id);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = buildings.find((building) => building.id === selectedId) ?? buildings[6];
  const sewer = sewerLoad(population);
  const scenario = scenarios[activeScenario];
  const assetCategories = ["All", ...Array.from(new Set(assetLibrary.map((asset) => asset.category)))];
  const filteredAssets = assetLibrary.filter((asset) => (assetCategory === "All" || asset.category === assetCategory) && `${asset.name} ${asset.category} ${asset.description}`.toLowerCase().includes(assetSearch.toLowerCase()));
  const selectedPlacedAsset = addedAssets.find((asset) => asset.id === selectedPlacedAssetId) ?? null;
  const filteredDatasets = datasetInventory.filter((dataset) => (dataFamily === "All" || dataset.family === dataFamily) && `${dataset.name} ${dataset.family} ${dataset.format} ${dataset.description}`.toLowerCase().includes(dataQuery.toLowerCase()));
  const selectedDataset = datasetInventory.find((dataset) => dataset.id === selectedDatasetId) ?? datasetInventory[0];
  const annotations = useMemo(() => {
    if (!operationalMode) return [];
    return [
      ...(layers.sensors ? [
        { id: "sw-18", point: { x: 39, y: 61 }, height: 3.1, kind: "sensor" as const, label: "FLOW · SW-18", value: "42.6 L/s", detail: "Updated now" },
        { id: "aq-04", point: { x: 22, y: 22 }, height: 2.8, kind: "sensor" as const, label: "AIR · AQ-04", value: "GOOD", detail: "PM₂.₅ · 12 μg/m³" },
        { id: "e-14", point: { x: 66, y: 45 }, height: 3.2, kind: "sensor" as const, label: "GRID · E-14", value: "71%", detail: "Nominal load" },
      ] : []),
      ...(layers.construction ? [
        { id: "interceptor", point: { x: 48, y: 77 }, height: 2.1, kind: "worksite" as const, label: "INTERCEPTOR", value: "64%", detail: "Capital work" },
        { id: "response-hub", point: { x: 79, y: 24 }, height: 2.1, kind: "worksite" as const, label: "RESPONSE HUB", value: "38%", detail: "Capital work" },
      ] : []),
      ...(incidentActive ? [{ id: "road-incident", point: { x: 56, y: 42 }, height: 1.5, kind: "incident" as const, label: "ACTIVE EVENT", value: "ROAD INCIDENT", detail: "2 teams dispatched" }] : []),
    ];
  }, [incidentActive, layers.construction, layers.sensors, operationalMode]);
  const activeViewLabel: Record<ViewKey, string> = {
    twin: "District twin",
    scenarios: "Scenarios",
    infrastructure: "Infrastructure",
    assets: "Asset library",
    data: "Source data",
    operations: "Operations",
    settings: "Settings",
    help: "Help center",
  };

  const metricSet = useMemo(() => {
    if (activeScenario === "flood") return floodMetrics(population);
    if (activeScenario === "evacuation") return evacuationMetrics(population);
    return [
      { value: `${sewer.load}%`, label: "Network load", trend: `+${Math.max(0, sewer.load - 68)}%` },
      { value: `${sewer.peakFlow} L/s`, label: "Peak outflow", trend: `+${Math.max(0, sewer.peakFlow - 35.2).toFixed(1)} L/s` },
      { value: String(sewer.riskNodes), label: "Risk nodes", trend: sewer.riskNodes >= 3 ? "Action needed" : sewer.riskNodes === 1 ? "Monitored" : "All clear" },
    ];
  }, [activeScenario, population, sewer.load, sewer.peakFlow, sewer.riskNodes]);

  // Load session + canvas data on mount
  useEffect(() => {
    fetch("/api/session")
      .then((res) => res.json())
      .then((data: { session?: { id: number; districtName: string; population: number; activeScenario: string; layers: string } }) => {
        if (!data.session) { setLoading(false); return; }
        const s = data.session;
        setSessionId(s.id);
        setDistrictName(s.districtName);
        setPopulation(s.population);
        if (s.activeScenario && Object.keys(scenarios).includes(s.activeScenario)) {
          setActiveScenario(s.activeScenario as ScenarioKey);
        }
        try {
          const parsedLayers = JSON.parse(s.layers);
          if (parsedLayers && typeof parsedLayers === "object") {
            setLayers((current) => ({ ...current, ...parsedLayers }));
          }
        } catch { /* keep defaults */ }
        return Promise.all([
          fetch(`/api/assets?sessionId=${s.id}`).then((r) => r.json()),
          fetch(`/api/lines?sessionId=${s.id}`).then((r) => r.json()),
          fetch(`/api/areas?sessionId=${s.id}`).then((r) => r.json()),
          fetch(`/api/buildings?sessionId=${s.id}`).then((r) => r.json()),
        ]);
      })
      .then((results) => {
        if (!results) return;
        const [assets, lines, areas, buildings] = results as [unknown[], unknown[], unknown[], unknown[]];
        if (Array.isArray(assets)) setAddedAssets(assets.map(mapDbAsset as (r: unknown) => PlacedAsset));
        if (Array.isArray(lines)) setDrawnLines(lines.map(mapDbLine as (r: unknown) => DrawnLine));
        if (Array.isArray(areas)) setDrawnAreas(areas.map(mapDbArea as (r: unknown) => DrawnArea));
        if (Array.isArray(buildings)) {
          setPlannedBuildings(buildings.map((r) => {
            const row = r as { id: number; x: number; y: number; floors: number };
            return { id: row.id, x: row.x, y: row.y, floors: row.floors };
          }));
        }
      })
      .catch(() => { /* DB not available in local dev without wrangler — fail silently */ })
      .finally(() => setLoading(false));
  }, []);

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
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function toggleLayer(key: LayerKey) {
    setLayers((current) => {
      const next = { ...current, [key]: !current[key] };
      if (sessionId) {
        fetch("/api/session", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layers: JSON.stringify(next) }),
        }).catch(() => {});
      }
      return next;
    });
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

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportState(`Registering · ${file.name}`);
    setToast("Registering file with the district model…");
    if (!sessionId) {
      window.setTimeout(() => {
        setImportState(`${file.name} · Ready`);
        setToast("New scan registered to the district model");
      }, 1700);
      return;
    }
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("sessionId", String(sessionId));
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const data = await res.json() as { id?: number; error?: string };
      if (data.id) {
        setImportState(`${file.name} · Ready`);
        setToast("New scan registered to the district model");
      } else {
        setImportState("Import failed");
        setToast(data.error ?? "Import failed");
      }
    } catch {
      setImportState(`${file.name} · Ready`);
      setToast("New scan registered (offline mode)");
    }
  }

  function selectTool(nextTool: ToolKey) {
    setDraftPoints([]);
    setSelectedPlacedAssetId(null);
    setTool(nextTool);
    if (nextTool === "line") setToast("Click points on the map, then finish the utility line");
    if (nextTool === "area") setToast("Click three or more points to mark a planning zone");
    if (nextTool === "building") setToast("Click the map to place a proposed building");
    if (nextTool === "asset") { setReplaceAssetId(null); setAssetLibraryOpen(true); }
  }

  function finishDrawing() {
    if (tool === "line" && draftPoints.length >= 2) {
      const tempId = Date.now();
      setDrawnLines((current) => [...current, { id: tempId, kind: lineKind, points: draftPoints }]);
      setToast(`${lineKinds.find((kind) => kind.id === lineKind)?.label} line created · ${draftPoints.length} nodes`);
      if (sessionId) {
        fetch("/api/lines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, kind: lineKind, points: JSON.stringify(draftPoints) }),
        })
          .then((res) => res.json())
          .then((row: { id?: number }) => {
            if (row.id) {
              setDrawnLines((current) =>
                current.map((line) => line.id === tempId ? { ...line, id: row.id! } : line)
              );
            }
          })
          .catch(() => {});
      }
    } else if (tool === "area" && draftPoints.length >= 3) {
      const tempId = Date.now();
      setDrawnAreas((current) => [...current, { id: tempId, points: draftPoints }]);
      setToast(`Planning zone created · ${draftPoints.length} vertices`);
      if (sessionId) {
        fetch("/api/areas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, points: JSON.stringify(draftPoints) }),
        })
          .then((res) => res.json())
          .then((row: { id?: number }) => {
            if (row.id) {
              setDrawnAreas((current) =>
                current.map((area) => area.id === tempId ? { ...area, id: row.id! } : area)
              );
            }
          })
          .catch(() => {});
      }
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
      const last = plannedBuildings[plannedBuildings.length - 1];
      setPlannedBuildings((current) => current.slice(0, -1));
      setToast("Last building removed");
      if (sessionId) fetch(`/api/buildings?id=${last.id}`, { method: "DELETE" }).catch(() => {});
      return;
    }
    if (addedAssets.length) {
      const last = addedAssets[addedAssets.length - 1];
      setAddedAssets((current) => current.slice(0, -1));
      setToast("Last asset removed");
      if (sessionId) fetch(`/api/assets?id=${last.id}`, { method: "DELETE" }).catch(() => {});
      return;
    }
    if (drawnLines.length) {
      const last = drawnLines[drawnLines.length - 1];
      setDrawnLines((current) => current.slice(0, -1));
      setToast("Last line removed");
      if (sessionId) fetch(`/api/lines?id=${last.id}`, { method: "DELETE" }).catch(() => {});
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

  function handleMapPoint(point: MapPoint) {
    if (!["asset", "line", "area", "building"].includes(tool)) return;
    if (tool === "line" || tool === "area") {
      setDraftPoints((current) => [...current, point]);
      return;
    }
    if (tool === "building") {
      const tempId = Date.now();
      setPlannedBuildings((current) => [...current, { id: tempId, x: point.x, y: point.y, floors: buildingFloors }]);
      setToast(`${buildingFloors}-floor proposed building placed`);
      if (sessionId) {
        fetch("/api/buildings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, x: point.x, y: point.y, floors: buildingFloors }),
        })
          .then((res) => res.json())
          .then((row: { id?: number }) => {
            if (row.id) {
              setPlannedBuildings((current) =>
                current.map((b) => b.id === tempId ? { ...b, id: row.id! } : b)
              );
            }
          })
          .catch(() => {});
      }
      return;
    }
    const tempId = Date.now();
    setAddedAssets((current) => [...current, { id: tempId, x: point.x, y: point.y, rotation: 0, scale: 1, asset: selectedAsset }]);
    setSelectedPlacedAssetId(tempId);
    setTool("select");
    setToast(`${selectedAsset.name} placed`);
    if (sessionId) {
      fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, assetId: selectedAsset.id, assetName: selectedAsset.name, x: point.x, y: point.y }),
      })
        .then((res) => res.json())
        .then((row: { id?: number }) => {
          if (row.id) {
            setAddedAssets((current) =>
              current.map((a) => a.id === tempId ? { ...a, id: row.id! } : a)
            );
            setSelectedPlacedAssetId((cur) => cur === tempId ? row.id! : cur);
          }
        })
        .catch(() => {});
    }
  }

  function updatePlacedAsset(id: number, changes: Partial<Pick<PlacedAsset, "x" | "y" | "rotation" | "scale">>) {
    setAddedAssets((current) => current.map((asset) => asset.id === id ? { ...asset, ...changes } : asset));
    if (sessionId) {
      fetch("/api/assets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...changes }),
      }).catch(() => {});
    }
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
    if (sessionId) fetch(`/api/assets?id=${id}`, { method: "DELETE" }).catch(() => {});
  }

  if (loading) {
    return (
      <div className="loading-overlay">
        <span className="loading-glyph" aria-hidden="true"><i /><i /><i /></span>
        <span>Loading district twin…</span>
      </div>
    );
  }

  return (
    <main className="reference-page">
      <section className="reference-app">
        <aside className="reference-sidebar" aria-label="Primary navigation">
          <div className="reference-brand">
            <span className="reference-logo"><Image src="/mirrorcity-brand.png" alt="" width={40} height={40} priority /></span>
            <span>MIRROR<b>CITY</b></span>
          </div>

          <nav className="reference-nav">
            {([
              ["twin", "twin", "District twin"],
              ["scenarios", "scenario", "Scenarios"],
              ["infrastructure", "layers", "Infrastructure"],
              ["assets", "assets", "Asset library"],
              ["data", "data", "Source data"],
              ["operations", "activity", "Operations"],
            ] as Array<[ViewKey, IconName, string]>).map(([view, icon, label]) => (
              <button key={view} className={activeView === view ? "active" : ""} onClick={() => { setActiveView(view); if (view === "operations") setInspectorTab("operations"); }}><span><Icon name={icon} /></span>{label}</button>
            ))}
          </nav>

          <div className="reference-sidebar-footer">
            <button className={activeView === "settings" ? "active" : ""} onClick={() => setActiveView("settings")}><span><Icon name="settings" /></span>Settings</button>
            <button className={activeView === "help" ? "active" : ""} onClick={() => setActiveView("help")}><span><Icon name="help" /></span>Help center</button>
          </div>
        </aside>

        <section className="reference-body">
          <header className="reference-topbar">
            <div className="reference-breadcrumb"><span>Mirror City</span><b>/</b><span>{districtName}</span><b>/</b><strong>{activeViewLabel[activeView]}</strong></div>
            <div className="reference-actions">
              <button className={`reference-live ${operationalMode ? "active" : ""}`} onClick={() => setOperationalMode((value) => !value)}><i />{operationalMode ? "Twin connected" : "Planning mode"}</button>
              <button className="reference-icon-button" aria-label="Search help and guidance" onClick={() => setActiveView("help")}><Icon name="search" /></button>
              <button className="reference-icon-button notification" aria-label="Open operational notifications" onClick={() => setActiveView("operations")}><Icon name="bell" /><i /></button>
              <button className="reference-avatar" aria-label="Open workspace settings" onClick={() => setActiveView("settings")}>NK</button>
            </div>
          </header>

          <div className="reference-content">
            <section className="reference-primary">
              {activeView === "twin" && <>
              <header className="reference-hero">
                <div><span>SPATIAL OPERATING SYSTEM</span><h1>See the city <em>before it happens.</em></h1><p>Model infrastructure, simulate pressure and make resilient decisions in one living district twin.</p></div>
                <button className="reference-run" disabled={running} onClick={runSimulation}>{running ? <><i /> Computing…</> : <><Icon name="play" /> Run simulation</>}</button>
              </header>

              <div className="reference-filters">
                <button><i className="cyan" /> Live district⌄</button>
                <button>{scenario.label}⌄</button>
                <button>26 Aug 2026⌄</button>
                <button className={`reference-compare ${compareMode ? "active" : ""}`} onClick={() => setCompareMode((value) => !value)}><Icon name="compare" /> Compare</button>
                <button className="reference-import" onClick={() => fileRef.current?.click()}><Icon name="import" /> Import data</button>
                <input ref={fileRef} className="sr-only" type="file" accept=".las,.laz,.tif,.tiff,.obj,.ply,.glb,.gltf,.fbx,image/*" onChange={handleImport} />
              </div>

              <section className="twin-work-card">
                <header className="twin-card-header">
                  <div><i /><span><small>ACTIVE DISTRICT</small><strong>{districtName}</strong></span></div>
                  <div className="twin-card-meta"><span>128 sensors</span><span>LOD 02</span><button onClick={() => setToast("Snapshot saved to scenario history")}>Save snapshot</button></div>
                </header>

                <div className={`reference-map tool-${tool}`} role="region" aria-label="Interactive 3D district twin">
                  <div className="map-tools" aria-label="Map tools">
                    {([[
                      "select", "twin", "Select"], ["orbit", "orbit", "Orbit"], ["measure", "measure", "Measure"], ["line", "layers", "Draw utility"], ["area", "scenario", "Draw zone"], ["building", "building", "Place building"], ["asset", "plus", "Place 3D asset"]] as Array<[ToolKey, IconName, string]>).map(([key, icon, label]) => (
                      <button key={key} className={tool === key ? "active" : ""} onClick={() => selectTool(key)} title={label} aria-label={label}><Icon name={icon} /></button>
                    ))}
                    <button onClick={undoLast} title="Undo last edit" aria-label="Undo last edit">↶</button>
                  </div>

                  {(tool === "line" || tool === "area" || tool === "building" || tool === "asset") && <div className="create-dock">
                    <div className="dock-heading"><span>{tool === "line" ? "DRAW UTILITY LINE" : tool === "area" ? "DRAW PLANNING ZONE" : tool === "building" ? "PLACE BUILDING" : "PLACE 3D ASSET"}</span><button onClick={() => { setTool("select"); setDraftPoints([]); }}>×</button></div>
                    {tool === "line" && <div className="line-kind-picker">{lineKinds.map((kind) => <button key={kind.id} className={lineKind === kind.id ? "active" : ""} style={{ "--kind": kind.color } as React.CSSProperties} onClick={() => setLineKind(kind.id)}><i />{kind.label}</button>)}</div>}
                    {tool === "area" && <p>Click around the site boundary. Add at least three points.</p>}
                    {tool === "building" && <label className="floor-control"><span>FLOORS</span><input type="range" min="1" max="18" value={buildingFloors} onChange={(event) => setBuildingFloors(Number(event.target.value))}/><strong>{buildingFloors}</strong></label>}
                    {tool === "asset" && <div className="chosen-asset"><i>{selectedAsset.code}</i><span><strong>{selectedAsset.name}</strong><small>{selectedAsset.category}</small></span><button onClick={() => { setReplaceAssetId(null); setAssetLibraryOpen(true); }}>Change</button></div>}
                    {(tool === "line" || tool === "area") && <div className="dock-actions"><span>{draftPoints.length} points</span><button onClick={() => setDraftPoints((current) => current.slice(0, -1))} disabled={!draftPoints.length}>Undo</button><button className="finish-button" onClick={finishDrawing}>Finish</button></div>}
                  </div>}

                  {selectedPlacedAsset && tool === "select" && <div className="asset-edit-dock">
                    <div className="dock-heading"><span>EDIT ASSET</span><button onClick={() => setSelectedPlacedAssetId(null)}>×</button></div>
                    <div className="edit-asset-heading"><i>{selectedPlacedAsset.asset.code}</i><span><strong>{selectedPlacedAsset.asset.name}</strong><small>Drag directly to move</small></span></div>
                    <label className="transform-control"><span>ROTATION</span><input type="range" min="-180" max="180" step="5" value={selectedPlacedAsset.rotation} onChange={(event) => updatePlacedAsset(selectedPlacedAsset.id, { rotation: Number(event.target.value) })} /><strong>{selectedPlacedAsset.rotation}°</strong></label>
                    <label className="transform-control"><span>SCALE</span><input type="range" min="0.5" max="2.5" step="0.1" value={selectedPlacedAsset.scale} onChange={(event) => updatePlacedAsset(selectedPlacedAsset.id, { scale: Number(event.target.value) })} /><strong>{selectedPlacedAsset.scale.toFixed(1)}×</strong></label>
                    <div className="edit-asset-actions"><button onClick={() => duplicatePlacedAsset(selectedPlacedAsset)}>Duplicate</button><button onClick={() => { setReplaceAssetId(selectedPlacedAsset.id); setAssetCategory("All"); setAssetLibraryOpen(true); }}>Replace</button><button className="delete-action" onClick={() => deletePlacedAsset(selectedPlacedAsset.id)}>Delete</button></div>
                  </div>}

                  <CityEngineErrorBoundary>
                    <CityEngine tool={tool} buildings={buildings} placedAssets={addedAssets} plannedBuildings={plannedBuildings} drawnLines={drawnLines} drawnAreas={drawnAreas} draftPoints={draftPoints} lineKind={lineKind} selectedAsset={selectedAsset} selectedPlacedAssetId={selectedPlacedAssetId} selectedBuildingId={selectedId} layers={layers} zoom={zoom} activeScenario={activeScenario} population={population} simulationRunning={running} simulationComplete={complete} operationalMode={operationalMode} incidentActive={incidentActive} annotations={annotations} onAnnotationSelect={(id) => { const item = annotations.find((annotation) => annotation.id === id); if (item) setToast(`${item.label} · ${item.value} · ${item.detail}`); }} onMapPoint={handleMapPoint} onSelectAsset={(id) => { setSelectedPlacedAssetId(id); setTool("select"); setToast("3D asset selected · drag it across the ground"); }} onMoveAsset={(id, point) => updatePlacedAsset(id, point)} onSelectBuilding={(id) => { setSelectedId(id); setSelectedPlacedAssetId(null); setInspectorTab("object"); setTool("select"); }} />
                  </CityEngineErrorBoundary>

                  {operationalMode && <span className="live-tick">FEED #{String(liveTick + 1842).padStart(6, "0")}</span>}
                  {compareMode && <div className="compare-overlay"><span className="compare-label current">CURRENT</span><span className="compare-label proposed">PROPOSED 2035</span><i className="compare-divider" /></div>}
                </div>

                <footer className="scenario-switcher">
                  {(Object.keys(scenarios) as ScenarioKey[]).map((key) => <button key={key} className={activeScenario === key ? "active" : ""} onClick={() => { setActiveScenario(key); setComplete(false); }}><span>{key === "sewer" ? "01" : key === "flood" ? "02" : "03"}</span><i style={{ background: scenarios[key].accent }} /><strong>{scenarios[key].label}</strong><small>{key === "sewer" ? "Network pressure" : key === "flood" ? "100-year rainfall" : "Clearance routing"}</small></button>)}
                </footer>
              </section>

              <div className="reference-bottom-grid">
                <section className="reference-card layer-card">
                  <header><div><span>VISIBLE SYSTEMS</span><h3>District layers</h3></div><button onClick={() => setActiveView("infrastructure")}>Manage</button></header>
                  <div>{([
                    ["buildings", "Built form", "624 structures", "#7aa2ff"], ["sewer", "Sewer", "18.2 km", "#4f6fff"], ["power", "Power", "46 assets", "#00dfff"], ["mobility", "Mobility", "Live traffic", "#168cff"], ["sensors", "Sensors", "128 online", "#7cecff"], ["construction", "Capital works", "7 sites", "#ffffff"],
                  ] as Array<[LayerKey, string, string, string]>).map(([key, label, meta, color]) => <button key={key} className={layers[key] ? "active" : ""} onClick={() => toggleLayer(key)}><i style={{ background: color }} /><span><strong>{label}</strong><small>{meta}</small></span><em /></button>)}</div>
                </section>

                <section className="reference-card source-card">
                  <header><div><span>SOURCE LIBRARY</span><h3>IITH reconstructions</h3></div><button onClick={() => { setAssetCategory("IITH terrain"); setActiveView("assets"); }}>View all</button></header>
                  <div className="source-models">{assetLibrary.filter((asset) => asset.category === "IITH terrain").map((asset) => <button key={asset.id} onClick={() => setViewerAsset(asset)}><i style={{ backgroundImage: `url(${asset.preview})` }} /><span><strong>{asset.name.replace("IITH ", "")}</strong><small>{asset.stats?.[3].value} tris · {asset.stats?.[2].value}</small></span></button>)}</div>
                </section>
              </div>
              </>}

              {activeView === "scenarios" && <section className="workspace-view">
                <header className="workspace-view-header">
                  <div><span>SIMULATION STUDIO</span><h1>Test futures, <em>before committing.</em></h1><p>Compare infrastructure pressure, hazard exposure and evacuation performance from one controlled workspace.</p></div>
                  <button className="workspace-primary-action" onClick={runSimulation}><Icon name="play" />{running ? "Computing…" : "Run selected"}</button>
                </header>
                <div className="scenario-studio-grid">
                  {(Object.keys(scenarios) as ScenarioKey[]).map((key, index) => <button key={key} className={`studio-scenario-card ${activeScenario === key ? "active" : ""}`} onClick={() => { setActiveScenario(key); setComplete(false); }}>
                    <span className="studio-index">0{index + 1}</span><i style={{ background: scenarios[key].accent }} />
                    <small>{scenarios[key].kicker}</small><h2>{scenarios[key].label}</h2>
                    <p>{key === "sewer" ? "Stress-test network capacity against projected occupancy." : key === "flood" ? "Map depth, exposure and drain-down under monsoon load." : "Model clearance time, route demand and emergency access."}</p>
                    <strong>{key === "sewer" ? `${sewer.load}% load` : key === "flood" ? `${floodMetrics(population)[0].value} peak` : `${evacuationMetrics(population)[0].value} clearance`}<b>{activeScenario === key ? "SELECTED" : "SELECT"}</b></strong>
                  </button>)}
                </div>
                <div className="workspace-lower-grid">
                  <section className="workspace-panel simulation-history">
                    <header><div><span>RECENT RUNS</span><h3>Scenario history</h3></div><button onClick={() => setActiveView("twin")}>Open in twin →</button></header>
                    {["Sewer · 2,000 residents", "Flood · 100-year rainfall", "Evacuation · evening peak"].map((label, index) => <div className="history-row" key={label}><i className={index === 0 ? "complete" : ""} /><span><strong>{label}</strong><small>{index === 0 ? "Today, 14:32" : index === 1 ? "Yesterday, 18:04" : "24 Aug, 09:18"}</small></span><em>{index === 0 ? "94% confidence" : index === 1 ? "89% confidence" : "91% confidence"}</em><button onClick={() => { setActiveScenario(index === 0 ? "sewer" : index === 1 ? "flood" : "evacuation"); setActiveView("twin"); }}>View</button></div>)}
                  </section>
                  <section className="workspace-panel assumptions-panel">
                    <header><div><span>MODEL INPUTS</span><h3>Live assumptions</h3></div></header>
                    <label><span>Projected population</span><strong>{population.toLocaleString()}</strong><input type="range" min="1500" max="2500" step="50" value={population} onChange={(event) => setPopulation(Number(event.target.value))} /></label>
                    <div><span><small>MODEL TYPE</small><strong>Concept twin</strong></span><span><small>SENSOR COVERAGE</small><strong>128 feeds</strong></span><span><small>SYNC</small><strong>2 min ago</strong></span></div>
                  </section>
                </div>
              </section>}

              {activeView === "infrastructure" && <section className="workspace-view">
                <header className="workspace-view-header"><div><span>INFRASTRUCTURE SYSTEMS</span><h1>One district, <em>every network.</em></h1><p>Control visibility, inspect dependencies and trace critical systems without leaving the operating view.</p></div><button className="workspace-primary-action" onClick={() => setActiveView("twin")}><Icon name="twin" />Open spatial twin</button></header>
                <div className="infrastructure-grid">
                  {([ ["buildings", "Built form", "624", "Structures", "#7aa2ff"], ["sewer", "Sewer network", "18.2", "Kilometres", "#4f6fff"], ["power", "Power grid", "46", "Assets", "#00dfff"], ["mobility", "Mobility", "12.4k", "Daily trips", "#168cff"], ["sensors", "Sensor fabric", "128", "Online", "#7cecff"], ["construction", "Capital works", "7", "Active sites", "#ffffff"] ] as Array<[LayerKey,string,string,string,string]>).map(([key,label,value,unit,color]) => <article className={layers[key] ? "system-card active" : "system-card"} key={key}>
                    <header><i style={{ background: color }} /><span>{layers[key] ? "VISIBLE" : "HIDDEN"}</span><button aria-label={`Toggle ${label}`} onClick={() => toggleLayer(key)}><em /></button></header><h2>{label}</h2><strong>{value}<small>{unit}</small></strong><div className="system-spark"><i /><i /><i /><i /><i /><i /></div><footer><span>Synced 2 min ago</span><button onClick={() => { setLayers((current) => ({ ...current, [key]: true })); setActiveView("twin"); }}>Inspect →</button></footer>
                  </article>)}
                </div>
                <div className="workspace-lower-grid infrastructure-lower">
                  <section className="workspace-panel topology-panel"><header><div><span>SYSTEM DEPENDENCIES</span><h3>Critical topology</h3></div><button>Export graph</button></header><div className="topology-flow"><span>Substation E-14<small>71% load</small></span><i /><span>Pump station P-08<small>Nominal</small></span><i /><span>Civic Hospital<small>Protected</small></span></div></section>
                  <section className="workspace-panel"><header><div><span>CAPITAL PROGRAMME</span><h3>Works in progress</h3></div></header><div className="compact-progress"><span><strong>River interceptor</strong><small>64%</small></span><i><b style={{ width: "64%" }} /></i></div><div className="compact-progress"><span><strong>Emergency hub</strong><small>38%</small></span><i><b style={{ width: "38%" }} /></i></div></section>
                </div>
              </section>}

              {activeView === "assets" && <section className="workspace-view">
                <header className="workspace-view-header"><div><span>3D CONTENT CATALOGUE</span><h1>Asset <em>library.</em></h1><p>Verified civic models and terrain reconstructions, ready to inspect or place directly in the district twin.</p></div><button className="workspace-primary-action" onClick={() => setActiveView("twin")}><Icon name="twin" />Return to twin</button></header>
                <div className="inline-library-controls"><label><Icon name="search" /><input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Search pumps, terrain, power…" /></label><div>{assetCategories.map((category) => <button key={category} className={assetCategory === category ? "active" : ""} onClick={() => setAssetCategory(category)}>{category}</button>)}</div></div>
                <div className="inline-asset-grid">
                  {filteredAssets.map((asset) => <article className="inline-asset-card" key={asset.id}><div className={`inline-asset-preview tone-${asset.tone}`} style={asset.preview ? { backgroundImage: `url(${asset.preview})` } : undefined}>{!asset.preview && <span>{asset.code}</span>}<small>{asset.format ?? "OBJ"}</small></div><div><span>{asset.category}</span><h3>{asset.name}</h3><p>{asset.description}</p></div><footer>{asset.file && <button onClick={() => setViewerAsset(asset)}>View 3D</button>}<button className="place" onClick={() => { beginAssetPlacement(asset); setActiveView("twin"); }}>＋ Place in twin</button></footer></article>)}
                  {!filteredAssets.length && <div className="empty-assets"><strong>No assets found</strong><span>Try another category or search phrase.</span></div>}
                </div>
              </section>}

              {activeView === "data" && <section className="workspace-view data-view">
                <header className="workspace-view-header"><div><span>DATA OPERATIONS</span><h1>Evidence behind the <em>twin.</em></h1><p>Inspect geometry, provenance and interoperability—not decorative source cards. Every number below comes from the project manifests or implemented sensor endpoints.</p></div><button className="workspace-primary-action" onClick={() => fileRef.current?.click()}><Icon name="import" />Import source</button></header>
                <input ref={fileRef} className="sr-only" type="file" accept=".las,.laz,.tif,.tiff,.obj,.ply,.glb,.gltf,.fbx,image/*" onChange={handleImport} />

                <nav className="data-command-bar" aria-label="Data workspace sections">
                  <div>{([ ["catalogue", "Catalogue"], ["quality", "Quality"], ["standards", "Standards"] ] as Array<[DataTab,string]>).map(([key,label]) => <button key={key} className={dataTab === key ? "active" : ""} onClick={() => setDataTab(key)}>{label}</button>)}</div>
                  <span><i />{importState}</span>
                </nav>

                {dataTab === "catalogue" && <>
                  <section className="data-summary-strip"><span><small>OBSERVED POINTS</small><strong>1.29M</strong><em>LiDAR sources in manifests</em></span><span><small>WEB-READY MODELS</small><strong>6 GLB</strong><em>Terrain and object layers</em></span><span><small>EXTRACTED OBJECTS</small><strong>49</strong><em>Buildings and street assets</em></span><span className="summary-warning"><small>REFERENCE SYSTEM</small><strong>Unspecified</strong><em>CRS must be supplied before federation</em></span></section>
                  <div className="data-filter-bar"><label><Icon name="search" /><input value={dataQuery} onChange={(event) => setDataQuery(event.target.value)} placeholder="Search datasets, formats or provenance…" /></label><div>{(["All", "LiDAR", "Terrain", "Telemetry"] as const).map((family) => <button key={family} className={dataFamily === family ? "active" : ""} onClick={() => setDataFamily(family)}>{family}</button>)}</div></div>
                  <div className="data-console-grid">
                    <section className="dataset-register" aria-label="Dataset catalogue"><header><span>DATASET</span><span>TYPE</span><span>OUTPUT</span><span>QUALITY</span></header><div className="dataset-scroll">
                      {filteredDatasets.map((dataset) => <button key={dataset.id} className={selectedDataset.id === dataset.id ? "selected" : ""} onClick={() => setSelectedDatasetId(dataset.id)}><span><i className={`dataset-status status-${dataset.status.toLowerCase()}`} /><b>{dataset.name}</b><small>{dataset.headline}</small></span><em>{dataset.family}</em><em>{dataset.format}</em><strong>{dataset.quality}<small>/100</small></strong></button>)}
                      {!filteredDatasets.length && <div className="dataset-empty"><strong>No matching datasets</strong><span>Clear the filter or search a different term.</span></div>}
                    </div></section>
                    <aside className="dataset-inspector">
                      <header><span>{selectedDataset.family} · {selectedDataset.status}</span><h2>{selectedDataset.name}</h2><p>{selectedDataset.description}</p></header>
                      <div className="dataset-provenance"><small>PROVENANCE</small><strong>{selectedDataset.source}</strong><em>{selectedDataset.updated}</em></div>
                      <div className="dataset-stat-grid">{selectedDataset.stats.map((stat) => <span key={stat.label}><small>{stat.label}</small><strong>{stat.value}</strong></span>)}</div>
                      <div className="dataset-checks"><small>VALIDATION</small>{selectedDataset.checks.map((check) => <span key={check.label}><i className={check.state} /> <b>{check.label}</b><em>{check.detail}</em></span>)}</div>
                      <footer>{selectedDataset.file ? <button className="primary" onClick={() => setViewerAsset({ id: selectedDataset.id, name: selectedDataset.name, category: `${selectedDataset.family} dataset`, code: "DATA", description: selectedDataset.description, size: "Local", tone: "blue", file: selectedDataset.file, format: "GLB", preview: selectedDataset.preview, stats: selectedDataset.stats })}>Inspect 3D model</button> : <button className="primary" onClick={() => { setDataTab("standards"); setToast("Telemetry interoperability plan opened"); }}>Plan integration</button>}<button onClick={() => setDataTab("quality")}>Review quality</button></footer>
                    </aside>
                  </div>
                </>}

                {dataTab === "quality" && <div className="quality-workspace">
                  <section className="quality-overview"><header><span>READINESS REVIEW</span><h2>Quality gates</h2><p>The geometry is usable for prototyping. Federation is blocked until spatial reference, rights and stable feature identity are documented.</p></header><div><span><strong>17</strong><small>checks passed</small></span><span><strong>7</strong><small>review items</small></span><span><strong>8</strong><small>missing fields</small></span></div><button onClick={() => { setDataFamily("All"); setDataQuery(""); setDataTab("catalogue"); }}>Open affected datasets</button></section>
                  <section className="quality-matrix"><header><span>DATASET</span><span>GEOMETRY</span><span>SEMANTICS</span><span>CRS</span><span>PROVENANCE</span></header>{datasetInventory.map((dataset) => <button key={dataset.id} onClick={() => { setSelectedDatasetId(dataset.id); setDataTab("catalogue"); }}><strong>{dataset.name}</strong>{["Geometry", dataset.family === "Telemetry" ? "District linkage" : dataset.id === "semantic-corridor" ? "Semantics" : "Object identity", "Coordinate reference", dataset.checks.some((check) => check.label === "Source terms") ? "Source terms" : "Provenance"].map((label) => { const check = dataset.checks.find((item) => item.label === label); return <span key={label} className={check?.state ?? "missing"}>{check?.state === "pass" ? "Passed" : check?.state === "warn" ? "Review" : "Missing"}</span>; })}</button>)}</section>
                </div>}

                {dataTab === "standards" && <div className="standards-workspace">
                  <header><span>INTEROPERABILITY ROADMAP</span><h2>Build the twin as a connected system.</h2><p>Adopt standards at the data boundary first; renderer upgrades should follow once identity, time and provenance are reliable.</p></header>
                  <div className="standards-grid">{[
                    ["01", "SensorThings + Connected Systems", "Map devices, observed properties, datastreams and time-series observations; extend to mobile systems and simulations.", "NEXT", "district-telemetry"],
                    ["02", "CityGML 3.0 semantics", "Assign persistent city-object identities, relationships and levels of detail to buildings, utilities and transport features.", "FOUNDATION", "building-masses"],
                    ["03", "3D Tiles 1.1 metadata", "Stream larger districts hierarchically and expose per-feature metadata for selection, filtering and analysis.", "SCALE", "semantic-corridor"],
                    ["04", "IFC 4.3 exchange", "Bring buildings and horizontal infrastructure into a traceable open BIM handover workflow.", "CONNECT", "road-terrain"],
                  ].map(([index,title,body,tag,datasetId]) => <article key={index}><span>{index}</span><em>{tag}</em><h3>{title}</h3><p>{body}</p><button onClick={() => { setSelectedDatasetId(datasetId); setDataTab("catalogue"); }}>Map to current data →</button></article>)}</div>
                  <section className="technology-note"><i>R&amp;D</i><span><strong>WebGPU renderer</strong><small>Evaluate after 3D Tiles and level-of-detail streaming. The current Three.js path remains the safer production baseline while WebGPU support matures.</small></span><button onClick={() => setToast("WebGPU evaluation added to the technical roadmap")}>Add to roadmap</button></section>
                </div>}
              </section>}

              {activeView === "operations" && <section className="workspace-view">
                <header className="workspace-view-header"><div><span>LIVE OPERATIONS</span><h1>District <em>command.</em></h1><p>Monitor health, coordinate field response and move from signal to decision in real time.</p></div><button className={`workspace-primary-action ${incidentActive ? "danger" : ""}`} onClick={() => setIncidentActive((value) => !value)}>{incidentActive ? "Resolve incident" : "Simulate incident"}</button></header>
                <section className="operations-kpis"><article><i className="good" /><span><small>NETWORK HEALTH</small><strong>{incidentActive ? "61" : "84"}%</strong><em>{incidentActive ? "Response active" : "Nominal"}</em></span></article><article><i /><span><small>ACTIVE FEEDS</small><strong>128</strong><em>100% online</em></span></article><article><i /><span><small>OPEN EVENTS</small><strong>{incidentActive ? "07" : "03"}</strong><em>{incidentActive ? "+4 urgent" : "−2 today"}</em></span></article><article><i /><span><small>FIELD TEAMS</small><strong>12</strong><em>9 available</em></span></article></section>
                <div className="workspace-lower-grid operations-grid">
                  <section className="workspace-panel operations-feed"><header><div><span>EVENT STREAM</span><h3>Live district feed</h3></div><button>Filter</button></header>{[ [incidentActive ? "Road incident detected" : "Flow threshold normalized", incidentActive ? "Mobility · NH-65 connector" : "Sewer · SW-18", "NOW"], ["Substation load increased", "Power · E-14", "4 MIN"], ["Interceptor milestone logged", "Capital works · RW-02", "18 MIN"], ["Air quality reading healthy", "Environment · AQ-04", "31 MIN"] ].map(([title,meta,time], index) => <div className={`event-row ${index === 0 && incidentActive ? "urgent" : ""}`} key={title}><i>{index === 0 && incidentActive ? "!" : "✓"}</i><span><strong>{title}</strong><small>{meta}</small></span><em>{time}</em><button onClick={() => setActiveView("twin")}>Locate</button></div>)}</section>
                  <section className="workspace-panel response-panel"><header><div><span>RESPONSE STATUS</span><h3>{incidentActive ? "Road incident · active" : "No critical incident"}</h3></div></header><div className="response-ring"><strong>{incidentActive ? "04:18" : "99.2%"}</strong><small>{incidentActive ? "ELAPSED" : "UPTIME"}</small></div><ul><li><i />Twin synchronized</li><li><i />Routes recalculated</li><li className={incidentActive ? "active" : ""}><i />{incidentActive ? "2 teams dispatched" : "Teams on standby"}</li></ul><button onClick={() => setActiveView("twin")}>Open operational twin →</button></section>
                </div>
              </section>}

              {activeView === "settings" && <section className="workspace-view">
                <header className="workspace-view-header"><div><span>WORKSPACE PREFERENCES</span><h1>Settings that stay <em>out of your way.</em></h1><p>Control how the district twin behaves, synchronizes and communicates changes across your workspace.</p></div><button className="workspace-primary-action" onClick={() => { setToast("Workspace preferences saved"); setActiveView("twin"); }}>Save changes</button></header>
                <div className="settings-grid">
                  <section className="workspace-panel settings-section"><header><div><span>TWIN BEHAVIOUR</span><h3>Workspace defaults</h3></div></header><div className="settings-list"><button onClick={() => setOperationalMode((value) => !value)}><span><strong>Live operations mode</strong><small>Show sensors, work sites and realtime status on launch.</small></span><em className={operationalMode ? "active" : ""} /></button><button onClick={() => setCompareMode((value) => !value)}><span><strong>Scenario comparison</strong><small>Keep the current and proposed states ready to compare.</small></span><em className={compareMode ? "active" : ""} /></button><button onClick={() => toggleLayer("sensors")}><span><strong>Sensor layer</strong><small>Display verified sensor markers in the spatial twin.</small></span><em className={layers.sensors ? "active" : ""} /></button></div></section>
                  <section className="workspace-panel settings-section"><header><div><span>DISPLAY</span><h3>Interface and accessibility</h3></div></header><div className="preference-cards"><button className="active"><i>Aa</i><span><strong>Comfortable</strong><small>Recommended density</small></span></button><button><i>◐</i><span><strong>Dark</strong><small>Mirror City navy</small></span></button><button><i>⌘</i><span><strong>Reduced motion</strong><small>Follow system setting</small></span></button></div></section>
                  <section className="workspace-panel settings-section settings-wide"><header><div><span>DATA & SYNC</span><h3>District connection</h3></div><button onClick={() => setToast("Synchronization check complete · all sources healthy")}>Test connection</button></header><div className="connection-row"><i /><span><strong>Varuna River Ward workspace</strong><small>128 live feeds · 14 source datasets · synchronized 2 minutes ago</small></span><em>CONNECTED</em></div><div className="connection-row"><i className="cyan" /><span><strong>Automatic model refresh</strong><small>Publish validated source changes every 15 minutes.</small></span><em>15 MIN</em></div></section>
                </div>
              </section>}

              {activeView === "help" && <section className="workspace-view">
                <header className="workspace-view-header"><div><span>HELP CENTER</span><h1>Find an answer, <em>keep moving.</em></h1><p>Short, task-focused guidance for modelling, simulation, source data and live district operations.</p></div><button className="workspace-primary-action" onClick={() => setActiveView("twin")}><Icon name="twin" />Open twin</button></header>
                <label className="help-search"><Icon name="search" /><input placeholder="Search modelling, scenarios, data sources…" /><span>⌘ K</span></label>
                <div className="help-topic-grid"><button onClick={() => setActiveView("twin")}><Icon name="twin" /><span><strong>Build the district twin</strong><small>Navigate, select and edit the spatial model.</small></span><em>→</em></button><button onClick={() => setActiveView("scenarios")}><Icon name="scenario" /><span><strong>Run simulations</strong><small>Configure assumptions and compare outcomes.</small></span><em>→</em></button><button onClick={() => setActiveView("data")}><Icon name="data" /><span><strong>Connect source data</strong><small>Import surveys and monitor processing.</small></span><em>→</em></button></div>
                <div className="workspace-lower-grid help-lower"><section className="workspace-panel getting-started"><header><div><span>GETTING STARTED</span><h3>Your first resilient-city workflow</h3></div></header><ol><li><i>01</i><span><strong>Inspect the live district</strong><small>Confirm system layers and sensor coverage.</small></span><button onClick={() => setActiveView("twin")}>Open</button></li><li><i>02</i><span><strong>Choose a pressure test</strong><small>Select sewer, flood or evacuation modelling.</small></span><button onClick={() => setActiveView("scenarios")}>Open</button></li><li><i>03</i><span><strong>Compare and communicate</strong><small>Review confidence, impacts and recommended action.</small></span><button onClick={() => { setCompareMode(true); setActiveView("twin"); }}>Open</button></li></ol></section><section className="workspace-panel support-card"><header><div><span>WORKSPACE SUPPORT</span><h3>Need a human?</h3></div></header><div><span className="support-avatar">MC</span><h2>Digital twin support</h2><p>Get help with model setup, data preparation or simulation assumptions.</p><button onClick={() => setToast("Support request prepared · response target 4 hours")}>Prepare support request</button><small>Typical response within 4 hours</small></div></section></div>
              </section>}
            </section>

            <aside className="reference-aside">
              <section className="reference-side-card simulation-card">
                <header><div><span>{scenario.kicker}</span><h2>{scenario.label}</h2></div><button aria-label="Open scenario workspace" onClick={() => setActiveView("scenarios")}>•••</button></header>
                <p>{activeScenario === "sewer" ? "Test how occupancy changes pressure across the district network." : activeScenario === "flood" ? "See depth and exposure under severe monsoon rainfall." : "Model route load, clearance and emergency access."}</p>
                <label className="reference-population"><span><small>POPULATION</small><strong>{population.toLocaleString()}</strong></span><input aria-label="Projected population" type="range" min="1500" max="2500" step="50" value={population} onChange={(event) => { setPopulation(Number(event.target.value)); setComplete(false); }} /><i><small>1,500</small><small>2,000</small><small>2,500</small></i></label>
                <div className="reference-metrics">{metricSet.map((metric) => <span key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong><em>{metric.trend}</em></span>)}</div>
                <div className="reference-confidence"><span><small>MODEL CONFIDENCE</small><strong>{activeScenario === "sewer" ? "94%" : activeScenario === "flood" ? "89%" : "91%"}</strong></span><i><b style={{ width: activeScenario === "flood" ? "89%" : activeScenario === "evacuation" ? "91%" : "94%" }} /></i><p><em /> Concept model · not calibrated</p></div>
                <button className={`reference-side-run ${running ? "running" : ""}`} disabled={running} onClick={runSimulation}>{running ? "Computing network…" : complete ? "✓ Simulation complete" : "Run simulation"}<Icon name="play" /></button>
              </section>

              <section className="reference-side-card object-card">
                <header><div><span>SELECTED OBJECT</span><h3>{selected.name}</h3></div><button aria-label="Object options">•••</button></header>
                <div className="object-visual"><span className={`mini-building tone-${selected.tone}`} /><i>MC-{String(selected.id).padStart(4, "0")}</i></div>
                <div className="object-health"><span><i />Operational</span><span>71% load</span></div>
                <div className="object-actions"><button onClick={() => setActiveView("infrastructure")}>View details</button><button onClick={() => setCompareMode(true)}>Compare</button></div>
              </section>

              <section className="reference-side-card activity-card">
                <header><div><span>LIVE OPERATIONS</span><h3>District activity</h3></div><button onClick={() => { setInspectorTab("operations"); setActiveView("operations"); }}>View feed</button></header>
                <div className="activity-stat"><strong>{incidentActive ? "61" : "84"}%</strong><span>Network health<small>{incidentActive ? "Response active" : "All systems nominal"}</small></span></div>
                <div className="activity-chart"><i /><i /><i /><i /><i /><i /><i /><b style={{ left: incidentActive ? "61%" : "84%" }} /></div>
                <footer><button className={incidentActive ? "active" : ""} onClick={() => { setIncidentActive((value) => !value); setToast(incidentActive ? "Incident resolved" : "Incident injected · routes recalculated"); }}>{incidentActive ? "Resolve incident" : "Simulate incident"}</button><span>Updated now</span></footer>
              </section>
            </aside>
          </div>
        </section>
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
            <div><span>{viewerAsset.id.startsWith("iith-") ? "IITH TERRAIN MODEL" : "SURVEY RECONSTRUCTION"} · {viewerAsset.code}</span><h2 id="model-viewer-title">{viewerAsset.name}</h2><p>{viewerAsset.description}</p></div>
            <button aria-label="Close 3D model viewer" onClick={() => setViewerAsset(null)}>×</button>
          </header>
          <div className="model-viewer-body">
            <ModelViewer src={viewerAsset.file} />
            <aside className="model-metadata">
              <div><span>RECONSTRUCTION DETAILS</span><h3>{viewerAsset.category}</h3><p>{viewerAsset.id.startsWith("iith-") ? "Generated from the supplied labelled IITH point cloud with Open3D. Ground returns are filtered, triangulated and exported as a browser-ready GLB." : "Generated from the registered project point cloud with the recorded Open3D pipeline. The browser-ready GLB retains its source counts and manifest provenance."}</p></div>
              <div className="model-stat-grid">{viewerAsset.stats?.map((stat) => <span key={stat.label}><small>{stat.label}</small><strong>{stat.value}</strong></span>)}</div>
              <div className="model-source"><i>✓</i><span><small>LOCAL MANIFEST SOURCE</small><strong>{viewerAsset.id.startsWith("iith-") ? "IITH labelled ground dataset" : "Registered project point cloud"}</strong><em>Browser-ready geometry · {viewerAsset.size} GLB</em></span></div>
              <div className="model-viewer-actions"><button onClick={() => beginAssetPlacement(viewerAsset)}>＋ Place in district</button><button onClick={() => downloadAsset(viewerAsset)}>↓ Download GLB</button></div>
            </aside>
          </div>
        </section>
      </div>}

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}
