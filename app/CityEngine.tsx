"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type Point = { x: number; y: number };
type Tool = "select" | "orbit" | "measure" | "line" | "area" | "building" | "asset";
type EngineAsset = { id: string; name: string; category: string; code: string; tone: string; file?: string; preview?: string };
type PlacedAsset = { id: number; x: number; y: number; rotation: number; scale: number; asset: EngineAsset };
type PlannedBuilding = { id: number; x: number; y: number; floors: number };
type DrawnLine = { id: number; kind: "sewer" | "power" | "water" | "road"; points: Point[] };
type DrawnArea = { id: number; points: Point[] };
type Building = { id: number; name: string; x: number; y: number; w: number; d: number; h: number; tone: string };

export type EngineAnnotation = {
  id: string;
  point: Point;
  height: number;
  kind: "sensor" | "worksite" | "incident";
  label: string;
  value: string;
  detail: string;
};

type Props = {
  tool: Tool;
  buildings: Building[];
  placedAssets: PlacedAsset[];
  plannedBuildings: PlannedBuilding[];
  drawnLines: DrawnLine[];
  drawnAreas: DrawnArea[];
  draftPoints: Point[];
  lineKind: DrawnLine["kind"];
  selectedAsset: EngineAsset;
  selectedPlacedAssetId: number | null;
  selectedBuildingId: number;
  layers: { buildings: boolean; sewer: boolean; power: boolean; mobility: boolean; sensors: boolean; construction: boolean };
  zoom: number;
  activeScenario: "sewer" | "flood" | "evacuation";
  population: number;
  simulationRunning: boolean;
  simulationComplete: boolean;
  operationalMode: boolean;
  incidentActive: boolean;
  annotations: EngineAnnotation[];
  onMapPoint: (point: Point) => void;
  onAnnotationSelect: (id: string) => void;
  onSelectAsset: (id: number) => void;
  onMoveAsset: (id: number, point: Point) => void;
  onSelectBuilding: (id: number) => void;
};

type Runtime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  ground: THREE.Mesh;
  buildingsGroup: THREE.Group;
  assetsGroup: THREE.Group;
  plansGroup: THREE.Group;
  utilitiesGroup: THREE.Group;
  simulationGroup: THREE.Group;
  sensorGroup: THREE.Group;
  scanPlane: THREE.Mesh;
  ghost: THREE.Group;
  assetObjects: Map<number, THREE.Group>;
};

const WORLD_W = 24;
const WORLD_D = 18;
const toneColors: Record<string, number> = { teal: 0x00d8ff, blue: 0x3b82f6, sand: 0x78a7ff, yellow: 0x2f5fff, slate: 0x5376a5 };
const lineColors = { sewer: 0x4f6fff, power: 0x00dfff, water: 0x168cff, road: 0xb8cbff };

function toWorld(point: Point) {
  return new THREE.Vector3((point.x / 100 - 0.5) * WORLD_W, 0.05, (point.y / 100 - 0.5) * WORLD_D);
}

function toPercent(point: THREE.Vector3): Point {
  return {
    x: Math.max(0, Math.min(100, (point.x / WORLD_W + 0.5) * 100)),
    y: Math.max(0, Math.min(100, (point.z / WORLD_D + 0.5) * 100)),
  };
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

function clearGroup(group: THREE.Group) {
  [...group.children].forEach((child) => { group.remove(child); disposeObject(child); });
}

function box(width: number, height: number, depth: number, color: number, metalness = 0.05) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.y = height / 2;
  return mesh;
}

