// The document model: a stratigraphic column, an ordered geologic history,
// and a topographic surface. Everything the renderer draws is derived from
// this object, and this object is what gets saved to local storage.

import { defaultSurface } from './surfaces.js';
import { wrap360 } from './math.js';

// Both caps exist to keep the generated shader inside the fragment uniform
// budget of older mobile GPUs (GLES 3.0 guarantees only 224 vec4 registers).
export const MAX_LAYERS = 20;
export const MAX_EVENTS = 16;
export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Rock types
// ---------------------------------------------------------------------------
// `pattern` selects a procedural lithology ornament drawn by the fragment
// shader (see PATTERN_* in glsl.js). Colors lean on conventional geologic
// map hues so the blocks read the way a field guide does.

export const ROCKS = [
  { id: 'sandstone',    label: 'Sandstone',    color: '#e8c86a', pattern: 1, group: 'Sedimentary' },
  { id: 'siltstone',    label: 'Siltstone',    color: '#d7c08d', pattern: 10, group: 'Sedimentary' },
  { id: 'shale',        label: 'Shale',        color: '#7d8a83', pattern: 2, group: 'Sedimentary' },
  { id: 'mudstone',     label: 'Mudstone',     color: '#96917c', pattern: 2, group: 'Sedimentary' },
  { id: 'limestone',    label: 'Limestone',    color: '#8fb6cd', pattern: 3, group: 'Sedimentary' },
  { id: 'dolostone',    label: 'Dolostone',    color: '#a9c4b6', pattern: 9, group: 'Sedimentary' },
  { id: 'conglomerate', label: 'Conglomerate', color: '#c9955c', pattern: 4, group: 'Sedimentary' },
  { id: 'coal',         label: 'Coal',         color: '#2f2f33', pattern: 8, group: 'Sedimentary' },
  { id: 'evaporite',    label: 'Evaporite',    color: '#ded0e4', pattern: 11, group: 'Sedimentary' },
  { id: 'basalt',       label: 'Basalt',       color: '#5c6b64', pattern: 6, group: 'Igneous' },
  { id: 'tuff',         label: 'Tuff',         color: '#cbb9a8', pattern: 12, group: 'Igneous' },
  { id: 'granite',      label: 'Granite',      color: '#d98f8f', pattern: 5, group: 'Igneous' },
  { id: 'diorite',      label: 'Diorite',      color: '#b07f95', pattern: 5, group: 'Igneous' },
  { id: 'gabbro',       label: 'Gabbro',       color: '#6e6a80', pattern: 5, group: 'Igneous' },
  { id: 'schist',       label: 'Schist',       color: '#8a9c78', pattern: 7, group: 'Metamorphic' },
  { id: 'gneiss',       label: 'Gneiss',       color: '#c09a86', pattern: 7, group: 'Metamorphic' },
  { id: 'marble',       label: 'Marble',       color: '#dfe3e0', pattern: 3, group: 'Metamorphic' },
  { id: 'quartzite',    label: 'Quartzite',    color: '#e0d3c2', pattern: 1, group: 'Metamorphic' },
  { id: 'basement',     label: 'Basement',     color: '#7a7f8c', pattern: 13, group: 'Metamorphic' },
];

export const ROCK_BY_ID = Object.fromEntries(ROCKS.map((r) => [r.id, r]));

export function rock(id) { return ROCK_BY_ID[id] || ROCK_BY_ID.sandstone; }

// ---------------------------------------------------------------------------
// Fault slip
// ---------------------------------------------------------------------------
// Students think in terms of normal, thrust and strike-slip faults, not in
// terms of rake, so that is what the editor asks for: pick a kind, then dial
// in how oblique it is. Rake is derived from the two, and still displayed,
// because rake is what they will meet in the literature.
//
// `obliquity` runs -90..+90 and always points the same way for a given kind:
//   dip-slip kinds     negative = sinistral, positive = dextral
//   strike-slip kinds  negative = reverse,   positive = normal
// At +/-90 a fault becomes the pure form of the other category.

