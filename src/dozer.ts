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

interface Point2D {
  x: number;
  y: number;
}

function getBezierPoint(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, t: number): Point2D {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;

  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

function getBezierLength(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, samples = 12): number {
  let len = 0;
  let prev = p0;
  for (let i = 1; i <= samples; i++) {
    const pt = getBezierPoint(p0, p1, p2, p3, i / samples);
    len += Math.hypot(pt.x - prev.x, pt.y - prev.y);
    prev = pt;
  }
  return Math.max(len, 1);
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
  private currentPitch = 0;
  private currentRoll = 0;
  private distTraveled3D = 0;

  // 2-segment Bézier curve pre-move state
  private bezierSegments: Array<{
    p0: { x: number; y: number };
    p1: { x: number; y: number };
    p2: { x: number; y: number };
    p3: { x: number; y: number };
    length: number;
  }> = [];
  private bezierT = 0;

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
      const cheat = getKilldozerCheat();
      if (cheat?.getValue("Random roam")) return;

      const rect = this.container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      this.setTargetFromPoint(mouseX, mouseY);
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

  private setTargetFromPoint(pixelX: number, pixelY: number): void {
    const rect = this.container.getBoundingClientRect();
    const cheat = getKilldozerCheat();
    const sizeMult = (Number(cheat?.getValue("Size")) || 100) / 100;
    const dozerW = 300 * sizeMult;
    const dozerH = 180 * sizeMult;

    // 2D target
    this.targetX2D = Math.max(0, Math.min(rect.width - dozerW, pixelX - dozerW / 2));
    this.targetY2D = Math.max(0, Math.min(rect.height - dozerH, pixelY - dozerH / 2));

    // 3D raycast to 3D ground plane
    if (rect.width > 0 && rect.height > 0) {
      const ndcX = (pixelX / rect.width) * 2 - 1;
      const ndcY = -(pixelY / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
        this.target3D.copy(hit);
      }
    }
  }

  private ensureBezierCurves(): void {
    const rect = this.container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const cheat = getKilldozerCheat();
    const sizeMult = (Number(cheat?.getValue("Size")) || 100) / 100;
    const dozerW = 300 * sizeMult;
    const dozerH = 180 * sizeMult;

    const marginX = Math.max(60, dozerW * 0.4);
    const marginY = Math.max(50, dozerH * 0.4);
    const minX = marginX;
    const maxX = Math.max(minX, rect.width - marginX);
    const minY = marginY;
    const maxY = Math.max(minY, rect.height - marginY);

    while (this.bezierSegments.length < 2) {
      let p0: Point2D;
      let v0: Point2D;

      if (this.bezierSegments.length === 0) {
        // Start from current bulldozer location
        p0 = {
          x: Math.max(minX, Math.min(maxX, this.posX2D + dozerW / 2)),
          y: Math.max(minY, Math.min(maxY, this.posY2D + dozerH / 2)),
        };
        const angle = this.facingLeft2D ? Math.PI : 0;
        v0 = { x: Math.cos(angle), y: Math.sin(angle) };
      } else {
        // Next curve: seamless C1 continuity from the end of the previous segment
        const prev = this.bezierSegments[this.bezierSegments.length - 1];
        p0 = { x: prev.p3.x, y: prev.p3.y };
        const dx = prev.p3.x - prev.p2.x;
        const dy = prev.p3.y - prev.p2.y;
        const dLen = Math.hypot(dx, dy) || 1;
        v0 = { x: dx / dLen, y: dy / dLen };
      }

      // Pick random destination P3
      const p3: Point2D = {
        x: minX + Math.random() * (maxX - minX),
        y: minY + Math.random() * (maxY - minY),
      };

      const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
      const ctrlDist = Math.max(40, Math.min(dist * 0.45, 300));

      // P1 extends along incoming tangent v0
      const p1: Point2D = {
        x: Math.max(minX * 0.5, Math.min(rect.width - minX * 0.5, p0.x + v0.x * ctrlDist)),
        y: Math.max(minY * 0.5, Math.min(rect.height - minY * 0.5, p0.y + v0.y * ctrlDist)),
      };

      // Destination incoming direction v1
      const toP3X = p3.x - p1.x;
      const toP3Y = p3.y - p1.y;
      const baseAngle = Math.atan2(toP3Y, toP3X);
      const deflect = (Math.random() - 0.5) * 0.8;
      const targetAngle = baseAngle + deflect;
      const v1: Point2D = { x: Math.cos(targetAngle), y: Math.sin(targetAngle) };

      // P2 arrives at p3 along v1
      const p2: Point2D = {
        x: Math.max(minX * 0.5, Math.min(rect.width - minX * 0.5, p3.x - v1.x * ctrlDist)),
        y: Math.max(minY * 0.5, Math.min(rect.height - minY * 0.5, p3.y - v1.y * ctrlDist)),
      };

      const length = getBezierLength(p0, p1, p2, p3);
      this.bezierSegments.push({ p0, p1, p2, p3, length });
    }
  }

  private updateRoam(): void {
    const cheat = getKilldozerCheat();
    const shouldRoam = Boolean(cheat?.getValue("Random roam"));

    if (!shouldRoam) {
      if (this.bezierSegments.length > 0) {
        this.bezierSegments = [];
        this.bezierT = 0;
      }
      return;
    }

    // Always maintain 2 pre-moved Bezier curves ahead
    this.ensureBezierCurves();

    const seg = this.bezierSegments[0];
    if (!seg) return;

    const speedMult = (Number(cheat?.getValue("Speed")) || 5) / 5;
    const speed = SPEED_2D * speedMult;
    const dt = speed / seg.length;
    this.bezierT += dt;

    if (this.bezierT >= 1) {
      // Seamlessly advance to the next pre-moved curve without stopping
      this.bezierT -= 1;
      this.bezierSegments.shift();
      this.ensureBezierCurves();
    }

    const currentSeg = this.bezierSegments[0];
    if (!currentSeg) return;

    // Lookahead point along path; seamlessly sample into the pre-moved next curve when closing current curve
    const lookaheadDist = Math.max(0.06, 50 / currentSeg.length);
    const evalT = this.bezierT + lookaheadDist;
    let targetPt: Point2D;

    if (evalT <= 1) {
      targetPt = getBezierPoint(
        currentSeg.p0,
        currentSeg.p1,
        currentSeg.p2,
        currentSeg.p3,
        evalT
      );
    } else if (this.bezierSegments.length > 1) {
      const nextSeg = this.bezierSegments[1];
      const nextT = Math.min(1, evalT - 1);
      targetPt = getBezierPoint(
        nextSeg.p0,
        nextSeg.p1,
        nextSeg.p2,
        nextSeg.p3,
        nextT
      );
    } else {
      targetPt = currentSeg.p3;
    }

    this.setTargetFromPoint(targetPt.x, targetPt.y);
  }

  private loop = () => {
    if (!this.active) return;

    this.updateRoam();

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

    let targetPitch = 0;
    let targetRoll = 0;
    let bumpY = 0;

    if (dist > 0.02) {
      const step = Math.min(dist, SPEED_3D * speedMult);
      this.modelPos.x += (dx / dist) * step;
      this.modelPos.z += (dz / dist) * step;
      this.distTraveled3D += step * 0.8;

      // 360-degree heading direction on 3D ground plane (native front is -X)
      const targetYaw = Math.atan2(dz, -dx);
      const diff = Math.atan2(Math.sin(targetYaw - this.currentYaw), Math.cos(targetYaw - this.currentYaw));
      this.currentYaw += diff * 0.12;

      // Continuous damping factor eliminates abrupt step snapping
      const speedFactor = Math.min(1, dist / 0.25);
      bumpY = Math.sin(this.distTraveled3D * 2.0) * 0.12 * speedFactor;
      targetPitch = Math.sin(this.distTraveled3D * 1.5) * 0.04 * speedFactor;
      targetRoll = -diff * 0.15 * speedFactor;
    }

    // Smoothly interpolate pitch and roll to prevent any rotational snapping or twitch
    this.currentPitch += (targetPitch - this.currentPitch) * 0.15;
    this.currentRoll += (targetRoll - this.currentRoll) * 0.15;

    this.modelRoot.position.set(this.modelPos.x, bumpY, this.modelPos.z);
    this.modelRoot.rotation.set(this.currentPitch, this.currentYaw, this.currentRoll);

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