function createPrefab(asset: EngineAsset) {
  const group = new THREE.Group();
  const color = toneColors[asset.tone] ?? 0x5376a5;
  const dark = new THREE.MeshStandardMaterial({ color: 0x081842, roughness: 0.7, metalness: 0.45 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25, emissive: color, emissiveIntensity: 0.08 });

  if (asset.category === "IITH terrain") {
    const base = box(3.8, 0.2, 2.8, 0x123b83);
    group.add(base);
    for (let index = 0; index < 9; index += 1) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), new THREE.MeshBasicMaterial({ color: index % 2 ? 0xffffff : 0x00dfff }));
      marker.position.set(-1.5 + (index % 3) * 1.5, 0.22 + (index % 3) * 0.04, -0.9 + Math.floor(index / 3) * 0.9);
      group.add(marker);
    }
  } else if (asset.id === "tower") {
    for (let index = 0; index < 4; index += 1) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.07, 3.2, 6), dark);
      mast.position.set(index < 2 ? -0.35 : 0.35, 1.6, index % 2 ? -0.35 : 0.35);
      mast.rotation.z = (index < 2 ? -1 : 1) * 0.12;
      mast.castShadow = true;
      group.add(mast);
    }
    [0.6, 1.3, 2, 2.7].forEach((height) => { const brace = box(1, 0.06, 1, color, 0.5); brace.position.y = height; group.add(brace); });
  } else if (asset.id === "pump") {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.35, 20), accent);
    body.rotation.z = Math.PI / 2; body.position.y = 0.72; body.castShadow = true; group.add(body);
    const pipe = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.1, 10, 24, Math.PI), dark);
    pipe.rotation.x = Math.PI / 2; pipe.position.set(0.65, 0.7, 0); group.add(pipe);
  } else if (asset.id === "barrier") {
    for (let index = -2; index <= 2; index += 1) { const unit = box(0.72, 0.65, 0.35, color); unit.position.x = index * 0.7; group.add(unit); }
  } else if (asset.id === "shelter" || asset.id === "hospital") {
    const shell = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 1.7, 8, 16), accent);
    shell.rotation.z = Math.PI / 2; shell.scale.z = 1.25; shell.position.y = 0.9; shell.castShadow = true; group.add(shell);
    if (asset.id === "hospital") { const crossA = box(0.5, 0.06, 0.16, 0xffffff); crossA.position.set(0, 1.82, 0); group.add(crossA); const crossB = box(0.16, 0.06, 0.5, 0xffffff); crossB.position.set(0, 1.82, 0); group.add(crossB); }
  } else {
    group.add(box(1.8, 1.1, 1.25, color, 0.28));
    const cap = box(1.45, 0.18, 1, 0x081842, 0.55); cap.position.y = 1.22; group.add(cap);
    if (asset.id === "generator") { const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.75, 10), dark); exhaust.position.set(0.55, 1.62, 0.35); group.add(exhaust); }
    if (asset.id === "substation") for (let x = -0.5; x <= 0.5; x += 0.5) { const insulator = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.65, 8), accent); insulator.position.set(x, 1.55, 0); group.add(insulator); }
  }

  const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.36, 48), new THREE.MeshBasicMaterial({ color: 0x00dfff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  ring.name = "selection-ring"; ring.rotation.x = -Math.PI / 2; ring.position.y = 0.035; ring.visible = false; group.add(ring);
  return group;
}

function makePath(points: Point[], kind: DrawnLine["kind"], draft = false) {
  const curvePoints = points.map((point) => { const world = toWorld(point); world.y = kind === "power" ? 0.28 : 0.11; return world; });
  if (curvePoints.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(curvePoints, false, "catmullrom", 0.12);
  const radius = kind === "road" ? 0.16 : 0.07;
  const material = new THREE.MeshStandardMaterial({ color: lineColors[kind], emissive: lineColors[kind], emissiveIntensity: draft ? 0.35 : 0.16, transparent: true, opacity: draft ? 0.62 : 0.95, roughness: 0.45 });
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, points.length * 10), radius, 8, false), material);
  mesh.receiveShadow = true;
  return mesh;
}

