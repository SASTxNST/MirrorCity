"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type MetricReading = { value: number; unit: string; recordedAt: string };

type SensorState = {
  sensorId: number;
  hardwareId: string;
  name: string;
  type: string;
  x: number; // 0–1 normalised room position
  y: number;
  z: number;
  active: boolean;
  readings: Partial<{
    temperature: MetricReading;
    humidity: MetricReading;
    occupancy: MetricReading;
    co2: MetricReading;
  }>;
};

type HistoryPoint = { value: number; unit: string; recordedAt: string };
type RoomMeta = { id: number; name: string; glbPath: string; widthM: number; depthM: number; heightM: number };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROOM_ID = 1; // change this if you have multiple rooms
const POLL_INTERVAL_MS = 10_000;

function co2Level(ppm: number): { label: string; color: string } {
  if (ppm < 800) return { label: "Good", color: "#c9f36d" };
  if (ppm < 1200) return { label: "Fair", color: "#ffbb38" };
  return { label: "Poor", color: "#ff6b5e" };
}

function tempColor(celsius: number): string {
  if (celsius < 22) return "#50d2c5";
  if (celsius < 28) return "#c9f36d";
  if (celsius < 32) return "#ffbb38";
  return "#ff6b5e";
}

function ageLabel(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function buildProceduralRoom(scene: THREE.Scene, room: RoomMeta) {
  const w = room.widthM;
  const d = room.depthM;
  const h = room.heightM;
  const group = new THREE.Group();

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2d3b35, roughness: 0.85 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1e2b26, roughness: 0.9, side: THREE.BackSide });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x3a4f46, roughness: 0.6, emissive: 0x3a4f46, emissiveIntensity: 0.05 });

  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Room shell (walls + ceiling via BackSide)
  const shell = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
  shell.position.y = h / 2;
  group.add(shell);

  // Floor edge trim
  [[0, 0, d / 2], [0, 0, -d / 2], [w / 2, 0, 0], [-w / 2, 0, 0]].forEach(([x, y, z], i) => {
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(i < 2 ? w : 0.06, 0.06, i < 2 ? 0.06 : d),
      edgeMat
    );
    edge.position.set(x, (y ?? 0) + 0.03, z);
    group.add(edge);
  });

  // Grid lines on floor
  const gridHelper = new THREE.GridHelper(Math.max(w, d), Math.max(w, d), 0x2f4040, 0x2a3830);
  gridHelper.position.y = 0.002;
  group.add(gridHelper);

  scene.add(group);
  return group;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RoomTwin() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const labelRootRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    labelRenderer: CSS2DRenderer;
    controls: OrbitControls;
    labelObjects: Map<number, CSS2DObject>;
    rafId: number;
  } | null>(null);

  const [sensors, setSensors] = useState<SensorState[]>([]);
  const [room, setRoom] = useState<RoomMeta | null>(null);
  const [selectedSensor, setSelectedSensor] = useState<SensorState | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [historyMetric, setHistoryMetric] = useState<"temperature" | "humidity" | "co2">("temperature");
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  // ── Load room meta ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/rooms")
      .then((r) => r.json())
      .then((rows: RoomMeta[]) => {
        if (rows.length > 0) setRoom(rows[0]);
        else {
          // Auto-create room 1 if not in DB yet
          return fetch("/api/rooms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "SAST Lab", widthM: 8, depthM: 6, heightM: 3 }),
          })
            .then((r) => r.json())
            .then((r: RoomMeta) => setRoom(r));
        }
      })
      .catch(() => {
        // Offline — use defaults
        setRoom({ id: ROOM_ID, name: "SAST Lab (offline)", glbPath: "/models/room/room.glb", widthM: 8, depthM: 6, heightM: 3 });
      });
  }, []);

  // ── Poll sensor readings ────────────────────────────────────────────────────
  const pollSensors = useCallback(async () => {
    try {
      const res = await fetch(`/api/sensor-readings?roomId=${ROOM_ID}`);
      if (!res.ok) throw new Error("API error");
      const data = (await res.json()) as SensorState[];
      setSensors(data);
      setLastPoll(new Date());
      setOffline(false);

      // Update 3D label content for each sensor
      const rt = runtimeRef.current;
      if (!rt) return;
      data.forEach((s) => {
        const labelObj = rt.labelObjects.get(s.sensorId);
        if (labelObj) {
          const el = labelObj.element as HTMLDivElement;
          el.querySelector(".badge-temp")!.textContent =
            s.readings.temperature ? `${s.readings.temperature.value.toFixed(1)} °C` : "—";
          el.querySelector(".badge-hum")!.textContent =
            s.readings.humidity ? `${s.readings.humidity.value.toFixed(0)} %` : "—";
          el.querySelector(".badge-occ")!.textContent =
            s.readings.occupancy ? (s.readings.occupancy.value ? "● Occupied" : "○ Empty") : "—";
          const tempVal = s.readings.temperature?.value ?? 0;
          const dot = el.querySelector(".badge-dot") as HTMLElement | null;
          if (dot) dot.style.background = s.active ? tempColor(tempVal) : "#555";
        }
      });
    } catch {
      setOffline(true);
    }
  }, []);

  // Poll on mount and every POLL_INTERVAL_MS
  useEffect(() => {
    pollSensors().finally(() => setLoading(false));
    const id = window.setInterval(pollSensors, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [pollSensors]);

  // ── Load history when sensor selected ──────────────────────────────────────
  useEffect(() => {
    if (!selectedSensor) { setHistory([]); return; }
    fetch(`/api/sensor-readings/history?sensorId=${selectedSensor.sensorId}&metric=${historyMetric}&hours=6`)
      .then((r) => r.json())
      .then((d: { data: HistoryPoint[] }) => setHistory(d.data ?? []))
      .catch(() => setHistory([]));
  }, [selectedSensor, historyMetric]);

  // ── Three.js scene setup ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const labelRoot = labelRootRef.current;
    if (!canvas || !labelRoot || !room) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x17201d);
    scene.fog = new THREE.FogExp2(0x17201d, 0.04);

    // Camera
    const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
    camera.position.set(room.widthM * 0.9, room.heightM * 1.1, room.depthM * 0.9);

    // WebGL renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    canvas.appendChild(renderer.domElement);

    // CSS2D renderer for HTML overlays
    const labelRenderer = new CSS2DRenderer({ element: labelRoot });
    labelRenderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI * 0.55;
    controls.minDistance = 2;
    controls.maxDistance = 20;
    controls.target.set(0, room.heightM * 0.3, 0);

    // Lights
    scene.add(new THREE.HemisphereLight(0xdff5e8, 0x1c2924, 1.4));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(1024);
    scene.add(sun);
    // Soft fill from below
    const fill = new THREE.PointLight(0x4b8f83, 1.2, 12);
    fill.position.set(-room.widthM / 3, 0.3, room.depthM / 3);
    scene.add(fill);

    const labelObjects = new Map<number, CSS2DObject>();

    // Try to load GLB, fall back to procedural room
    const loader = new GLTFLoader();
    loader.load(
      room.glbPath,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gltf: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        gltf.scene.traverse((child: any) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        // Auto-scale to room dimensions
        const bbox = new THREE.Box3().setFromObject(gltf.scene);
        const size = bbox.getSize(new THREE.Vector3());
        const scale = Math.min(room!.widthM / size.x, room!.heightM / size.y, room!.depthM / size.z) * 0.92;
        gltf.scene.scale.setScalar(scale);
        const center = bbox.getCenter(new THREE.Vector3()).multiplyScalar(scale);
        gltf.scene.position.sub(center).add(new THREE.Vector3(0, size.y * scale * 0.5, 0));
        scene.add(gltf.scene);
      },
      undefined,
      () => {
        // GLB not found — build a procedural room
        buildProceduralRoom(scene, room);
      }
    );

    // ── Sensor label factory ───────────────────────────────────────────────────
    function createSensorLabel(sensor: SensorState): CSS2DObject {
      const div = document.createElement("div");
      div.className = "sensor-badge";
      div.innerHTML = `
        <div class="badge-header">
          <span class="badge-dot"></span>
          <span class="badge-name">${sensor.name}</span>
        </div>
        <div class="badge-row"><span class="badge-icon">🌡</span><span class="badge-temp">—</span></div>
        <div class="badge-row"><span class="badge-icon">💧</span><span class="badge-hum">—</span></div>
        <div class="badge-row"><span class="badge-occ">—</span></div>
      `;
      div.addEventListener("click", () => {
        setSensors((current) => {
          const found = current.find((s) => s.sensorId === sensor.sensorId);
          if (found) setSelectedSensor(found);
          return current;
        });
      });
      const label = new CSS2DObject(div);
      // Convert normalised 0–1 room coords to Three.js world coords
      label.position.set(
        (sensor.x - 0.5) * (room?.widthM ?? 8),
        sensor.y * (room?.heightM ?? 3),
        (sensor.z - 0.5) * (room?.depthM ?? 6)
      );
      scene.add(label);
      labelObjects.set(sensor.sensorId, label);
      return label;
    }

    // Seed labels for any sensors already loaded
    sensors.forEach((s) => createSensorLabel(s));

    // Expose label factory so pollSensors can add new ones
    (window as unknown as Record<string, unknown>).__mcCreateSensorLabel = createSensorLabel;

    // ── Render loop ────────────────────────────────────────────────────────────
    let rafId = 0;
    function animate() {
      rafId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    }
    animate();

    // Resize handler
    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
    });
    ro.observe(canvas);

    runtimeRef.current = { scene, camera, renderer, labelRenderer, controls, labelObjects, rafId };

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.dispose();
      canvas.removeChild(renderer.domElement);
      delete (window as unknown as Record<string, unknown>).__mcCreateSensorLabel;
      runtimeRef.current = null;
    };
  }, [room]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add label objects for newly discovered sensors
  useEffect(() => {
    const rt = runtimeRef.current;
    const factory = (window as unknown as Record<string, unknown>).__mcCreateSensorLabel as ((s: SensorState) => void) | undefined;
    if (!rt || !factory) return;
    sensors.forEach((s) => {
      if (!rt.labelObjects.has(s.sensorId)) factory(s);
    });
  }, [sensors]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading && sensors.length === 0) {
    return (
      <div className="room-loading">
        <i /><i /><i />
        <span>Connecting to room twin…</span>
      </div>
    );
  }

  // Sparkline from history
  const sparkMax = Math.max(...history.map((h) => h.value), 1);
  const sparkMin = Math.min(...history.map((h) => h.value), 0);
  const sparkRange = sparkMax - sparkMin || 1;
  const sparkPoints = history
    .map((h, i) => `${(i / Math.max(history.length - 1, 1)) * 200},${60 - ((h.value - sparkMin) / sparkRange) * 55}`)
    .join(" ");

  return (
    <div className="room-shell">
      {/* ── 3D canvas ─────────────────────────────────────────────────────── */}
      <div ref={canvasRef} className="room-canvas" />
      {/* CSS2DRenderer overlay — must sit on top of the canvas, pointer-events passthrough */}
      <div ref={labelRootRef} className="room-label-root" />

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <header className="room-topbar">
        <div className="room-topbar-left">
          <a href="/" className="room-back">← City twin</a>
          <span className="room-title">{room?.name ?? "Room Twin"}</span>
          {room && <span className="room-dims">{room.widthM} × {room.depthM} × {room.heightM} m</span>}
        </div>
        <div className="room-topbar-right">
          {offline && <span className="room-offline">⚡ API offline — last known data</span>}
          {lastPoll && !offline && (
            <span className="room-freshness">
              Live · {ageLabel(lastPoll.toISOString())}
            </span>
          )}
          <span className="room-sensor-count">{sensors.length} node{sensors.length !== 1 ? "s" : ""}</span>
        </div>
      </header>

      {/* ── Sensor list sidebar ───────────────────────────────────────────── */}
      <aside className="room-sidebar">
        <p className="room-sidebar-heading">Sensor nodes</p>
        {sensors.length === 0 && (
          <p className="room-no-sensors">No sensors registered yet.<br />Flash your ESP8266 and it will appear here.</p>
        )}
        {sensors.map((s) => {
          const t = s.readings.temperature;
          const h = s.readings.humidity;
          const o = s.readings.occupancy;
          const c = s.readings.co2;
          const isSelected = selectedSensor?.sensorId === s.sensorId;
          return (
            <button
              key={s.sensorId}
              className={`room-sensor-card ${isSelected ? "selected" : ""} ${!s.active ? "inactive" : ""}`}
              onClick={() => setSelectedSensor(isSelected ? null : s)}
            >
              <div className="rsc-header">
                <span className="rsc-dot" style={{ background: t ? tempColor(t.value) : "#555" }} />
                <span className="rsc-name">{s.name}</span>
                <span className="rsc-id">{s.hardwareId}</span>
              </div>
              <div className="rsc-readings">
                {t && <span style={{ color: tempColor(t.value) }}>{t.value.toFixed(1)} °C</span>}
                {h && <span>{h.value.toFixed(0)} % RH</span>}
                {o && <span>{o.value ? "● Occupied" : "○ Empty"}</span>}
                {c && <span style={{ color: co2Level(c.value).color }}>{c.value.toFixed(0)} ppm</span>}
              </div>
              {t && <div className="rsc-age">{ageLabel(t.recordedAt)}</div>}
            </button>
          );
        })}
      </aside>

      {/* ── Selected sensor detail panel ──────────────────────────────────── */}
      {selectedSensor && (
        <div className="room-detail">
          <div className="room-detail-header">
            <strong>{selectedSensor.name}</strong>
            <button onClick={() => setSelectedSensor(null)}>✕</button>
          </div>

          <div className="room-detail-grid">
            {selectedSensor.readings.temperature && (
              <div className="rdg-cell">
                <small>Temperature</small>
                <strong style={{ color: tempColor(selectedSensor.readings.temperature.value) }}>
                  {selectedSensor.readings.temperature.value.toFixed(1)} °C
                </strong>
              </div>
            )}
            {selectedSensor.readings.humidity && (
              <div className="rdg-cell">
                <small>Humidity</small>
                <strong>{selectedSensor.readings.humidity.value.toFixed(0)} %</strong>
              </div>
            )}
            {selectedSensor.readings.occupancy && (
              <div className="rdg-cell">
                <small>Occupancy</small>
                <strong>{selectedSensor.readings.occupancy.value ? "Occupied" : "Empty"}</strong>
              </div>
            )}
            {selectedSensor.readings.co2 && (() => {
              const lvl = co2Level(selectedSensor.readings.co2.value);
              return (
                <div className="rdg-cell">
                  <small>CO₂</small>
                  <strong style={{ color: lvl.color }}>{selectedSensor.readings.co2.value.toFixed(0)} ppm · {lvl.label}</strong>
                </div>
              );
            })()}
          </div>

          {/* Metric selector for chart */}
          <div className="room-chart-tabs">
            {(["temperature", "humidity", "co2"] as const).map((m) => (
              <button key={m} className={historyMetric === m ? "active" : ""} onClick={() => setHistoryMetric(m)}>
                {m === "temperature" ? "Temp" : m === "humidity" ? "Humid" : "CO₂"}
              </button>
            ))}
          </div>

          {/* Sparkline */}
          {history.length > 1 ? (
            <svg className="room-sparkline" viewBox="0 0 200 60" preserveAspectRatio="none">
              <defs>
                <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#c9f36d" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#c9f36d" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon
                points={`0,60 ${sparkPoints} 200,60`}
                fill="url(#sg)"
              />
              <polyline
                points={sparkPoints}
                fill="none"
                stroke="#c9f36d"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <text x="2" y="10" fontSize="7" fill="#8a9e8a">
                {history[history.length - 1]?.value.toFixed(1)} {history[0]?.unit}
              </text>
              <text x="2" y="58" fontSize="7" fill="#8a9e8a">
                {history.length} readings · last 6h
              </text>
            </svg>
          ) : (
            <p className="room-no-history">No history yet — readings accumulate after the first poll.</p>
          )}

          <div className="room-detail-pos">
            <small>Position in room</small>
            <span>x {(selectedSensor.x * 100).toFixed(0)}% · y {(selectedSensor.y * 100).toFixed(0)}% · z {(selectedSensor.z * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}

      <style>{roomStyles}</style>
    </div>
  );
}

// ─── Styles (scoped, inline so the route is self-contained) ──────────────────

const roomStyles = `
  .room-shell {
    position: fixed; inset: 0;
    background: #17201d;
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 13px;
    color: #c5d5c5;
    overflow: hidden;
  }
  .room-canvas { position: absolute; inset: 0; }
  .room-label-root {
    position: absolute; inset: 0;
    pointer-events: none;
  }
  .room-label-root > * { pointer-events: auto; }

  /* sensor badges (Three.js CSS2DObject) */
  .sensor-badge {
    background: rgba(23,32,29,0.88);
    border: 1px solid #2f4840;
    border-radius: 6px;
    padding: 6px 9px;
    min-width: 110px;
    cursor: pointer;
    backdrop-filter: blur(6px);
    transform: translateY(-100%) translateX(-50%);
  }
  .sensor-badge:hover { border-color: #c9f36d; }
  .badge-header { display: flex; align-items: center; gap: 5px; margin-bottom: 4px; }
  .badge-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: #c9f36d;
    flex-shrink: 0;
  }
  .badge-name { font-size: 10px; font-weight: 600; color: #e8ede8; }
  .badge-row { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #a0b4a0; margin: 1px 0; }
  .badge-icon { font-size: 10px; }
  .badge-temp, .badge-hum, .badge-occ { color: #c5d5c5; }

  /* Top bar */
  .room-topbar {
    position: absolute; top: 0; left: 0; right: 0;
    height: 44px;
    background: rgba(17,26,22,0.9);
    border-bottom: 1px solid #1e2e28;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 16px;
    backdrop-filter: blur(10px);
    z-index: 10;
  }
  .room-topbar-left, .room-topbar-right { display: flex; align-items: center; gap: 12px; }
  .room-back { color: #8aaa8a; font-size: 11px; text-decoration: none; letter-spacing: 0.03em; }
  .room-back:hover { color: #c9f36d; }
  .room-title { font-weight: 600; font-size: 13px; color: #e8ede8; }
  .room-dims { font-size: 11px; color: #5a7060; }
  .room-offline { font-size: 11px; color: #ffbb38; }
  .room-freshness { font-size: 11px; color: #5a7060; }
  .room-sensor-count { font-size: 11px; color: #c9f36d; background: rgba(201,243,109,0.1); border-radius: 10px; padding: 2px 8px; }

  /* Sidebar */
  .room-sidebar {
    position: absolute; top: 44px; left: 0; bottom: 0;
    width: 220px;
    background: rgba(17,26,22,0.88);
    border-right: 1px solid #1e2e28;
    overflow-y: auto;
    padding: 12px;
    z-index: 10;
    backdrop-filter: blur(10px);
  }
  .room-sidebar-heading { font-size: 10px; color: #4a6050; letter-spacing: 0.1em; text-transform: uppercase; margin: 0 0 10px; }
  .room-no-sensors { font-size: 11px; color: #4a6050; line-height: 1.6; }
  .room-sensor-card {
    width: 100%;
    background: rgba(255,255,255,0.03);
    border: 1px solid #1e2e28;
    border-radius: 6px;
    padding: 9px 10px;
    margin-bottom: 6px;
    cursor: pointer;
    text-align: left;
    color: inherit;
  }
  .room-sensor-card:hover { border-color: #3a5040; }
  .room-sensor-card.selected { border-color: #c9f36d; background: rgba(201,243,109,0.06); }
  .room-sensor-card.inactive { opacity: 0.45; }
  .rsc-header { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; }
  .rsc-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .rsc-name { font-size: 12px; font-weight: 600; color: #d5e5d5; flex: 1; }
  .rsc-id { font-size: 9px; color: #4a6050; font-family: ui-monospace, monospace; }
  .rsc-readings { display: flex; flex-wrap: wrap; gap: 5px; font-size: 11px; color: #8aaa8a; }
  .rsc-age { font-size: 10px; color: #4a6050; margin-top: 4px; }

  /* Detail panel */
  .room-detail {
    position: absolute; top: 44px; right: 0; bottom: 0;
    width: 260px;
    background: rgba(17,26,22,0.92);
    border-left: 1px solid #1e2e28;
    padding: 14px;
    overflow-y: auto;
    z-index: 10;
    backdrop-filter: blur(10px);
  }
  .room-detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
  .room-detail-header strong { font-size: 14px; color: #e8ede8; }
  .room-detail-header button { background: none; border: none; color: #5a7060; cursor: pointer; font-size: 14px; }
  .room-detail-header button:hover { color: #c5d5c5; }
  .room-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
  .rdg-cell { background: rgba(255,255,255,0.03); border: 1px solid #1e2e28; border-radius: 5px; padding: 8px 10px; }
  .rdg-cell small { display: block; font-size: 10px; color: #5a7060; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 3px; }
  .rdg-cell strong { font-size: 14px; color: #d5e5d5; }
  .room-chart-tabs { display: flex; gap: 4px; margin-bottom: 10px; }
  .room-chart-tabs button {
    padding: 4px 10px; font-size: 11px; border-radius: 4px;
    background: rgba(255,255,255,0.04); border: 1px solid #1e2e28;
    color: #8aaa8a; cursor: pointer;
  }
  .room-chart-tabs button.active { background: rgba(201,243,109,0.12); border-color: #c9f36d; color: #c9f36d; }
  .room-sparkline { width: 100%; height: 70px; border: 1px solid #1e2e28; border-radius: 4px; background: rgba(0,0,0,0.2); display: block; margin-bottom: 10px; }
  .room-no-history { font-size: 11px; color: #4a6050; margin-bottom: 10px; }
  .room-detail-pos { border-top: 1px solid #1e2e28; padding-top: 10px; }
  .room-detail-pos small { display: block; font-size: 10px; color: #4a6050; margin-bottom: 3px; letter-spacing: 0.05em; text-transform: uppercase; }
  .room-detail-pos span { font-size: 11px; font-family: ui-monospace, monospace; color: #8aaa8a; }

  /* Loading */
  .room-loading {
    position: fixed; inset: 0; background: #17201d;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
    color: #c9f36d; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase;
    font-family: ui-monospace, monospace;
  }
  .room-loading i {
    display: inline-block; width: 7px; height: 7px; background: #c9f36d;
    border-radius: 1px; animation: rp 1.2s ease-in-out infinite; margin: 0 2px;
  }
  .room-loading i:nth-child(2) { animation-delay: 0.2s; }
  .room-loading i:nth-child(3) { animation-delay: 0.4s; }
  @keyframes rp { 0%,80%,100%{opacity:.2;transform:scaleY(1)} 40%{opacity:1;transform:scaleY(1.6)} }
`;
