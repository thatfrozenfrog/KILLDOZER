import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import dozerImg from "./img/dozer.png";
import { allPanes, getFocusedPane } from "./workspace";
import { onChromeChange } from "./chrome";
import { isTestMode } from "./test-mode";
import type { Cheat } from "./cheat/registry";

const dozerGlbUrl = new URL("./img/dozer.glb", import.meta.url).href;
const STORAGE_KEY = "killdozer-rtx";
const SPEED_2D = 2.5;
const SPEED_3D = 0.08;

function getKilldozerCheat(): Cheat | undefined {
  const focused = getFocusedPane();
  if (focused?.cheats?.Misc) {
    const found = focused.cheats.Misc.find((c) => c.name === "Killdozer");
    if (found) return found;
  }
  for (const pane of allPanes()) {
    const found = pane.cheats?.Misc?.find((c) => c.name === "Killdozer");
    if (found) return found;
  }
  return undefined;
}

export class DozerManager {
  private container: HTMLElement;
  private layerEl: HTMLElement;
  private rtxBtn: HTMLButtonElement | null;
  private isRtx = true;
  private rafId: number | null = null;
  private active = false;

  // 2D mode state
  private imgEl: HTMLImageElement;
  private posX2D = 0;
  private posY2D = 0;
  private targetX2D = 0;
  private targetY2D = 0;
  private facingLeft2D = true;
  private rotY2D = 0;
  private distTraveled2D = 0;

  // 3D mode state
  private canvas3D: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private raycaster: THREE.Raycaster;
  private groundPlane: THREE.Plane;
  private modelRoot: THREE.Group | null = null;
  private modelMesh: THREE.Object3D | null = null;
  private maxDim = 1;
  private modelPos = new THREE.Vector3(0, 0, 0);
  private target3D = new THREE.Vector3(0, 0, 0);
  private currentYaw = 0;
  private distTraveled3D = 0;

