// Binds the document to the generated shader: builds the uniform set, and
// decides when a change needs a recompile versus just new numbers.

import * as THREE from '../../vendor/three.module.js';
import { buildFragmentShader, VERTEX, uniformPrefix } from '../geo/glsl.js';
import { MAX_LAYERS, rock, faultRake } from '../geo/model.js';
import { planeFrame, axisFrame, slipVec, DEG } from '../geo/math.js';
import { KIND_CODE, surfaceUniform } from '../geo/surfaces.js';

const tmpColor = new THREE.Color();

function rgb(hex) {
  tmpColor.set(hex);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}

/** Events that actually contribute geometry, oldest first. */
export function activeEvents(doc) {
  return doc.events.filter((e) => e.enabled !== false);
}

/** Anything that changes this string forces a shader rebuild. */
export function structureKey(doc) {
  return activeEvents(doc).map((e) => e.type).join('|');
}

export class BlockMaterial {
  constructor() {
    this.uniforms = {
      uLayerA: { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector4()) },
      uLayerB: { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector4()) },
      uLayerCount: { value: 0 },
      uBasementColor: { value: new THREE.Vector3(0.48, 0.5, 0.55) },
      uBasementPattern: { value: 7 },
      uPatternScale: { value: 55 },
      uPatternStrength: { value: 1 },
      uContactStrength: { value: 1 },
      uLightDir: { value: new THREE.Vector3(0.45, -0.62, 0.65).normalize() },
      uSamples: { value: 4 },
      uExag: { value: 1 },
    };
    this.structure = null;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: buildFragmentShader([]),
      uniforms: this.uniforms,
      side: THREE.FrontSide,
    });
    this.material.extensions = { derivatives: true };
  }

  /** Rebuild the shader if the shape of the history changed. Returns true if so. */
  syncStructure(doc) {
    const key = structureKey(doc);
    if (key === this.structure) return false;
    this.structure = key;

    const events = activeEvents(doc);
    // Drop uniforms belonging to a previous history so stale registers do not
    // linger, then add the ones this history needs.
    for (const name of Object.keys(this.uniforms)) {
      if (/^ev\d+_/.test(name)) delete this.uniforms[name];
    }
    for (let i = 0; i < events.length; i++) {
      addEventUniforms(this.uniforms, uniformPrefix(i), events[i]);
    }
    this.material.fragmentShader = buildFragmentShader(events);
    this.material.needsUpdate = true;
    return true;
  }

  /** Push current parameter values. Cheap; safe to call every frame. */
  syncUniforms(doc) {
    const u = this.uniforms;

    let acc = 0;
    const n = Math.min(doc.layers.length, MAX_LAYERS);
    for (let i = 0; i < n; i++) {
      const l = doc.layers[i];
      acc += Math.max(0.5, l.thickness);
      const [r, g, b] = rgb(l.color || rock(l.rockId).color);
      u.uLayerA.value[i].set(r, g, b, acc);
      u.uLayerB.value[i].set(l.pattern != null ? l.pattern : rock(l.rockId).pattern, 0, 0, 0);
    }
    u.uLayerCount.value = n;

    const bm = rock(doc.basementRockId);
    const [br, bg, bb] = rgb(bm.color);
    u.uBasementColor.value.set(br, bg, bb);
    u.uBasementPattern.value = bm.pattern;

    const s = doc.settings;
    u.uPatternStrength.value = s.showPatterns ? 1 : 0;
    u.uContactStrength.value = s.showContacts ? 1 : 0;
    u.uExag.value = s.exaggeration || 1;

    const events = activeEvents(doc);
    for (let i = 0; i < events.length; i++) {
      setEventUniforms(u, uniformPrefix(i), events[i]);
    }
  }
}

// ---------------------------------------------------------------------------