export const FAULT_KINDS = {
  normal: {
    label: 'Normal', base: 90, sign: 1, neg: 'sinistral', pos: 'dextral',
    blurb: 'Hanging wall drops. Extension.',
  },
  reverse: {
    label: 'Reverse / thrust', base: 270, sign: -1, neg: 'sinistral', pos: 'dextral',
    blurb: 'Hanging wall rides up. Shortening. A low dip makes it a thrust.',
  },
  dextral: {
    label: 'Dextral', base: 180, sign: -1, neg: 'reverse', pos: 'normal',
    blurb: 'Right-lateral: the far side moves to your right.',
  },
  sinistral: {
    label: 'Sinistral', base: 0, sign: 1, neg: 'reverse', pos: 'normal',
    blurb: 'Left-lateral: the far side moves to your left.',
  },
};

export const FAULT_KIND_ORDER = ['normal', 'reverse', 'dextral', 'sinistral'];

/** Rake of the slip vector, in the fault plane, measured from strike. */
export function faultRake(e) {
  const k = FAULT_KINDS[e.kind] || FAULT_KINDS.normal;
  return wrap360(k.base + k.sign * (e.obliquity || 0));
}

/** Recover a kind and obliquity from a bare rake, for older saved files. */
export function faultKindFromRake(rakeDeg) {
  const r = wrap360(rakeDeg);
  const rad = r * Math.PI / 180;
  const dip = Math.sin(rad);
  const strike = Math.cos(rad);

  if (Math.abs(dip) >= Math.abs(strike)) {
    const kind = dip > 0 ? 'normal' : 'reverse';
    const k = FAULT_KINDS[kind];
    return { kind, obliquity: Math.round(signedDelta(r, k.base) / k.sign) };
  }
  const kind = strike > 0 ? 'sinistral' : 'dextral';
  const k = FAULT_KINDS[kind];
  return { kind, obliquity: Math.round(signedDelta(r, k.base) / k.sign) };
}

/** Smallest signed difference a - b, in -180..180. */
function signedDelta(a, b) {
  return ((a - b + 540) % 360) - 180;
}

/** Plain-language description of the slip, e.g. "normal, oblique dextral". */
export function faultSense(e) {
  const k = FAULT_KINDS[e.kind] || FAULT_KINDS.normal;
  const o = e.obliquity || 0;
  const base = k.label.toLowerCase().replace(' / thrust', '');
  if (Math.abs(o) < 8) return base;
  if (Math.abs(o) > 82) return (o > 0 ? k.pos : k.neg);
  return `${base}, oblique ${o > 0 ? k.pos : k.neg}`;
}

// ---------------------------------------------------------------------------
// Event definitions
// ---------------------------------------------------------------------------
// Each entry describes one kind of geologic event: its default parameters and
// the controls the editor should surface for it. `kinematic` events deform
// everything older than themselves; `material` events (intrusions) instead
// paint rock into a region; `unconformity` splits the stratigraphic column.

export const EVENT_TYPES = {
  tilt: {
    label: 'Tilt beds',
    blurb: 'Rotate all older units to a new strike and dip.',
    defaults: () => ({ strike: 0, dip: 25 }),
  },
  fold: {
    label: 'Fold beds',
    blurb: 'Sinusoidal folds about a trending, optionally plunging axis.',
    defaults: () => ({
      trend: 0, plunge: 0, wavelength: 1400, amplitude: 220,
      phase: 0, centerX: 0, centerY: 0,
    }),
  },
  domebasin: {
    label: 'Dome / Basin',
    blurb: 'Radial upwarp or downwarp — bullseye map pattern.',
    defaults: () => ({
      centerX: 0, centerY: 0, amplitude: 300,
      radiusA: 800, radiusB: 800, azimuth: 0,
    }),
  },
  fault: {
    label: 'Fault',
    blurb: 'Planar fault; the hanging wall slips by a set amount.',
    defaults: () => ({
      strike: 0, dip: 60, kind: 'normal', obliquity: 0, slip: 250,
      centerX: 0, centerY: 0, centerZ: -400,
    }),
  },
  dike: {
    label: 'Dike / Sill',
    blurb: 'Tabular intrusion cutting everything older than it.',
    defaults: () => ({
      strike: 90, dip: 90, thickness: 90,
      centerX: 0, centerY: 0, rockId: 'basalt',
      topZ: 400, bottomZ: -2000,
    }),
  },
  pluton: {
    label: 'Pluton',
    blurb: 'Ellipsoidal intrusive body.',
    defaults: () => ({
      centerX: 0, centerY: 0, centerZ: -700,
      radiusX: 600, radiusY: 600, radiusZ: 500,
      azimuth: 0, rockId: 'granite',
    }),
  },
  unconformity: {
    label: 'Unconformity',
    blurb: 'Erode down to a surface, then bury it under younger units.',
    defaults: () => ({
      aboveCount: 2,
      // 'flat'  — younger beds lie horizontally and onlap the old surface,
      //           the classic angular unconformity.
      // 'drape' — younger beds parallel the buried surface, as they do over
      //           an irregular erosional topography.
      fill: 'flat',
      // `base` is ignored here: an unconformity's datum is derived from
      // aboveCount by unconformityDatums(). Only the relief is read.
      surface: defaultSurface({ kind: 'hills', amplitude: 90, wavelength: 1100 }),
    }),
  },
};

