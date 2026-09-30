"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { OsmBuilding, OsmScene, Vec2 } from "../../lib/osm";

export type WorldLayers = { buildings: boolean; roads: boolean; water: boolean; green: boolean };

type Props = {
  scene: OsmScene | null;
  layers: WorldLayers;
  selectedId: string | null;
  onSelect: (building: OsmBuilding | null) => void;
  onHover: (building: OsmBuilding | null) => void;
};

// OSM north is +y after projection; Three.js convention puts north at -z.
function toWorldZ(y: number): number {
  return -y;
}

const ROAD_STYLE = {
  major: { colour: 0x47578a, y: 0.34 },
  minor: { colour: 0x36446f, y: 0.26 },
  path: { colour: 0x2c3860, y: 0.18 },
  rail: { colour: 0x6a6480, y: 0.4 },
} as const;

// Height ramps from deep navy to the workspace's electric blue, so relative
// height is legible without a legend and the scene stays in the app's palette.
const LOW = new THREE.Color(0x1d3266);
const HIGH = new THREE.Color(0x93b4ff);

function heightColour(heightM: number): THREE.Color {
  // Log ramp: most cities are 3–20 m, so a linear ramp would leave almost
  // every building at the same end of the scale.
  const t = Math.min(1, Math.log2(Math.max(heightM, 2) / 2) / Math.log2(60 / 2));
  return LOW.clone().lerp(HIGH, t);
}

function shapeFrom(ring: Vec2[], holes: Vec2[][]): THREE.Shape {
  const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, p.y)));
  for (const hole of holes) {
    if (hole.length >= 3) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))));
  }
  return shape;
}

// An extrusion in world space: footprint on the ground plane, height along +y.
function extrude(building: OsmBuilding): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(shapeFrom(building.ring, building.holes), {
    depth: building.heightM,
    bevelEnabled: false,
    curveSegments: 1,
  });
  // (x, y, z) -> (x, z, -y): the shape's northing becomes -z and the
  // extrusion axis becomes +y.
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

// Flat polygon lying on the ground plane at height `y`.
function flatPolygon(ring: Vec2[], y: number): THREE.BufferGeometry {
  const geometry = new THREE.ShapeGeometry(shapeFrom(ring, []));
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

// A centred ribbon along a polyline, mitred at the joints so corners stay
// closed. Very sharp turns would produce a spike, so the mitre is capped and
// falls back to a square joint.
function ribbon(points: Vec2[], width: number, y: number): Float32Array | null {
  const half = width / 2;
  const clean: Vec2[] = [];
  for (const point of points) {
    const previous = clean[clean.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 0.05) clean.push(point);
  }
  if (clean.length < 2) return null;

  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i < clean.length; i++) {
    const before = clean[Math.max(0, i - 1)];
    const after = clean[Math.min(clean.length - 1, i + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    let nx = -dy / length;
    let ny = dx / length;

    if (i > 0 && i < clean.length - 1) {
      const inX = clean[i].x - before.x;
      const inY = clean[i].y - before.y;
      const inLength = Math.hypot(inX, inY) || 1;
      const segmentNx = -inY / inLength;
      const segmentNy = inX / inLength;
      const cosine = nx * segmentNx + ny * segmentNy;
      // Cap the mitre at 4x the half-width; beyond that the joint is a hairpin.
      const scale = Math.min(4, 1 / Math.max(Math.abs(cosine), 0.25));
      nx *= scale;
      ny *= scale;
    }

    left.push({ x: clean[i].x + nx * half, y: clean[i].y + ny * half });
    right.push({ x: clean[i].x - nx * half, y: clean[i].y - ny * half });
  }

  const positions = new Float32Array((clean.length - 1) * 18);
  let cursor = 0;
  const push = (p: Vec2) => {
    positions[cursor++] = p.x;
    positions[cursor++] = y;
    positions[cursor++] = toWorldZ(p.y);
  };
  for (let i = 0; i < clean.length - 1; i++) {
    push(left[i]); push(right[i]); push(right[i + 1]);
    push(left[i]); push(right[i + 1]); push(left[i + 1]);
  }
  return positions;
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose?.();
  });
}

