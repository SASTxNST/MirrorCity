"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export default function ModelViewer({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030824, 0.055);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
    camera.position.set(5.2, 4.1, 5.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x030824, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.minDistance = 2.5;
    controls.maxDistance = 14;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    scene.add(new THREE.HemisphereLight(0xe8f7ff, 0x06123a, 2.1));
    const keyLight = new THREE.DirectionalLight(0x00dfff, 3.2);
    keyLight.position.set(4, 7, 3);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x155fff, 2.2);
    fillLight.position.set(-5, 2, -4);
    scene.add(fillLight);

    const grid = new THREE.GridHelper(12, 24, 0x167fff, 0x0b255e);
    grid.material.opacity = 0.42;
    grid.material.transparent = true;
    scene.add(grid);

    let loadedModel: THREE.Object3D | undefined;
    const loader = new GLTFLoader();
    loader.load(
      src,
      (gltf) => {
        loadedModel = gltf.scene;
        scene.add(loadedModel);
        const bounds = new THREE.Box3().setFromObject(loadedModel);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        loadedModel.position.sub(center);
        const scale = 5.6 / Math.max(size.x, size.y, size.z, 0.001);
        loadedModel.scale.setScalar(scale);
        loadedModel.rotation.x = -Math.PI / 2;
        loadedModel.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = true;
          object.receiveShadow = true;
          const sourceMaterial = object.material as THREE.MeshStandardMaterial;
          sourceMaterial.color.set(0x155fff);
          sourceMaterial.emissive?.set(0x03174f);
          sourceMaterial.metalness = 0.05;
          sourceMaterial.roughness = 0.76;
          sourceMaterial.side = THREE.DoubleSide;
        });
        setState("ready");
      },
      undefined,
      () => setState("error"),
    );

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let frame = 0;
    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      loadedModel?.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
    };
  }, [src]);

  return <div className="glb-canvas" ref={containerRef}>{state === "loading" && <span className="model-loading"><i /> Loading geometry…</span>}{state === "error" && <span className="model-error">The model could not be loaded.</span>}{state === "ready" && <span className="orbit-hint">DRAG TO ORBIT · SCROLL TO ZOOM</span>}</div>;
}
