// Scene assembly: renderer, camera, the block itself, and the translucent
// helper geometry that shows where the selected event acts.

import * as THREE from '../../vendor/three.module.js';
import { OrbitControls } from './controls.js';
import { BlockMaterial } from './material.js';
import { buildBlockGeometry, buildEdgeLines, footprint } from './block.js';
import { planeFrame, axisFrame, DEG } from '../geo/math.js';
import { surfaceHeight, surfaceRange } from '../geo/surfaces.js';

export class BlockScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x0f1418, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 200000);
    this.camera.up.set(0, 0, 1);

    this.controls = new OrbitControls(this.camera, canvas);

    this.blockMat = new BlockMaterial();
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.blockMat.material);
    this.scene.add(this.mesh);

    this.edges = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x0b0f12, transparent: true, opacity: 0.55 }),
    );
    this.scene.add(this.edges);

    this.helpers = new THREE.Group();
    this.scene.add(this.helpers);

    this.raycaster = new THREE.Raycaster();
    this._geomKey = null;
    this._needsRender = true;

    // Watch the canvas box rather than the window: the bottom sheet animates
    // its height, and a window-resize listener alone can sample the layout
    // mid-transition and leave the renderer stuck at the wrong size.
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
    }

    // Frame-time watchdog for the automatic quality setting.
    this._frameMs = 16;
    this._lastFrame = performance.now();
    this._autoSamples = 4;
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    // A collapsed box means the layout is mid-flight; a later observation
    // will bring the real size.
    if (w < 2 || h < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._needsRender = true;
  }

  /** Rebuild block geometry only when its shape actually changed. */
  syncGeometry(doc, force = false) {
    const t = doc.topo;
    const key = JSON.stringify([doc.block, t]);
    if (!force && key === this._geomKey) return;
    this._geomKey = key;

    const res = 96;
    this.mesh.geometry.dispose();
    this.mesh.geometry = buildBlockGeometry(doc.block, t, res);
    this.edges.geometry.dispose();
    this.edges.geometry = buildEdgeLines(doc.block, t, res);
    this._needsRender = true;
  }

  syncDocument(doc) {
    this.blockMat.syncStructure(doc);
    this.blockMat.syncUniforms(doc);
    this.syncGeometry(doc);

    const ex = doc.settings.exaggeration || 1;
    this.mesh.scale.z = ex;
    this.edges.scale.z = ex;
    this.helpers.scale.z = ex;
    this.blockMat.uniforms.uExag.value = ex;

    const q = doc.settings.quality;
    this.blockMat.uniforms.uSamples.value =
      q === 'low' ? 1 : q === 'high' ? 4 : this._autoSamples;

    this._needsRender = true;
  }

  frame(doc) {
    const { lo, hi } = surfaceRange(doc.topo, doc.block.width, doc.block.depth);
    const { x0, x1, y0, y1 } = footprint(doc.block);
    const ex = doc.settings.exaggeration || 1;
    this.controls.frame({
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
      w: x1 - x0,
      d: y1 - y0,
      zTop: hi * ex,
      zBot: (lo - doc.block.height) * ex,
    });
    this._needsRender = true;
  }

  /**
   * Draw the geometry of one event so students can see what they are editing:
   * fault and dike planes, fold axial traces, dome outlines, erosion surfaces.
   */
  showHelper(doc, event) {
    this.helpers.clear();
    this._needsRender = true;
    if (!event) return;

    const B = doc.block;
    const span = Math.hypot(B.width, B.depth) * 0.75;
    const accent = 0xffd166;

    // Where the drawn rectangle should be centred: the middle of the block.
    const { lo, hi } = surfaceRange(doc.topo, B.width, B.depth);
    const fp = footprint(B);
    const blockMid = new THREE.Vector3(
      (fp.x0 + fp.x1) / 2, (fp.y0 + fp.y1) / 2, (hi + lo - B.height) / 2,
    );

    // Sized to the block rather than squared off at `span`: a 60-degree fault
    // drawn as a span x span sheet towers over the model and stops reading as
    // part of it.
    const planeSize = (dip) => [
      span,
      Math.min(span, B.height / Math.max(0.35, Math.sin(dip * DEG))),
    ];

    const planeAt = (strike, dip, center, size, color, opacity) => {
      const { strikeVec, normal } = planeFrame(strike, dip);
      const X = new THREE.Vector3(...strikeVec);
      const Z = new THREE.Vector3(...normal);
      const Y = new THREE.Vector3().crossVectors(Z, X);

      // Slide the rectangle within its own plane so it frames the block. The
      // plane itself is unchanged — only the patch we draw of it moves — so
      // this is purely presentational and cannot misreport the geometry.
      //
      // X is horizontal (it is the strike), so it centres the patch in map
      // view; Y then carries it up or down dip until its mid-height matches
      // the block's. Simply projecting onto the plane is not enough: the
      // nearest point to the block centre still leaves the patch riding above
      // the ground surface whenever the plane misses that centre.
      const c = new THREE.Vector3(center[0], center[1], center[2]);
      const toMid = blockMid.clone().sub(c);
      c.addScaledVector(X, toMid.dot(X));
      if (Math.abs(Y.z) > 0.05) c.addScaledVector(Y, (blockMid.z - c.z) / Y.z);
      else c.addScaledVector(Y, blockMid.clone().sub(c).dot(Y));

      const m = new THREE.Matrix4().makeBasis(X, Y, Z);
      m.setPosition(c.x, c.y, c.z);

      const g = new THREE.PlaneGeometry(size[0], size[1]);
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
      }));
      mesh.applyMatrix4(m);
      this.helpers.add(mesh);

      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(g),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
      );
      outline.applyMatrix4(m);
      this.helpers.add(outline);
      return { X, Y, Z };
    };

    switch (event.type) {
      case 'tilt':
        planeAt(event.strike, event.dip,
          [event.centerX || 0, event.centerY || 0, event.centerZ || 0],
          planeSize(event.dip), accent, 0.16);
        break;

      case 'fault':
        planeAt(event.strike, event.dip,
          [event.centerX, event.centerY, event.centerZ], planeSize(event.dip), 0xff6b6b, 0.2);
        break;

      case 'dike': {
        const half = Math.max(1, event.thickness) * 0.5;
        const { normal } = planeFrame(event.strike, event.dip);
        for (const s of [-half, half]) {
          planeAt(event.strike, event.dip, [
            event.centerX + normal[0] * s,
            event.centerY + normal[1] * s,
            normal[2] * s,
          ], planeSize(event.dip), 0x8ecae6, 0.16);
        }
        break;
      }

      case 'fold': {
        // Axial traces: the lines where the fold crests and troughs sit.
        const { perp, axis } = axisFrame(event.trend, event.plunge);
        const pts = [];
        const lam = Math.max(1, event.wavelength);
        const phase = (event.phase || 0) * DEG;
        for (let k = -3; k <= 3; k++) {
          // cos(2*pi*u/lam + phase) is extreme where 2*pi*u/lam + phase = k*pi
          const u = (k * Math.PI - phase) * lam / (2 * Math.PI);
          const base = [
            (event.centerX || 0) + perp[0] * u,
            (event.centerY || 0) + perp[1] * u,
            0,
          ];
          const half = span;
          pts.push(
            base[0] - axis[0] * half, base[1] - axis[1] * half, base[2] - axis[2] * half,
            base[0] + axis[0] * half, base[1] + axis[1] * half, base[2] + axis[2] * half,
          );
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        this.helpers.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({
          color: accent, transparent: true, opacity: 0.85,
        })));
        break;
      }

      case 'domebasin': {
        const pts = [];
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * Math.PI * 2;
          const az = (event.azimuth || 0) * DEG;
          const ex = Math.cos(a) * event.radiusA;
          const ey = Math.sin(a) * event.radiusB;
          const x = event.centerX + ex * Math.cos(az) + ey * Math.sin(az);
          const y = event.centerY - ex * Math.sin(az) + ey * Math.cos(az);
          pts.push(x, y, surfaceHeight(doc.topo, x, y) + 8);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        this.helpers.add(new THREE.Line(g, new THREE.LineBasicMaterial({
          color: accent, transparent: true, opacity: 0.9,
        })));
        break;
      }

      case 'pluton': {
        const g = new THREE.SphereGeometry(1, 24, 16);
        const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
          color: 0xf4a261, wireframe: true, transparent: true, opacity: 0.5,
        }));
        mesh.scale.set(event.radiusX, event.radiusY, event.radiusZ);
        mesh.position.set(event.centerX, event.centerY, event.centerZ);
        mesh.rotation.z = -(event.azimuth || 0) * DEG;
        this.helpers.add(mesh);
        break;
      }

      case 'unconformity': {
        const n = 48;
        const pos = [];
        const idx = [];
        for (let j = 0; j <= n; j++) {
          for (let i = 0; i <= n; i++) {
            const x = (i / n - 0.5) * B.width;
            const y = (j / n - 0.5) * B.depth;
            pos.push(x, y, surfaceHeight(event.surface, x, y));
          }
        }
        for (let j = 0; j < n; j++) {
          for (let i = 0; i < n; i++) {
            const a = j * (n + 1) + i;
            idx.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        this.helpers.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
          color: 0x90e0a0, transparent: true, opacity: 0.28,
          side: THREE.DoubleSide, depthWrite: false,
        })));
        break;
      }
    }
  }

  /** World-space point under a screen coordinate, in true geologic metres. */
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.mesh, false);
    if (!hits.length) return null;
    const local = this.mesh.worldToLocal(hits[0].point.clone());
    return { point: [local.x, local.y, local.z], screen: [clientX, clientY] };
  }

  requestRender() { this._needsRender = true; }

  render() {
    const moved = this.controls.update();
    if (!moved && !this._needsRender) return false;
    this._needsRender = false;

    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    const dt = performance.now() - t0;
    this._frameMs = this._frameMs * 0.9 + dt * 0.1;

    // Back off supersampling on devices that cannot keep up, and creep back
    // up when they can. Only takes effect when quality is set to 'auto'.
    if (this._frameMs > 22 && this._autoSamples === 4) this._autoSamples = 1;
    else if (this._frameMs < 9 && this._autoSamples === 1) this._autoSamples = 4;
    return true;
  }
}