export default function WorldEngine({ scene, layers, selectedId, onSelect, onHover }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Imperative handles the render loop owns; React only re-runs the effects
  // that rebuild content when the data behind them changes.
  const coreRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    content: THREE.Group;
    highlight: THREE.Group;
    layerGroups: Record<keyof WorldLayers, THREE.Group>;
    buildingMesh: THREE.Mesh | null;
    // Cumulative triangle index at which each building's faces begin, so a
    // raycast hit on the merged mesh resolves back to one building.
    faceStarts: Int32Array;
    buildings: OsmBuilding[];
  } | null>(null);
  // Kept in a ref so the pointer listeners never need re-binding when the
  // parent re-renders with new handler identities.
  const callbacksRef = useRef({ onSelect, onHover });
  useEffect(() => {
    callbacksRef.current = { onSelect, onHover };
  }, [onSelect, onHover]);

  // Renderer, camera and loop — created once for the life of the component.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth || 1, mount.clientHeight || 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "3D map of the loaded area");

    const world = new THREE.Scene();
    world.background = new THREE.Color(0x071330);
    world.fog = new THREE.Fog(0x071330, 900, 3400);

    const camera = new THREE.PerspectiveCamera(48, (mount.clientWidth || 1) / (mount.clientHeight || 1), 1, 30_000);
    camera.position.set(420, 340, 420);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.08;
    controls.minDistance = 25;
    controls.maxDistance = 6000;

    world.add(new THREE.HemisphereLight(0xc6d6ff, 0x0a1430, 1.5));
    const sun = new THREE.DirectionalLight(0xfff0d2, 1.6);
    sun.position.set(-600, 900, 420);
    world.add(sun);
    const fill = new THREE.DirectionalLight(0x5d7bd6, 0.55);
    fill.position.set(500, 300, -500);
    world.add(fill);

    const content = new THREE.Group();
    const highlight = new THREE.Group();
    world.add(content, highlight);

    const layerGroups = {
      buildings: new THREE.Group(),
      roads: new THREE.Group(),
      water: new THREE.Group(),
      green: new THREE.Group(),
    } as Record<keyof WorldLayers, THREE.Group>;
    for (const group of Object.values(layerGroups)) content.add(group);

    const core = {
      renderer, scene: world, camera, controls, content, highlight, layerGroups,
      buildingMesh: null as THREE.Mesh | null,
      faceStarts: new Int32Array(0),
      buildings: [] as OsmBuilding[],
    };
    coreRef.current = core;

    const resize = new ResizeObserver(() => {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(mount);

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(world, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      disposeTree(world);
      renderer.dispose();
      renderer.domElement.remove();
      coreRef.current = null;
    };
  }, []);

  // Rebuild the scene contents whenever new geography arrives.
  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;

    for (const group of Object.values(core.layerGroups)) {
      disposeTree(group);
      group.clear();
    }
    core.buildingMesh = null;
    core.buildings = [];
    core.faceStarts = new Int32Array(0);
    if (!scene) return;

    const radius = scene.radiusM;

    // Ground: the exact square the geometry was clipped to, so the loaded
    // extent is shown rather than implied.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x0b1735 })
    );
    ground.position.y = -0.05;
    core.layerGroups.roads.add(ground);
    const edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-radius, 0.5, -radius),
        new THREE.Vector3(radius, 0.5, -radius),
        new THREE.Vector3(radius, 0.5, radius),
        new THREE.Vector3(-radius, 0.5, radius),
      ]),
      new THREE.LineBasicMaterial({ color: 0xf6c189, transparent: true, opacity: 0.3 })
    );
    core.layerGroups.roads.add(edge);

    // Water and parks, drawn as flat polygons just above the ground.
    for (const kind of ["water", "green"] as const) {
      const rings = scene.areas.filter((area) => area.kind === kind);
      const geometries = rings
        .map((area) => flatPolygon(area.ring, kind === "water" ? 0.12 : 0.06))
        .filter((geometry) => geometry.attributes.position.count > 0);
      if (geometries.length === 0) continue;
      const merged = mergeGeometries(geometries, false);
      geometries.forEach((geometry) => geometry.dispose());
      if (!merged) continue;
      core.layerGroups[kind].add(
        new THREE.Mesh(
          merged,
          new THREE.MeshLambertMaterial({
            color: kind === "water" ? 0x15476b : 0x1d4436,
            transparent: true,
            opacity: kind === "water" ? 0.92 : 0.8,
          })
        )
      );
    }

    // Roads, one merged mesh per class so each keeps its own colour and height.
    for (const kind of ["path", "minor", "major", "rail"] as const) {
      const strips = scene.roads
        .filter((road) => road.kind === kind)
        .map((road) => ribbon(road.points, road.widthM, ROAD_STYLE[kind].y))
        .filter((positions): positions is Float32Array => positions !== null);
      if (strips.length === 0) continue;
      const total = strips.reduce((sum, strip) => sum + strip.length, 0);
      const positions = new Float32Array(total);
      let cursor = 0;
      for (const strip of strips) {
        positions.set(strip, cursor);
        cursor += strip.length;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      core.layerGroups.roads.add(
        new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: ROAD_STYLE[kind].colour, side: THREE.DoubleSide }))
      );
    }

    // Buildings: one merged mesh for the whole area. Per-vertex colour carries
    // both the height ramp and a base-to-roof gradient that stands in for
    // ambient occlusion, which keeps the scene readable without shadow maps.
    const geometries: THREE.BufferGeometry[] = [];
    const faceStarts: number[] = [];
    const kept: OsmBuilding[] = [];
    let triangles = 0;

    for (const building of scene.buildings) {
      let geometry: THREE.ExtrudeGeometry;
      try {
        geometry = extrude(building);
      } catch {
        continue; // A self-intersecting footprint that earcut cannot triangulate.
      }
      const position = geometry.attributes.position;
      if (!position || position.count === 0) {
        geometry.dispose();
        continue;
      }

      const tone = heightColour(building.heightM);
      const colours = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        const shade = 0.5 + 0.5 * Math.min(1, position.getY(i) / Math.max(building.heightM, 1));
        colours[i * 3] = tone.r * shade;
        colours[i * 3 + 1] = tone.g * shade;
        colours[i * 3 + 2] = tone.b * shade;
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
      geometry.clearGroups();

      faceStarts.push(triangles);
      triangles += position.count / 3;
      geometries.push(geometry);
      kept.push(building);
    }

    if (geometries.length > 0) {
      const merged = mergeGeometries(geometries, false);
      geometries.forEach((geometry) => geometry.dispose());
      if (merged) {
        const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
        core.layerGroups.buildings.add(mesh);
        core.buildingMesh = mesh;
        core.buildings = kept;
        core.faceStarts = Int32Array.from(faceStarts);
      }
    }

    // Frame the area: pull back far enough that the whole disc is in view.
    core.controls.target.set(0, 0, 0);
    const distance = radius * 1.75;
    core.camera.position.set(distance * 0.55, distance * 0.62, distance * 0.75);
    core.camera.near = Math.max(1, radius / 400);
    core.camera.far = radius * 30;
    core.camera.updateProjectionMatrix();
    core.controls.minDistance = Math.max(12, radius / 40);
    core.controls.maxDistance = radius * 8;
    core.controls.update();
    core.scene.fog = new THREE.Fog(0x071330, radius * 1.4, radius * 5);
  }, [scene]);

  // Layer visibility.
  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;
    for (const [key, visible] of Object.entries(layers) as Array<[keyof WorldLayers, boolean]>) {
      core.layerGroups[key].visible = visible;
    }
  }, [layers]);

  // Selection outline, rebuilt as a separate mesh so the merged building
  // geometry never has to be touched.
  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;
    disposeTree(core.highlight);
    core.highlight.clear();

    const building = core.buildings.find((entry) => entry.id === selectedId);
    if (!building) return;

    let geometry: THREE.ExtrudeGeometry;
    try {
      geometry = extrude(building);
    } catch {
      return;
    }
    core.highlight.add(
      new THREE.Mesh(
        geometry,
        new THREE.MeshLambertMaterial({ color: 0xf6c189, emissive: 0x6d4a1c, transparent: true, opacity: 0.96 })
      )
    );
    core.highlight.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 24),
        new THREE.LineBasicMaterial({ color: 0xffe6c2 })
      )
    );
  }, [selectedId, scene]);

  // Pointer picking against the merged building mesh.
  useEffect(() => {
    const core = coreRef.current;
    const canvas = core?.renderer.domElement;
    if (!core || !canvas) return;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pressedAt: { x: number; y: number } | null = null;
    let hovered: string | null = null;
    let queued = false;

    // Map a hit triangle back to its building by locating the last face start
    // at or below the hit index.
    function buildingAtFace(faceIndex: number): OsmBuilding | null {
      const starts = core!.faceStarts;
      if (starts.length === 0) return null;
      let low = 0;
      let high = starts.length - 1;
      let found = 0;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (starts[mid] <= faceIndex) {
          found = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return core!.buildings[found] ?? null;
    }

    function pick(event: PointerEvent): OsmBuilding | null {
      const mesh = core!.buildingMesh;
      if (!mesh || !core!.layerGroups.buildings.visible) return null;
      const rect = canvas!.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, core!.camera);
      const hit = raycaster.intersectObject(mesh, false)[0];
      return hit?.faceIndex === undefined ? null : buildingAtFace(hit.faceIndex);
    }

    function onPointerMove(event: PointerEvent) {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const building = pick(event);
        const id = building?.id ?? null;
        if (id !== hovered) {
          hovered = id;
          canvas!.style.cursor = building ? "pointer" : "grab";
          callbacksRef.current.onHover(building);
        }
      });
    }

    function onPointerDown(event: PointerEvent) {
      pressedAt = { x: event.clientX, y: event.clientY };
    }

    function onPointerUp(event: PointerEvent) {
      // Only treat it as a click if the pointer barely moved — otherwise the
      // user was orbiting and does not want the selection to change.
      const moved = pressedAt ? Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) : Infinity;
      pressedAt = null;
      if (moved > 5) return;
      callbacksRef.current.onSelect(pick(event));
    }

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", () => {
      hovered = null;
      callbacksRef.current.onHover(null);
    });

    return () => {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
    };
  }, [scene]);

  return <div ref={mountRef} className="world-canvas" />;
}
