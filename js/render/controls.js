// Touch-first orbit controls, written rather than borrowed so that phone
// gestures (one finger to turn the block, two to pinch and pan) behave the
// way a student expects while holding the device in the field, and so a tap
// can be told apart from a drag for the identify-unit tool.
//
// Z is up here, not Y — this is a geologic scene.

import { clamp } from '../geo/math.js';

const DEG = Math.PI / 180;

export class OrbitControls {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;

    this.target = { x: 0, y: 0, z: 0 };
    this.azimuth = 35;      // degrees, clockwise from due south of the target
    this.elevation = 28;    // degrees above horizontal
    this.distance = 4200;

    this.minDistance = 300;
    this.maxDistance = 30000;
    this.minElevation = -75;
    this.maxElevation = 88;

    this.damping = 0.14;
    this._azV = 0; this._elV = 0;
    this._pointers = new Map();
    this._prevPinch = 0;
    this._prevMid = null;
    this._mode = null;
    this._downAt = 0;
    this._downPos = null;
    this._moved = 0;

    this.onTap = null;      // (clientX, clientY) => void
    this.changed = true;

    this._bind();
    this.update();
  }

  _bind() {
    const d = this.dom;
    d.style.touchAction = 'none';
    d.addEventListener('pointerdown', this._down = (e) => this._onDown(e));
    d.addEventListener('pointermove', this._move = (e) => this._onMove(e));
    d.addEventListener('pointerup', this._up = (e) => this._onUp(e));
    d.addEventListener('pointercancel', this._up);
    d.addEventListener('wheel', this._wheel = (e) => this._onWheel(e), { passive: false });
    d.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  dispose() {
    const d = this.dom;
    d.removeEventListener('pointerdown', this._down);
    d.removeEventListener('pointermove', this._move);
    d.removeEventListener('pointerup', this._up);
    d.removeEventListener('pointercancel', this._up);
    d.removeEventListener('wheel', this._wheel);
  }

  _onDown(e) {
    this.dom.setPointerCapture(e.pointerId);
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._pointers.size === 1) {
      this._mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
      this._downAt = performance.now();
      this._downPos = { x: e.clientX, y: e.clientY };
      this._moved = 0;
      this._azV = this._elV = 0;
    } else if (this._pointers.size === 2) {
      this._mode = 'pinch';
      const [a, b] = [...this._pointers.values()];
      this._prevPinch = Math.hypot(a.x - b.x, a.y - b.y);
      this._prevMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }

  _onMove(e) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    this._moved += Math.abs(dx) + Math.abs(dy);

    if (this._mode === 'orbit' && this._pointers.size === 1) {
      const k = 0.32;
      this.azimuth -= dx * k;
      this.elevation = clamp(this.elevation + dy * k, this.minElevation, this.maxElevation);
      this._azV = -dx * k;
      this._elV = dy * k;
      this.changed = true;
    } else if (this._mode === 'pan' && this._pointers.size === 1) {
      this._pan(dx, dy);
    } else if (this._mode === 'pinch' && this._pointers.size === 2) {
      const [a, b] = [...this._pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this._prevPinch > 0) {
        this.distance = clamp(
          this.distance * (this._prevPinch / Math.max(1, dist)),
          this.minDistance, this.maxDistance,
        );
      }
      if (this._prevMid) this._pan(mid.x - this._prevMid.x, mid.y - this._prevMid.y);
      this._prevPinch = dist;
      this._prevMid = mid;
      this.changed = true;
    }
  }

  _onUp(e) {
    const wasSingle = this._pointers.size === 1;
    this._pointers.delete(e.pointerId);
    if (wasSingle && this._mode === 'orbit' && this._moved < 8
        && performance.now() - this._downAt < 400 && this.onTap && this._downPos) {
      this.onTap(this._downPos.x, this._downPos.y);
      this._azV = this._elV = 0;
    }
    if (this._pointers.size === 0) this._mode = null;
    if (this._pointers.size === 1) {
      this._mode = 'orbit';
      this._prevPinch = 0;
      this._prevMid = null;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const k = Math.exp(e.deltaY * 0.0012);
    this.distance = clamp(this.distance * k, this.minDistance, this.maxDistance);
    this.changed = true;
  }

  /** Move the target sideways in the camera's own screen plane. */
  _pan(dx, dy) {
    const scale = this.distance / this.dom.clientHeight * 1.6;
    const az = this.azimuth * DEG;
    // Screen-right and screen-up projected onto the world.
    const rx = Math.cos(az), ry = -Math.sin(az);
    const el = this.elevation * DEG;
    const ux = Math.sin(az) * Math.sin(el);
    const uy = Math.cos(az) * Math.sin(el);
    const uz = Math.cos(el);
    this.target.x -= (dx * rx - dy * ux) * scale;
    this.target.y -= (dx * ry - dy * uy) * scale;
    this.target.z -= (-dy * uz) * scale;
    this.changed = true;
  }

  /**
   * Pull back far enough that the whole block fits, using whichever field of
   * view is narrower — on a phone in portrait that is the horizontal one.
   * `box` is the displayed extent: { cx, cy, w, d, zTop, zBot }.
   */
  frame(box) {
    const radius = 0.5 * Math.hypot(box.w, box.d, box.zTop - box.zBot) * 1.08;

    const vFov = this.camera.fov * DEG;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (this.camera.aspect || 1));
    const fov = Math.min(vFov, hFov);

    this.distance = clamp(radius / Math.sin(fov / 2), this.minDistance, this.maxDistance);
    this.target = { x: box.cx, y: box.cy, z: (box.zTop + box.zBot) / 2 };
    this.changed = true;
  }

  setView(azimuth, elevation) {
    this.azimuth = azimuth;
    this.elevation = clamp(elevation, this.minElevation, this.maxElevation);
    this._azV = this._elV = 0;
    this.changed = true;
  }

  update() {
    // Inertia after a flick, so spinning the block feels physical.
    if (!this._mode && (Math.abs(this._azV) > 0.01 || Math.abs(this._elV) > 0.01)) {
      this.azimuth += this._azV;
      this.elevation = clamp(this.elevation + this._elV, this.minElevation, this.maxElevation);
      this._azV *= 1 - this.damping;
      this._elV *= 1 - this.damping;
      this.changed = true;
    }

    const az = this.azimuth * DEG;
    const el = this.elevation * DEG;
    const h = Math.cos(el) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(az) * h,
      this.target.y - Math.cos(az) * h,
      this.target.z + Math.sin(el) * this.distance,
    );
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.target.x, this.target.y, this.target.z);

    const wasChanged = this.changed;
    this.changed = false;
    return wasChanged;
  }
}