export const EVENT_ORDER = ['tilt', 'fold', 'domebasin', 'fault', 'dike', 'pluton', 'unconformity'];

let idCounter = 1;
export function newId(prefix = 'e') {
  return `${prefix}${(idCounter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function makeEvent(type, over = {}) {
  const def = EVENT_TYPES[type];
  if (!def) throw new Error(`unknown event type: ${type}`);
  return {
    id: newId('ev'),
    type,
    name: def.label,
    enabled: true,
    ...def.defaults(),
    ...over,
  };
}

export function makeLayer(rockId, thickness, over = {}) {
  const r = rock(rockId);
  return {
    id: newId('ly'),
    rockId,
    name: r.label,
    thickness,
    color: r.color,
    pattern: r.pattern,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function defaultDocument() {
  return {
    version: SCHEMA_VERSION,
    name: 'Untitled block',
    // cutE / cutN trim the east and north walls inward to expose interior
    // cross-sections without changing the geology.
    block: { width: 2000, depth: 2000, height: 1400, cutE: 0, cutN: 0 },
    // Layers run youngest (index 0, at the top) to oldest.
    layers: [
      makeLayer('sandstone', 160),
      makeLayer('shale', 220),
      makeLayer('limestone', 180),
      makeLayer('siltstone', 140),
      makeLayer('conglomerate', 200),
      makeLayer('shale', 260),
    ],
    basementRockId: 'basement',
    // Events run oldest (index 0) to youngest — the order they happened.
    events: [],
    topo: defaultSurface({ kind: 'flat', base: 0 }),
    settings: {
      showContacts: true,
      showPatterns: true,
      quality: 'auto',      // 'auto' | 'high' | 'low'
      showCompass: true,
      showEventGuides: true,
      showContours: true,
      contourInterval: 0,   // 0 = choose one from the terrain's relief
      exaggeration: 1,
    },
  };
}

/** Cumulative depth (m below the top of the column) of the base of each layer. */
export function cumulativeDepths(layers) {
  const out = new Float32Array(MAX_LAYERS);
  let acc = 0;
  for (let i = 0; i < layers.length && i < MAX_LAYERS; i++) {
    acc += Math.max(0.5, layers[i].thickness);
    out[i] = acc;
  }
  return out;
}

export function totalThickness(layers) {
  return layers.reduce((a, l) => a + Math.max(0.5, l.thickness), 0);
}

/**
 * Where each unconformity's erosion surface sits, keyed by event id.
 *
 * The datum is not a free parameter. An unconformity buries its erosion
 * surface under the units deposited on top of it, so the surface has to sit at
 * the base of exactly those units. Let the two be set independently and they
 * contradict each other: hang the younger stack off a datum that is too
 * shallow and it floats off the top of the block, taking the youngest unit out
 * of sight; too deep and the lowest units have nowhere to be. So the datum is
 * derived from `aboveCount`, and the surface's *relief* is what the user sets
 * — which is the part that does the geological work, truncating the older beds
 * and giving the younger ones something to onlap.
 *
 * Walking youngest-first is what makes stacked unconformities come out right:
 * each one can only claim units the younger ones left behind, which is also
 * why `above` is clamped from below by the one above it.
 *
 * Returns Map(eventId -> { above, base }), with `above` already clamped.
 */
export function unconformityDatums(doc) {
  const cum = cumulativeDepths(doc.layers);
  const hi = doc.layers.length;
  const events = doc.events.filter((e) => e.enabled !== false);
  const out = new Map();
  let lo = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== 'unconformity') continue;
    const above = Math.min(Math.max(lo, e.aboveCount | 0), hi);
    out.set(e.id, { above, base: -(above > 0 ? cum[above - 1] : 0) });
    lo = above;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Teaching presets
// ---------------------------------------------------------------------------

export const PRESETS = [
  {
    id: 'flat',
    label: 'Flat-lying strata',
    blurb: 'Undeformed layer cake — the starting point.',
    build: () => [],
  },
  {
    id: 'tilted',
    label: 'Tilted beds',
    blurb: 'One tilt event. Read strike and dip off the map face.',
    build: () => [makeEvent('tilt', { strike: 45, dip: 30 })],
  },
  {
    id: 'anticline',
    label: 'Anticline & syncline',
    blurb: 'Upright folds. Oldest rocks core the anticline.',
    build: () => [makeEvent('fold', { trend: 0, plunge: 0, wavelength: 1600, amplitude: 300 })],
  },
  {
    id: 'plunging',
    label: 'Plunging fold',
    blurb: 'Nose-shaped outcrop pattern that closes in the plunge direction.',
    build: () => [makeEvent('fold', { trend: 20, plunge: 18, wavelength: 1500, amplitude: 320 })],
  },
  {
    id: 'dome',
    label: 'Dome',
    blurb: 'Bullseye map pattern, oldest unit in the middle.',
    build: () => [makeEvent('domebasin', { amplitude: 420, radiusA: 850, radiusB: 850 })],
  },
  {
    id: 'basin',
    label: 'Structural basin',
    blurb: 'Bullseye map pattern, youngest unit in the middle.',
    build: () => [makeEvent('domebasin', { amplitude: -420, radiusA: 850, radiusB: 850 })],
  },
  {
    id: 'normalfault',
    label: 'Normal fault',
    blurb: 'Hanging wall drops. Extension.',
    build: () => [makeEvent('fault', { strike: 0, dip: 60, kind: 'normal', slip: 320, name: 'Normal fault' })],
  },
  {
    id: 'reversefault',
    label: 'Reverse fault',
    blurb: 'Hanging wall rides up. Shortening.',
    build: () => [makeEvent('fault', { strike: 0, dip: 35, kind: 'reverse', slip: 320, name: 'Reverse fault' })],
  },
  {
    id: 'strikeslip',
    label: 'Strike-slip fault',
    blurb: 'Vertical fault, dextral offset of the map pattern.',
    build: () => [
      makeEvent('tilt', { strike: 90, dip: 12 }),
      makeEvent('fault', { strike: 0, dip: 90, kind: 'dextral', slip: 420, name: 'Dextral fault' }),
    ],
  },
  {
    id: 'horstgraben',
    label: 'Horst & graben',
    blurb: 'Two conjugate normal faults dropping a central block.',
    build: () => [
      makeEvent('fault', { strike: 0, dip: 62, kind: 'normal', slip: 300, centerX: -420, name: 'Graben fault (W)' }),
      makeEvent('fault', { strike: 180, dip: 62, kind: 'normal', slip: 300, centerX: 420, name: 'Graben fault (E)' }),
    ],
  },
  {
    id: 'unconformity',
    label: 'Angular unconformity',
    blurb: 'Tilt, erode, then bury under flat-lying beds.',
    build: () => [
      makeEvent('tilt', { strike: 0, dip: 35 }),
      makeEvent('unconformity', { aboveCount: 2, name: 'Angular unconformity' }),
    ],
  },
  {
    id: 'dike',
    label: 'Dike swarm',
    blurb: 'Igneous sheets cutting the section — cross-cutting relations.',
    build: () => [
      makeEvent('dike', { strike: 20, dip: 82, thickness: 70, centerX: -350 }),
      makeEvent('dike', { strike: 20, dip: 85, thickness: 55, centerX: 180 }),
    ],
  },
  {
    id: 'pluton',
    label: 'Pluton & contact',
    blurb: 'A granite body intruding folded strata.',
    build: () => [
      makeEvent('fold', { trend: 90, plunge: 0, wavelength: 1500, amplitude: 240 }),
      makeEvent('pluton', { centerZ: -650, radiusX: 620, radiusY: 520, radiusZ: 520 }),
    ],
  },
  {
    id: 'foldthrust',
    label: 'Fold & thrust',
    blurb: 'Shortening: fold first, then a low-angle thrust cuts it.',
    build: () => [
      makeEvent('fold', { trend: 0, plunge: 0, wavelength: 1500, amplitude: 260 }),
      makeEvent('fault', { strike: 0, dip: 25, kind: 'reverse', slip: 500, centerX: -200, name: 'Thrust fault' }),
    ],
  },
];
