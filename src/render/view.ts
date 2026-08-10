// Orbit camera + canvas fit + animation loop. Locked home view (green
// front, white top, from up-front-right) and orthographic projection fit
// to the narrower canvas axis — see CLAUDE.md "Camera". The camera never
// rotates on its own except the smooth return-to-home lerp.
import * as THREE from "three";

const HOME_AZ = 0.62;
const HOME_POL = 1.0;
const DEFAULT_RAD = 2.2;

export interface Orbit {
  az: number;
  pol: number;
}

export interface View {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  getOrbit(): Orbit;
  /** immediate set, e.g. from a slider — bypasses the home-lerp */
  setOrbit(az: number, pol: number): void;
  goHome(): void;
  /** ortho half-extent fit to the narrower canvas axis — 2.2 for the whole
   *  cube, tighter for an isolated single piece (the "piece" drill) */
  setFitRadius(radius: number): void;
  pick(clientX: number, clientY: number, targets: THREE.Object3D[]): THREE.Intersection | null;
  onTap(handler: ((clientX: number, clientY: number) => void) | null): void;
  /** called once per animation frame, before render */
  onFrame(cb: () => void): void;
  dispose(): void;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function createView(canvas: HTMLCanvasElement): View {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x15181e, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 100);

  let az = HOME_AZ;
  let pol = HOME_POL;
  let goalAz: number | null = null;
  let goalPol = 0;
  let last: { x: number; y: number } | null = null;
  let travel = 0;
  let tapHandler: ((x: number, y: number) => void) | null = null;
  let rad = DEFAULT_RAD;

  function resize(): void {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    let hw = rad;
    let hh = rad;
    const a = w / h;
    if (a >= 1) hw = rad * a;
    else hh = rad / a;
    camera.left = -hw;
    camera.right = hw;
    camera.top = hh;
    camera.bottom = -hh;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener("resize", resize);
  resize();

  function drag(x: number, y: number): void {
    if (!last) {
      last = { x, y };
      return;
    }
    travel += Math.abs(x - last.x) + Math.abs(y - last.y);
    az -= (x - last.x) * 0.008;
    pol -= (y - last.y) * 0.008;
    pol = Math.max(0.15, Math.min(Math.PI - 0.15, pol));
    last = { x, y };
  }
  function grab(x: number, y: number): void {
    last = { x, y };
    travel = 0;
    goalAz = null;
  }
  function drop(x: number, y: number): void {
    last = null;
    if (travel < 10 && tapHandler) tapHandler(x, y);
  }

  // Touch, not pointer events — pointer events let iOS read an orbit drag
  // as a navigation swipe. Unlike the original, this does NOT also add a
  // document-level touchmove blocker: the harness has scrollable controls
  // around the canvas, and blocking touchmove page-wide would break that.
  // The real app's ui/ layer should still add that block once it exists.
  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      grab(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: false },
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      drag(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: false },
  );
  canvas.addEventListener(
    "touchend",
    (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      drop(t.clientX, t.clientY);
    },
    { passive: false },
  );
  canvas.addEventListener("touchcancel", () => {
    last = null;
  });
  canvas.addEventListener("mousedown", (e) => grab(e.clientX, e.clientY));
  window.addEventListener("mousemove", (e) => {
    if (last) drag(e.clientX, e.clientY);
  });
  window.addEventListener("mouseup", (e) => {
    if (last) drop(e.clientX, e.clientY);
  });

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(clientX: number, clientY: number, targets: THREE.Object3D[]): THREE.Intersection | null {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(targets, false)[0] ?? null;
  }

  const frameCallbacks: (() => void)[] = [];
  let running = true;
  function frame(): void {
    if (!running) return;
    if (goalAz !== null && !last) {
      const d = wrapAngle(goalAz - az);
      const e = goalPol - pol;
      az += d * 0.16;
      pol += e * 0.16;
      if (Math.abs(d) < 0.004 && Math.abs(e) < 0.004) goalAz = null;
    }
    const sp = Math.sin(pol);
    camera.position.set(20 * sp * Math.sin(az), 20 * Math.cos(pol), 20 * sp * Math.cos(az));
    camera.lookAt(0, 0, 0);
    frameCallbacks.forEach((cb) => cb());
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    scene,
    camera,
    renderer,
    getOrbit: () => ({ az, pol }),
    setOrbit: (newAz, newPol) => {
      az = newAz;
      pol = Math.max(0.15, Math.min(Math.PI - 0.15, newPol));
      goalAz = null;
    },
    goHome: () => {
      goalAz = HOME_AZ;
      goalPol = HOME_POL;
    },
    setFitRadius: (radius) => {
      rad = radius;
      resize();
    },
    pick,
    onTap: (handler) => {
      tapHandler = handler;
    },
    onFrame: (cb) => frameCallbacks.push(cb),
    dispose: () => {
      running = false;
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
    },
  };
}