function addEventUniforms(u, p, e) {
  const V3 = () => ({ value: new THREE.Vector3() });
  const V4 = () => ({ value: new THREE.Vector4() });
  const V2 = () => ({ value: new THREE.Vector2() });
  const F = () => ({ value: 0 });

  switch (e.type) {
    case 'tilt':
      u[`${p}_axis`] = V3(); u[`${p}_center`] = V3(); u[`${p}_angle`] = F();
      break;
    case 'fold':
      u[`${p}_perp`] = V3(); u[`${p}_up`] = V3(); u[`${p}_wave`] = V3(); u[`${p}_center`] = V2();
      break;
    case 'domebasin':
      u[`${p}_c`] = V4(); u[`${p}_r`] = V3();
      break;
    case 'fault':
      u[`${p}_normal`] = V3(); u[`${p}_center`] = V3(); u[`${p}_slip`] = V3();
      break;
    case 'dike':
      u[`${p}_normal`] = V3(); u[`${p}_geom`] = V4(); u[`${p}_zrange`] = V2(); u[`${p}_rock`] = V4();
      break;
    case 'pluton':
      u[`${p}_center`] = V3(); u[`${p}_radii`] = V3(); u[`${p}_az`] = F(); u[`${p}_rock`] = V4();
      break;
    case 'unconformity':
      u[`${p}_s0`] = V4(); u[`${p}_s1`] = V4(); u[`${p}_s2`] = V4(); u[`${p}_above`] = F();
      break;
  }
}

function setEventUniforms(u, p, e) {
  switch (e.type) {
    case 'tilt': {
      const { strikeVec } = planeFrame(e.strike, e.dip);
      u[`${p}_axis`].value.set(...strikeVec);
      u[`${p}_center`].value.set(e.centerX || 0, e.centerY || 0, e.centerZ || 0);
      u[`${p}_angle`].value = e.dip * DEG;
      break;
    }
    case 'fold': {
      const { perp, up } = axisFrame(e.trend, e.plunge);
      u[`${p}_perp`].value.set(...perp);
      u[`${p}_up`].value.set(...up);
      u[`${p}_wave`].value.set(
        e.amplitude,
        (2 * Math.PI) / Math.max(1, e.wavelength),
        (e.phase || 0) * DEG,
      );
      u[`${p}_center`].value.set(e.centerX || 0, e.centerY || 0);
      break;
    }
    case 'domebasin':
      u[`${p}_c`].value.set(e.centerX, e.centerY, e.amplitude, (e.azimuth || 0) * DEG);
      u[`${p}_r`].value.set(Math.max(1, e.radiusA), Math.max(1, e.radiusB), 0);
      break;
    case 'fault': {
      const { normal } = planeFrame(e.strike, e.dip);
      const sv = slipVec(e.strike, e.dip, faultRake(e));
      u[`${p}_normal`].value.set(...normal);
      u[`${p}_center`].value.set(e.centerX, e.centerY, e.centerZ);
      u[`${p}_slip`].value.set(sv[0] * e.slip, sv[1] * e.slip, sv[2] * e.slip);
      break;
    }
    case 'dike': {
      const { normal } = planeFrame(e.strike, e.dip);
      const r = rock(e.rockId);
      u[`${p}_normal`].value.set(...normal);
      u[`${p}_geom`].value.set(e.centerX, e.centerY, Math.max(1, e.thickness) * 0.5, 0);
      u[`${p}_zrange`].value.set(Math.min(e.bottomZ, e.topZ), Math.max(e.bottomZ, e.topZ));
      const [cr, cg, cb] = rgb(r.color);
      u[`${p}_rock`].value.set(cr, cg, cb, r.pattern);
      break;
    }
    case 'pluton': {
      const r = rock(e.rockId);
      u[`${p}_center`].value.set(e.centerX, e.centerY, e.centerZ);
      u[`${p}_radii`].value.set(
        Math.max(1, e.radiusX), Math.max(1, e.radiusY), Math.max(1, e.radiusZ),
      );
      u[`${p}_az`].value = (e.azimuth || 0) * DEG;
      const [cr, cg, cb] = rgb(r.color);
      u[`${p}_rock`].value.set(cr, cg, cb, r.pattern);
      break;
    }
    case 'unconformity': {
      const s = e.surface;
      const [base, amp, wl, az, cx, cy, rad, grad, slope, rough] = surfaceUniform(s);
      u[`${p}_s0`].value.set(base, amp, wl, az);
      u[`${p}_s1`].value.set(cx, cy, rad, grad);
      u[`${p}_s2`].value.set(slope, rough, KIND_CODE[s.kind] ?? 0, e.fill === 'drape' ? 0 : 1);
      u[`${p}_above`].value = e.aboveCount;
      break;
    }
  }
}