  constructor() {
    this.container = document.getElementById("workspace") || document.body;
    let layer = document.getElementById("dozer-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "dozer-layer";
      layer.className = "dozer-layer";
      this.container.prepend(layer);
    }
    this.layerEl = layer;

    this.rtxBtn = document.getElementById("dozer-rtx-toggle") as HTMLButtonElement | null;
    const savedRtx = localStorage.getItem(STORAGE_KEY);
    this.isRtx = savedRtx !== "false";

    // Setup 2D element
    this.imgEl = document.createElement("img");
    this.imgEl.src = dozerImg;
    this.imgEl.className = "dozer-2d-img";
    this.imgEl.alt = "Bulldozer";
    this.imgEl.draggable = false;
    this.layerEl.appendChild(this.imgEl);

    // Setup 3D element & Three.js
    this.canvas3D = document.createElement("canvas");
    this.canvas3D.className = "dozer-canvas";
    this.layerEl.appendChild(this.canvas3D);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    this.camera.position.set(0, 9, 12);
    this.camera.lookAt(0, 0, 0);

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 2.4);
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 2.8);
    dirLight1.position.set(6, 12, 8);
    const dirLight2 = new THREE.DirectionalLight(0x77bbff, 1.4);
    dirLight2.position.set(-8, 4, -6);
    this.scene.add(ambientLight, dirLight1, dirLight2);

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas3D,
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch (e) {
      console.warn("WebGL initialization failed for dozer:", e);
    }

    this.load3DModel();
    this.setupListeners();
    this.updateModeUI();
    this.updateVisibility();
  }

  private load3DModel(): void {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("/draco/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      dozerGlbUrl,
      (gltf) => {
        const root = new THREE.Group();
        const model = gltf.scene;

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        model.position.sub(center);

        this.maxDim = Math.max(size.x, size.y, size.z) || 1;
        const cheat = getKilldozerCheat();
        const sizeMult = (Number(cheat?.getValue("Size")) || 100) / 100;
        const scale = (6.72 * sizeMult) / this.maxDim;
        model.scale.setScalar(scale);

        root.add(model);
        this.modelMesh = model;
        this.modelRoot = root;
        this.scene.add(root);
      },
      undefined,
      (err) => console.error("Failed to load dozer.glb:", err)
    );
  }

  private setupListeners(): void {
    window.addEventListener("resize", () => this.handleResize());
    const resizeObserver = new ResizeObserver(() => this.handleResize());
    resizeObserver.observe(this.container);

    this.container.addEventListener("mousemove", (e: MouseEvent) => {
      const rect = this.container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 2D target
      const cheat = getKilldozerCheat();
      const sizeMult = (Number(cheat?.getValue("Size")) || 100) / 100;
      const dozerW = 300 * sizeMult;
      const dozerH = 180 * sizeMult;
      this.targetX2D = Math.max(0, Math.min(rect.width - dozerW, mouseX - dozerW / 2));
      this.targetY2D = Math.max(0, Math.min(rect.height - dozerH, mouseY - dozerH / 2));

      // 3D raycast to 3D ground plane
      if (rect.width > 0 && rect.height > 0) {
        const ndcX = (mouseX / rect.width) * 2 - 1;
        const ndcY = -(mouseY / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
        const hit = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
          this.target3D.copy(hit);
        }
      }
    });

    if (this.rtxBtn) {
      this.rtxBtn.addEventListener("click", () => {
        this.isRtx = !this.isRtx;
        localStorage.setItem(STORAGE_KEY, String(this.isRtx));
        this.updateModeUI();
      });
    }

    onChromeChange(() => this.updateVisibility());
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width <= 0 || height <= 0) return;

    if (this.renderer) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateModeUI(): void {
    if (this.rtxBtn) {
      this.rtxBtn.textContent = this.isRtx ? "RTX: ON" : "RTX: OFF";
      this.rtxBtn.classList.toggle("rtx-off", !this.isRtx);
    }
    this.canvas3D.style.display = this.isRtx ? "block" : "none";
    this.imgEl.style.display = this.isRtx ? "none" : "block";
    this.handleResize();
  }

  updateVisibility(): void {
    const cheat = getKilldozerCheat();
    let hasDisconnected = false;

    // Disconnect auto-spawn runs in production when disconnected
    if (!isTestMode()) {
      for (const pane of allPanes()) {
        if (pane.state === "disconnected") {
          hasDisconnected = true;
          break;
        }
      }
    }

    // Spawn when disconnected (in production) OR when Killdozer cheat is enabled (any mode)
    const shouldShow = hasDisconnected || Boolean(cheat?.enabled);

    if (shouldShow) {
      if (this.rtxBtn) this.rtxBtn.classList.remove("hidden");
      this.layerEl.style.display = "";
      this.start();
    } else {
      if (this.rtxBtn) this.rtxBtn.classList.add("hidden");
      this.layerEl.style.display = "none";
      this.stop();
    }
  }

  private loop = () => {
    if (!this.active) return;

    if (this.isRtx) {
      this.step3D();
    } else {
      this.step2D();
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private step2D(): void {
    const cheat = getKilldozerCheat();
    const sizeMult = (Number(cheat?.getValue("Size")) || 100) / 100;
    const speedMult = (Number(cheat?.getValue("Speed")) || 5) / 5;

    const width2D = 300 * sizeMult;
    this.imgEl.style.width = `${width2D}px`;

    const dx = this.targetX2D - this.posX2D;
    const dy = this.targetY2D - this.posY2D;
    const dist = Math.hypot(dx, dy);

    if (dist > 0.5) {
      const step = Math.min(dist, SPEED_2D * speedMult);
      this.posX2D += (dx / dist) * step;
      this.posY2D += (dy / dist) * step;
      this.distTraveled2D += step * 0.04;
    }

    if (Math.abs(dx) > 1.5) {
      this.facingLeft2D = dx < 0;
    }
    const targetRotY = this.facingLeft2D ? 0 : 180;
    this.rotY2D += (targetRotY - this.rotY2D) * 0.12;

    const bump = dist > 0.5 ? Math.sin(this.distTraveled2D * 2) * 3.5 : 0;
    const tilt = dist > 0.5 ? Math.sin(this.distTraveled2D * 1.5) * 2 : 0;

    this.imgEl.style.transform = `translate3d(${this.posX2D.toFixed(1)}px, ${(this.posY2D + bump).toFixed(1)}px, 0) perspective(700px) rotateY(${this.rotY2D.toFixed(1)}deg) rotateZ(${tilt.toFixed(1)}deg)`;
  }

  private step3D(): void {
    if (!this.modelRoot) return;

    const cheat = getKilldozerCheat();
    const sizeMult = (Number(cheat?.getValue("Size")) || 100) / 100;
    const speedMult = (Number(cheat?.getValue("Speed")) || 5) / 5;

    if (this.modelMesh && this.maxDim > 0) {
      const scale = (6.72 * sizeMult) / this.maxDim;
      this.modelMesh.scale.setScalar(scale);
    }

    const dx = this.target3D.x - this.modelPos.x;
    const dz = this.target3D.z - this.modelPos.z;
    const dist = Math.hypot(dx, dz);

    let turnDelta = 0;
    if (dist > 0.05) {
      const step = Math.min(dist, SPEED_3D * speedMult);
      this.modelPos.x += (dx / dist) * step;
      this.modelPos.z += (dz / dist) * step;
      this.distTraveled3D += step * 0.8;

      // 360-degree heading direction on 3D ground plane (native front is -X)
      const targetYaw = Math.atan2(dz, -dx);
      let diff = (targetYaw - this.currentYaw) % (Math.PI * 2);
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      turnDelta = diff;
      this.currentYaw += diff * 0.1;
    }

    // 3D Suspension bounce and tilt (slowed down to match 2D rhythm)
    const bumpY = dist > 0.05 ? Math.sin(this.distTraveled3D * 2.0) * 0.12 : 0;
    const pitch = dist > 0.05 ? Math.sin(this.distTraveled3D * 1.5) * 0.04 : 0;
    const roll = dist > 0.05 ? -turnDelta * 0.15 : 0;

    this.modelRoot.position.set(this.modelPos.x, bumpY, this.modelPos.z);
    this.modelRoot.rotation.set(pitch, this.currentYaw, roll);

    if (this.renderer) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.handleResize();
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.active = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

let dozerManager: DozerManager | null = null;

export function initDozer(): DozerManager {
  if (!dozerManager) {
    dozerManager = new DozerManager();
  }
  return dozerManager;
}