export default function CityEngine(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const propsRef = useRef(props);
  const annotationRefs = useRef(new Map<string, HTMLButtonElement>());
  const shapeKey = useMemo(() => props.placedAssets.map((placed) => `${placed.id}:${placed.asset.id}`).join("|"), [props.placedAssets]);

  useEffect(() => { propsRef.current = props; }, [props]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020611);
    scene.fog = new THREE.FogExp2(0x020611, 0.027);
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 180);
    camera.position.set(18, 15, 20);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.07; controls.maxPolarAngle = Math.PI * 0.46; controls.minDistance = 8; controls.maxDistance = 48; controls.target.set(0, 0.7, 0);

    scene.add(new THREE.HemisphereLight(0x7acbff, 0x01030a, 1.45));
    const sun = new THREE.DirectionalLight(0x9dc8ff, 3.4); sun.position.set(-10, 20, 8); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -20; sun.shadow.camera.right = 20; sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18; scene.add(sun);
    const rim = new THREE.DirectionalLight(0x00d9ff, 3.2); rim.position.set(12, 7, -12); scene.add(rim);
    const royalRim = new THREE.DirectionalLight(0x1545ff, 1.6); royalRim.position.set(-10, 5, -8); scene.add(royalRim);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, WORLD_D), new THREE.MeshStandardMaterial({ color: 0x071225, roughness: 0.9, metalness: 0.16 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = "planning-ground"; scene.add(ground);
    const skirt = box(WORLD_W + 0.5, 0.6, WORLD_D + 0.5, 0x030816); skirt.position.y = -0.34; skirt.receiveShadow = true; scene.add(skirt);
    const grid = new THREE.GridHelper(WORLD_W, 48, 0x008dff, 0x12315a); grid.position.y = 0.015; (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.29; scene.add(grid);

    const river = new THREE.Mesh(new THREE.PlaneGeometry(3.2, WORLD_D + 0.2), new THREE.MeshPhysicalMaterial({ color: 0x006dca, emissive: 0x003b78, emissiveIntensity: 0.55, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.74, transmission: 0.16 })); river.rotation.x = -Math.PI / 2; river.position.set(9.3, 0.055, 0); scene.add(river);
    [[0, 0, WORLD_W, 1.15], [-3.5, 0, 1.15, WORLD_D], [4.2, -2, 1.05, WORLD_D], [0, 5.2, WORLD_W, 0.85]].forEach(([x, z, width, depth]) => { const road = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ color: 0x091327, roughness: 0.84, metalness: 0.2 })); road.rotation.x = -Math.PI / 2; road.position.set(x, 0.07, z); road.receiveShadow = true; scene.add(road); });

    const buildingsGroup = new THREE.Group(); const assetsGroup = new THREE.Group(); const plansGroup = new THREE.Group(); const utilitiesGroup = new THREE.Group(); const simulationGroup = new THREE.Group(); const sensorGroup = new THREE.Group(); scene.add(buildingsGroup, assetsGroup, plansGroup, utilitiesGroup, simulationGroup, sensorGroup);
    propsRef.current.buildings.forEach((building) => {
      const height = Math.max(0.8, building.h / 28); const width = Math.max(1.1, building.w / 30); const depth = Math.max(1, building.d / 31);
      const group = new THREE.Group(); group.userData.buildingId = building.id; group.position.copy(toWorld({ x: building.x, y: building.y }));
      const main = box(width, height, depth, toneColors[building.tone] ?? 0x245c9a, 0.42); main.material = new THREE.MeshPhysicalMaterial({ color: 0x082347, emissive: toneColors[building.tone] ?? 0x168cff, emissiveIntensity: 0.12, roughness: 0.4, metalness: 0.5, transparent: true, opacity: 0.88 }); main.userData.buildingId = building.id; group.add(main);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(main.geometry), new THREE.LineBasicMaterial({ color: toneColors[building.tone] ?? 0x22bfff, transparent: true, opacity: 0.75 })); edges.position.y = height / 2; edges.userData.buildingId = building.id; group.add(edges);
      const roof = box(width * 0.72, 0.1, depth * 0.72, 0x00b7ff, 0.6); roof.position.y = height + 0.06; roof.userData.buildingId = building.id; group.add(roof);
      for (let floor = 0.38; floor < height; floor += 0.48) { const band = box(width + 0.018, 0.035, depth + 0.02, 0x00ddff, 0.45); band.position.y = floor; band.userData.buildingId = building.id; group.add(band); }
      buildingsGroup.add(group);
    });

    for (let index = 0; index < 34; index += 1) {
      const x = -11 + ((index * 7.13) % 20); const z = -8 + ((index * 4.77) % 16); if (Math.abs(x) < 0.9 || x > 7.5) continue;
      const tree = new THREE.Group(); const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 0.5, 7), new THREE.MeshStandardMaterial({ color: 0x102845 })); trunk.position.y = 0.25; tree.add(trunk); const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.31 + (index % 3) * 0.05, 1), new THREE.MeshStandardMaterial({ color: index % 2 ? 0x0c5372 : 0x0b3e63, emissive: 0x006b8e, emissiveIntensity: 0.14, roughness: 0.8 })); crown.position.y = 0.67; crown.castShadow = true; tree.add(crown); tree.position.set(x, 0, z); scene.add(tree);
    }

    const scanPositions = new Float32Array(900 * 3); const scanColors = new Float32Array(900 * 3);
    for (let index = 0; index < 900; index += 1) { const x = -11.5 + ((index * 1.731) % 6.8); const z = -8.4 + ((index * 2.417) % 5.1); const y = 0.11 + Math.sin(x * 1.8) * 0.08 + Math.cos(z * 2.2) * 0.06; scanPositions.set([x, y, z], index * 3); const bright = index % 7 === 0; scanColors.set(bright ? [0.15, 0.35, 1] : [0.0, 0.72, 1], index * 3); }
    const scanGeometry = new THREE.BufferGeometry(); scanGeometry.setAttribute("position", new THREE.BufferAttribute(scanPositions, 3)); scanGeometry.setAttribute("color", new THREE.BufferAttribute(scanColors, 3)); const scanCloud = new THREE.Points(scanGeometry, new THREE.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, opacity: 0.7 })); scanCloud.position.y = 0.04; scene.add(scanCloud);

    const vehiclesGroup = new THREE.Group();
    [0x6e9de8, 0x155fff, 0x00dfff, 0xffffff].forEach((color, index) => { const vehicle = new THREE.Group(); const body = box(0.64, 0.24, 0.34, color, 0.42); vehicle.add(body); const cabin = box(0.29, 0.18, 0.3, 0xb8eaff, 0.28); cabin.position.set(-0.05, 0.3, 0); vehicle.add(cabin); vehicle.userData.offset = index * 6.2; vehicle.userData.speed = 0.8 + index * 0.12; vehiclesGroup.add(vehicle); }); scene.add(vehiclesGroup);

    for (let index = 0; index < 14; index += 1) {
      const beacon = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.72, 8), new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.7 })); stem.position.y = 0.36; beacon.add(stem);
      const pulse = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.16, 24), new THREE.MeshBasicMaterial({ color: 0x00e5ff, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })); pulse.rotation.x = -Math.PI / 2; pulse.position.y = 0.04; pulse.userData.pulse = index * 0.37; beacon.add(pulse);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), new THREE.MeshBasicMaterial({ color: 0xc8f7ff })); light.position.y = 0.76; beacon.add(light);
      beacon.position.set(-10 + ((index * 4.91) % 19), 0, -7 + ((index * 3.77) % 14)); sensorGroup.add(beacon);
    }

    const sewerScenario = new THREE.Group(); sewerScenario.userData.kind = "sewer";
    const sewerPoints = [{ x: 7, y: 78 }, { x: 28, y: 68 }, { x: 44, y: 52 }, { x: 63, y: 64 }, { x: 86, y: 39 }];
    const sewerTube = makePath(sewerPoints, "sewer"); if (sewerTube) sewerScenario.add(sewerTube);
    sewerPoints.forEach((point, index) => { const node = new THREE.Mesh(new THREE.SphereGeometry(index === 2 ? 0.22 : 0.13, 16, 16), new THREE.MeshStandardMaterial({ color: 0x4f6fff, emissive: 0x4f6fff, emissiveIntensity: 1.2, roughness: 0.25 })); node.position.copy(toWorld(point)); node.position.y = 0.2; node.userData.riskNode = index === 2; sewerScenario.add(node); });
    simulationGroup.add(sewerScenario);

    const floodScenario = new THREE.Group(); floodScenario.userData.kind = "flood";
    [[8.8, -2.2, 4.7, 6.4], [6.8, 4.5, 3.7, 3.2], [7.8, -6.1, 3.4, 2.4]].forEach(([x, z, width, depth], index) => { const zone = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: index ? 0x0078ff : 0x00c8ff, transparent: true, opacity: 0.2, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); zone.rotation.x = -Math.PI / 2; zone.scale.set(width, depth, 1); zone.position.set(x, 0.12 + index * 0.01, z); zone.userData.floodZone = true; zone.userData.baseScale = [width, depth]; floodScenario.add(zone); });
    simulationGroup.add(floodScenario);

    const evacuationScenario = new THREE.Group(); evacuationScenario.userData.kind = "evacuation";
    const routeSets = [[{ x: 12, y: 72 }, { x: 32, y: 55 }, { x: 52, y: 50 }, { x: 79, y: 20 }], [{ x: 18, y: 24 }, { x: 38, y: 39 }, { x: 61, y: 40 }, { x: 84, y: 18 }]];
    routeSets.forEach((points, routeIndex) => { const route = makePath(points, "water"); if (route) { (route.material as THREE.MeshStandardMaterial).color.set(routeIndex ? 0x00e5ff : 0x1e6fff); (route.material as THREE.MeshStandardMaterial).emissive.set(routeIndex ? 0x00e5ff : 0x1e6fff); route.userData.route = true; evacuationScenario.add(route); } const curve = new THREE.CatmullRomCurve3(points.map((point) => { const p = toWorld(point); p.y = 0.32; return p; })); for (let agent = 0; agent < 7; agent += 1) { const dot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 10), new THREE.MeshBasicMaterial({ color: 0xe8f7ff })); dot.userData.routeCurve = curve; dot.userData.offset = agent / 7 + routeIndex * 0.11; evacuationScenario.add(dot); } });
    simulationGroup.add(evacuationScenario);

    const scanPlane = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, 0.8), new THREE.MeshBasicMaterial({ color: 0x00d9ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); scanPlane.rotation.x = -Math.PI / 2; scanPlane.position.y = 0.32; scanPlane.visible = false; scene.add(scanPlane);

    const ghost = createPrefab(propsRef.current.selectedAsset); ghost.visible = false; ghost.traverse((child) => { if (child instanceof THREE.Mesh) { const materials = Array.isArray(child.material) ? child.material : [child.material]; materials.forEach((material) => { material.transparent = true; material.opacity = 0.48; }); } }); scene.add(ghost);
    runtimeRef.current = { scene, camera, renderer, controls, ground, buildingsGroup, assetsGroup, plansGroup, utilitiesGroup, simulationGroup, sensorGroup, scanPlane, ghost, assetObjects: new Map() };

    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let movingId: number | null = null; let moved = false;
    const raycast = (event: PointerEvent) => { const rect = renderer.domElement.getBoundingClientRect(); pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1); raycaster.setFromCamera(pointer, camera); return raycaster; };
    const groundPoint = (event: PointerEvent) => raycast(event).intersectObject(ground, false)[0]?.point;
    const findId = (object: THREE.Object3D | null, field: string): number | null => { let current = object; while (current) { if (typeof current.userData[field] === "number") return current.userData[field]; current = current.parent; } return null; };
    const onPointerDown = (event: PointerEvent) => {
      moved = false;
      if (propsRef.current.tool !== "select") return;
      const hit = raycast(event).intersectObjects(assetsGroup.children, true)[0]; const id = findId(hit?.object ?? null, "assetId");
      if (id !== null) { movingId = id; controls.enabled = false; propsRef.current.onSelectAsset(id); renderer.domElement.setPointerCapture(event.pointerId); }
    };
    const onPointerMove = (event: PointerEvent) => {
      const point = groundPoint(event); if (!point) return;
      if (movingId !== null) { moved = true; propsRef.current.onMoveAsset(movingId, toPercent(point)); return; }
      if (propsRef.current.tool === "asset") { ghost.position.copy(point); ghost.visible = true; }
      else ghost.visible = false;
    };
    const onPointerUp = (event: PointerEvent) => { if (movingId !== null) { movingId = null; controls.enabled = true; if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId); } };
    const onClick = (event: MouseEvent) => {
      if (moved) { moved = false; return; }
      const current = propsRef.current;
      if (["asset", "line", "area", "building"].includes(current.tool)) { const point = groundPoint(event as PointerEvent); if (point) current.onMapPoint(toPercent(point)); return; }
      const assetHit = raycast(event as PointerEvent).intersectObjects(assetsGroup.children, true)[0]; const assetId = findId(assetHit?.object ?? null, "assetId"); if (assetId !== null) { current.onSelectAsset(assetId); return; }
      const buildingHit = raycast(event as PointerEvent).intersectObjects(buildingsGroup.children, true)[0]; const buildingId = findId(buildingHit?.object ?? null, "buildingId"); if (buildingId !== null) current.onSelectBuilding(buildingId);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown); renderer.domElement.addEventListener("pointermove", onPointerMove); renderer.domElement.addEventListener("pointerup", onPointerUp); renderer.domElement.addEventListener("pointerleave", () => { if (movingId === null) ghost.visible = false; }); renderer.domElement.addEventListener("click", onClick);

    const resize = () => { const width = host.clientWidth; const height = host.clientHeight; renderer.setSize(width, height, false); camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(host); resize();
    let frame = 0; const timer = new THREE.Timer(); timer.connect(document);
    const animate = (timestamp?: number) => {
      frame = requestAnimationFrame(animate);
      timer.update(timestamp);
      const time = timer.getElapsed();
      const current = propsRef.current;
      controls.update();
      const projectedAnnotations = current.annotations.map((annotation) => {
        const element = annotationRefs.current.get(annotation.id);
        if (!element) return null;
        const position = toWorld(annotation.point);
        position.y = annotation.height;
        const distance = camera.position.distanceTo(position);
        position.project(camera);
        const visible = position.z > -1 && position.z < 1 && Math.abs(position.x) < 1.12 && Math.abs(position.y) < 1.12;
        if (!visible) { element.dataset.visible = "false"; return null; }
        const x = (position.x * 0.5 + 0.5) * host.clientWidth;
        const y = (-position.y * 0.5 + 0.5) * host.clientHeight;
        const scale = THREE.MathUtils.clamp(18 / Math.max(distance, 1), 0.78, 1);
        return { annotation, element, x, y, scale };
      }).filter((item): item is NonNullable<typeof item> => item !== null).sort((a, b) => {
        const rank = { incident: 0, sensor: 1, worksite: 2 };
        return rank[a.annotation.kind] - rank[b.annotation.kind];
      });
      const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
      projectedAnnotations.forEach(({ element, x, y, scale }) => {
        const width = (element.offsetWidth || 126) * scale;
        const height = (element.offsetHeight || 50) * scale;
        const bounds = { left: x - width / 2 - 5, right: x + width / 2 + 5, top: y - height - 5, bottom: y + 5 };
        const collides = occupied.some((box) => bounds.left < box.right && bounds.right > box.left && bounds.top < box.bottom && bounds.bottom > box.top);
        element.dataset.visible = collides ? "false" : "true";
        if (collides) return;
        occupied.push(bounds);
        element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%) scale(${scale})`;
      });
      river.position.y = 0.055 + Math.sin(time * 1.2) * 0.008;
      scanCloud.rotation.y = Math.sin(time * 0.08) * 0.015;
      ghost.rotation.y = time * 0.35;
      vehiclesGroup.visible = current.layers.mobility || current.activeScenario === "evacuation";
      vehiclesGroup.children.forEach((vehicle) => { vehicle.position.set(((time * vehicle.userData.speed + vehicle.userData.offset) % 22) - 11, 0.09, 0); });
      sensorGroup.visible = current.layers.sensors;
      sensorGroup.children.forEach((beacon) => { const pulse = beacon.children.find((child) => child.userData.pulse !== undefined); if (pulse) { const cycle = (time * 0.65 + pulse.userData.pulse) % 1; pulse.scale.setScalar(0.7 + cycle * 2.1); if (pulse instanceof THREE.Mesh && pulse.material instanceof THREE.MeshBasicMaterial) pulse.material.opacity = 0.75 * (1 - cycle); } });
      simulationGroup.children.forEach((group) => {
        group.visible = group.userData.kind === current.activeScenario;
        if (!group.visible) return;
        group.children.forEach((child, index) => {
          if (child.userData.floodZone && child instanceof THREE.Mesh) { const [sx, sy] = child.userData.baseScale as [number, number]; const pressure = 1 + (current.population - 1500) / 4000; const pulse = 1 + Math.sin(time * 1.3 + index) * 0.035; child.scale.set(sx * pressure * pulse, sy * pressure * pulse, 1); const material = child.material as THREE.MeshBasicMaterial; material.opacity = 0.16 + Math.sin(time * 1.7 + index) * 0.045 + (current.simulationComplete ? 0.08 : 0); }
          if (child.userData.riskNode && child instanceof THREE.Mesh) { const risky = current.population >= 2200; const material = child.material as THREE.MeshStandardMaterial; material.color.set(risky ? 0xffffff : 0x4f6fff); material.emissive.set(risky ? 0x00dfff : 0x4f6fff); child.scale.setScalar(1 + Math.sin(time * (risky ? 5 : 2.2)) * (risky ? 0.24 : 0.1)); }
          if (child.userData.routeCurve && child instanceof THREE.Mesh) { const speed = current.incidentActive ? 0.12 : 0.08; const t = (time * speed + child.userData.offset) % 1; child.position.copy((child.userData.routeCurve as THREE.CatmullRomCurve3).getPoint(t)); }
        });
      });
      scanPlane.visible = current.simulationRunning;
      if (scanPlane.visible) scanPlane.position.z = -WORLD_D / 2 + ((time * 5) % WORLD_D);
      utilitiesGroup.children.forEach((child, index) => { if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) child.material.emissiveIntensity = 0.28 + Math.sin(time * 2.4 + index) * 0.15; });
      assetsGroup.children.forEach((child) => { const ring = child.getObjectByName("selection-ring"); if (ring) ring.rotation.z = time * 0.65; });
      renderer.render(scene, camera);
    }; animate();

    return () => { observer.disconnect(); cancelAnimationFrame(frame); timer.dispose(); controls.dispose(); renderer.dispose(); scene.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((material) => material.dispose()); } }); renderer.domElement.remove(); runtimeRef.current = null; };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime) return;
    runtime.buildingsGroup.visible = props.layers.buildings;
    runtime.buildingsGroup.children.forEach((group) => { const selected = group.userData.buildingId === props.selectedBuildingId; group.traverse((child) => { if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) child.material.emissiveIntensity = selected ? 0.2 : 0; }); });
  }, [props.layers.buildings, props.selectedBuildingId]);

  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime) return;
    clearGroup(runtime.utilitiesGroup);
    props.drawnAreas.forEach((area) => { if (area.points.length < 3) return; const shape = new THREE.Shape(area.points.map((point) => new THREE.Vector2(toWorld(point).x, toWorld(point).z))); const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0x00dfff, transparent: true, opacity: 0.15, side: THREE.DoubleSide })); mesh.rotation.x = Math.PI / 2; mesh.position.y = 0.09; runtime.utilitiesGroup.add(mesh); });
    props.drawnLines.forEach((line) => { const path = makePath(line.points, line.kind); if (path) runtime.utilitiesGroup.add(path); });
    if (props.tool === "line" && props.draftPoints.length > 1) { const draft = makePath(props.draftPoints, props.lineKind, true); if (draft) runtime.utilitiesGroup.add(draft); }
    if (props.layers.sewer) { const sewer = makePath([{ x: 8, y: 78 }, { x: 38, y: 63 }, { x: 62, y: 65 }, { x: 87, y: 38 }], "sewer"); if (sewer) runtime.utilitiesGroup.add(sewer); }
    if (props.layers.power) { const power = makePath([{ x: 14, y: 25 }, { x: 43, y: 36 }, { x: 66, y: 47 }, { x: 86, y: 70 }], "power"); if (power) runtime.utilitiesGroup.add(power); }
  }, [props.drawnAreas, props.drawnLines, props.draftPoints, props.lineKind, props.layers.power, props.layers.sewer, props.tool]);

  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime) return;
    clearGroup(runtime.plansGroup);
    props.plannedBuildings.forEach((building) => { const group = new THREE.Group(); group.position.copy(toWorld(building)); const height = 0.35 + building.floors * 0.22; const mass = box(1.5, height, 1.3, 0x245dcb); mass.material = new THREE.MeshStandardMaterial({ color: 0x245dcb, emissive: 0x00dfff, emissiveIntensity: 0.12, transparent: true, opacity: 0.82, roughness: 0.7 }); group.add(mass); runtime.plansGroup.add(group); });
  }, [props.plannedBuildings]);

  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime) return;
    clearGroup(runtime.assetsGroup); runtime.assetObjects.clear(); const loader = new GLTFLoader(); let cancelled = false;
    propsRef.current.placedAssets.forEach((placed) => {
      const group = createPrefab(placed.asset); group.userData.assetId = placed.id; group.traverse((child) => { child.userData.assetId = placed.id; }); runtime.assetsGroup.add(group); runtime.assetObjects.set(placed.id, group);
      if (placed.asset.file) loader.load(placed.asset.file, (gltf) => { if (cancelled || !runtime.assetObjects.has(placed.id)) return; const model = gltf.scene; model.rotation.x = -Math.PI / 2; model.updateMatrixWorld(true); const bounds = new THREE.Box3().setFromObject(model); const size = bounds.getSize(new THREE.Vector3()); const center = bounds.getCenter(new THREE.Vector3()); model.position.sub(center); const scale = 3.4 / Math.max(size.x, size.y, size.z, 0.01); model.scale.setScalar(scale); model.position.y = 0.16; model.traverse((child) => { child.userData.assetId = placed.id; if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } }); [...group.children].filter((child) => child.name !== "selection-ring").forEach((child) => { group.remove(child); disposeObject(child); }); group.add(model); }, undefined, () => undefined);
    });
    return () => { cancelled = true; };
  }, [shapeKey]);

  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime) return;
    props.placedAssets.forEach((placed) => { const group = runtime.assetObjects.get(placed.id); if (!group) return; group.position.copy(toWorld(placed)); group.rotation.y = THREE.MathUtils.degToRad(-placed.rotation); group.scale.setScalar(placed.scale); const ring = group.getObjectByName("selection-ring"); if (ring) ring.visible = placed.id === props.selectedPlacedAssetId; });
  }, [props.placedAssets, props.selectedPlacedAssetId]);

  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime) return;
    runtime.camera.position.set(18 / props.zoom, 16 / props.zoom, 19 / props.zoom); runtime.controls.update();
  }, [props.zoom]);

  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime) return;
    clearGroup(runtime.ghost);
    const replacement = createPrefab(props.selectedAsset);
    while (replacement.children.length) runtime.ghost.add(replacement.children[0]);
    runtime.ghost.traverse((child) => { if (child instanceof THREE.Mesh) { const materials = Array.isArray(child.material) ? child.material : [child.material]; materials.forEach((material) => { material.transparent = true; material.opacity = 0.48; }); } });
    runtime.ghost.visible = false;
  }, [props.selectedAsset]);

  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime) return;
    runtime.controls.enabled = ["select", "orbit", "measure"].includes(props.tool);
    if (props.tool !== "asset") runtime.ghost.visible = false;
  }, [props.tool]);

  return <div className="city-engine" ref={hostRef}>
    <div className="engine-annotation-layer" aria-label="World anchored district observations">
      {props.annotations.map((annotation) => <button
        key={annotation.id}
        ref={(element) => { if (element) annotationRefs.current.set(annotation.id, element); else annotationRefs.current.delete(annotation.id); }}
        className={`engine-annotation annotation-${annotation.kind}`}
        data-annotation={annotation.id}
        data-visible="false"
        onClick={() => props.onAnnotationSelect(annotation.id)}
        aria-label={`${annotation.label}: ${annotation.value}, ${annotation.detail}`}
      ><span className="annotation-stem" /><span className="annotation-content"><small>{annotation.label}</small><strong>{annotation.value}</strong><em>{annotation.detail}</em></span></button>)}
    </div>
    <div className="engine-badge"><i /> SPATIAL MODEL ONLINE</div><div className="engine-help">DRAG TO ORBIT · SCROLL TO ZOOM · CLICK TO INSPECT</div>
  </div>;
}
