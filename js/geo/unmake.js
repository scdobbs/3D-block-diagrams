// "Unmaking" — the inverse geologic history.
//
// The whole model rests on one idea. To find out what rock sits at a point in
// the block today, you run the history backwards: undo the youngest event,
// then the next youngest, and so on, until the point lands back in the
// undeformed layer cake it was deposited in. Then you just ask which layer
// that depth falls in.
//
// Every deformation here is exactly invertible:
//   tilt   - rigid rotation about a horizontal axis
//   fold   - an upright fold (vertical displacement, wave across `perp`)
//            followed by a rigid tilt about `perp`; neither step changes the
//            `perp` coordinate the wave is read from
//   dome   - vertical displacement depending only on (x, y)
//   fault  - rigid translation of the hanging wall parallel to the fault
//            plane, so the side test is unchanged by the slip itself
//
// This module is the CPU twin of the generated shader in glsl.js. It exists
// so the app can answer "what unit did I just tap on?" without a GPU
// readback, and so the geology can be unit-tested. Keep the two in step.

import {
  planeFrame, axisFrame, slipVec, rotateAbout, normalToStrikeDip, dot, sub, DEG,
} from './math.js';
import { surfaceHeight } from './surfaces.js';
import { cumulativeDepths, totalThickness, faultRake } from './model.js';

/**
 * Precompute the per-event vectors so a point query is just arithmetic.
 * Call once per document change, then reuse for many points.
 */
export function compileHistory(doc) {
  const events = doc.events.filter((e) => e.enabled !== false);
  const compiled = events.map((e) => {
    switch (e.type) {
      case 'tilt': {
        const { strikeVec } = planeFrame(e.strike, e.dip);
        return { ...e, axis: strikeVec };
      }
      case 'fold': {
        const { perp } = axisFrame(e.trend, e.plunge);
        return { ...e, perp };
      }
      case 'fault': {
        const { normal } = planeFrame(e.strike, e.dip);
        const u = slipVec(e.strike, e.dip, faultRake(e));
        return { ...e, normal, slip3: [u[0] * e.slip, u[1] * e.slip, u[2] * e.slip] };
      }
      case 'dike': {
        const { normal } = planeFrame(e.strike, e.dip);
        return { ...e, normal };
      }
      default:
        return { ...e };
    }
  });

  const cum = cumulativeDepths(doc.layers);
  return {
    events: compiled,
    layers: doc.layers,
    cum,
    total: totalThickness(doc.layers),
    basementRockId: doc.basementRockId,
  };
}

/**
 * Undo a single kinematic event. Returns the position the point occupied
 * before the event happened.
 */
function undoEvent(e, p) {
  switch (e.type) {
    case 'tilt': {
      const c = [e.centerX || 0, e.centerY || 0, e.centerZ || 0];
      const r = rotateAbout(sub(p, c), e.axis, -e.dip);
      return [r[0] + c[0], r[1] + c[1], r[2] + c[2]];
    }
    case 'fold': {
      // Undo the plunge tilt first, then the upright fold beneath it.
      const cx = e.centerX || 0;
      const cy = e.centerY || 0;
      const d = rotateAbout([p[0] - cx, p[1] - cy, p[2]], e.perp, e.plunge || 0);
      const k = (2 * Math.PI) / Math.max(1, e.wavelength);
      // Rotating about `perp` leaves the `perp` component untouched, and the
      // fold displaces along z, which is also orthogonal to `perp`. So the
      // wave coordinate survives both steps and the inverse stays exact.
      const off = e.amplitude * Math.cos(k * dot(d, e.perp) + (e.phase || 0) * DEG);
      return [d[0] + cx, d[1] + cy, d[2] - off];
    }
    case 'domebasin': {
      const az = (e.azimuth || 0) * DEG;
      const dx = p[0] - e.centerX;
      const dy = p[1] - e.centerY;
      // Rotate into the ellipse's own frame before normalizing the radii.
      const ex = dx * Math.cos(az) - dy * Math.sin(az);
      const ey = dx * Math.sin(az) + dy * Math.cos(az);
      const t = Math.hypot(ex / Math.max(1, e.radiusA), ey / Math.max(1, e.radiusB));
      const off = t >= 1 ? 0 : e.amplitude * 0.5 * (1 + Math.cos(Math.PI * t));
      return [p[0], p[1], p[2] - off];
    }
    case 'fault': {
      const c = [e.centerX, e.centerY, e.centerZ];
      // Slip is parallel to the plane, so this side test gives the same
      // answer before and after the slip is removed.
      const side = dot(sub(p, c), e.normal);
      if (side <= 0) return p; // footwall: never moved
      return [p[0] - e.slip3[0], p[1] - e.slip3[1], p[2] - e.slip3[2]];
    }
    default:
      return p;
  }
}

/** Is this point inside an intrusive body, in that body's own time frame? */
function insideIntrusion(e, p) {
  if (e.type === 'dike') {
    const c = [e.centerX, e.centerY, 0];
    const d = Math.abs(dot(sub(p, c), e.normal));
    if (d > e.thickness * 0.5) return false;
    return p[2] <= e.topZ && p[2] >= e.bottomZ;
  }
  if (e.type === 'pluton') {
    const az = (e.azimuth || 0) * DEG;
    const dx = p[0] - e.centerX;
    const dy = p[1] - e.centerY;
    const ex = dx * Math.cos(az) - dy * Math.sin(az);
    const ey = dx * Math.sin(az) + dy * Math.cos(az);
    const ez = p[2] - e.centerZ;
    const t = Math.hypot(
      ex / Math.max(1, e.radiusX),
      ey / Math.max(1, e.radiusY),
      ez / Math.max(1, e.radiusZ),
    );
    return t <= 1;
  }
  return false;
}

/**
 * Which layer contains `depth`, measured downward from the top of the
 * sub-column [lo, hi)? Returns a layer index, or -1 for basement.
 * Points above the top of the column extend the topmost unit — the block has
 * to be made of something, and repeating the youngest unit reads correctly.
 */
function layerAt(h, depth, lo, hi) {
  if (depth <= 0) return lo < hi ? lo : -1;
  const base = lo > 0 ? h.cum[lo - 1] : 0;
  for (let i = lo; i < hi; i++) {
    if (depth < h.cum[i] - base) return i;
  }
  return -1;
}

/**
 * The rock at world point `p` today.
 * Returns { kind: 'layer', index } | { kind: 'intrusion', event } | { kind: 'basement' }
 */
export function rockAt(h, p0) {
  let p = [p0[0], p0[1], p0[2]];
  let lo = 0;                 // top of the currently-active sub-column
  const hi = h.layers.length;

  for (let i = h.events.length - 1; i >= 0; i--) {
    const e = h.events[i];

    if (e.type === 'unconformity') {
      const above = Math.min(Math.max(0, e.aboveCount | 0), hi);
      // Anything above the erosion surface was deposited after it.
      const u = surfaceHeight(e.surface, p[0], p[1]);
      if (p[2] > u) {
        let tPost = 0;
        for (let k = lo; k < above; k++) tPost += Math.max(0.5, h.layers[k].thickness);
        const datum = e.fill === 'drape' ? u : e.surface.base;
        const idx = layerAt(h, datum + tPost - p[2], lo, above);
        return idx < 0 ? { kind: 'basement' } : { kind: 'layer', index: idx };
      }
      // Below it: keep walking back, now restricted to the older units.
      lo = above;
      continue;
    }

    if (e.type === 'dike' || e.type === 'pluton') {
      if (insideIntrusion(e, p)) return { kind: 'intrusion', event: e };
      continue;
    }

    p = undoEvent(e, p);
  }

  const idx = layerAt(h, -p[2], lo, hi);
  return idx < 0 ? { kind: 'basement' } : { kind: 'layer', index: idx };
}

/**
 * Continuous stratigraphic depth at a point: how far below the top of its own
 * sub-column the point sits, in metres. `rockAt` is this quantity bucketed
 * into units; keeping the un-bucketed value lets us differentiate it.
 */
export function stratDepth(h, p0) {
  let p = [p0[0], p0[1], p0[2]];
  let lo = 0;
  const hi = h.layers.length;

  for (let i = h.events.length - 1; i >= 0; i--) {
    const e = h.events[i];
    if (e.type === 'unconformity') {
      const above = Math.min(Math.max(0, e.aboveCount | 0), hi);
      const u = surfaceHeight(e.surface, p[0], p[1]);
      if (p[2] > u) {
        let tPost = 0;
        for (let k = lo; k < above; k++) tPost += Math.max(0.5, h.layers[k].thickness);
        const datum = e.fill === 'drape' ? u : e.surface.base;
        return datum + tPost - p[2];
      }
      lo = above;
      continue;
    }
    if (e.type === 'dike' || e.type === 'pluton') continue;
    p = undoEvent(e, p);
  }
  return -p[2];
}

/**
 * Orientation of bedding at a point, recovered the way a field measurement
 * works: the beds are surfaces of constant stratigraphic depth, so the
 * gradient of that scalar field is normal to bedding.
 *
 * Returns null inside an intrusion, where bedding is meaningless.
 */
export function beddingAt(h, p, eps = 1.5) {
  if (rockAt(h, p).kind === 'intrusion') return null;
  const gx = stratDepth(h, [p[0] + eps, p[1], p[2]]) - stratDepth(h, [p[0] - eps, p[1], p[2]]);
  const gy = stratDepth(h, [p[0], p[1] + eps, p[2]]) - stratDepth(h, [p[0], p[1] - eps, p[2]]);
  const gz = stratDepth(h, [p[0], p[1], p[2] + eps]) - stratDepth(h, [p[0], p[1], p[2] - eps]);
  const g = [gx, gy, gz];
  if (!Number.isFinite(gx + gy + gz) || Math.hypot(gx, gy, gz) < 1e-9) return null;
  // Depth grows downward, so the up-facing bed normal is the negated gradient.
  return normalToStrikeDip([-g[0], -g[1], -g[2]]);
}

/** Human-readable description of the unit at a point. */
export function describeAt(h, p) {
  const r = rockAt(h, p);
  if (r.kind === 'basement') return { label: 'Basement', rockId: h.basementRockId, detail: 'below the mapped section' };
  if (r.kind === 'intrusion') {
    return { label: r.event.name, rockId: r.event.rockId, detail: r.event.type === 'dike' ? 'tabular intrusion' : 'intrusive body' };
  }
  const layer = h.layers[r.index];
  return {
    label: layer.name,
    rockId: layer.rockId,
    detail: `unit ${h.layers.length - r.index} of ${h.layers.length} · ${Math.round(layer.thickness)} m thick`,
    index: r.index,
  };
}
