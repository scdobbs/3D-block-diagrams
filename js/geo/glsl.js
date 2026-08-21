// Shader generation.
//
// Rather than meshing the geology (slow, and it looks chewed at layer
// contacts), the block is drawn as a plain box-with-a-lid and every fragment
// works out its own rock: take the fragment's world position, run the
// geologic history backwards, see which layer it lands in. Contacts come out
// pin-sharp at any zoom because nothing is ever tessellated.
//
// The history's *shape* — how many events, of which types, in what order —
// is baked into generated source, so the inverse chain is a straight run of
// arithmetic with no branching over an event array. The history's *numbers*
// are uniforms, so dragging a dip slider costs a uniform upload, not a
// recompile. Recompiles happen only when events are added, removed,
// reordered, or toggled.
//
// This file must stay numerically identical to js/geo/unmake.js.

import { MAX_LAYERS } from './model.js';

// ---------------------------------------------------------------------------
// Shared GLSL preamble
// ---------------------------------------------------------------------------

const COMMON = /* glsl */ `
#define MAX_LAYERS ${MAX_LAYERS}
#define PI 3.141592653589793

uniform vec4  uLayerA[MAX_LAYERS];   // rgb = color, a = cumulative depth (m)
uniform vec4  uLayerB[MAX_LAYERS];   // x = lithology pattern id
uniform int   uLayerCount;
uniform vec3  uBasementColor;
uniform float uBasementPattern;

/** Cumulative depth after the first n layers. Looped, not indexed, because
    GLSL ES 1.00 forbids indexing a uniform array with a computed index. */
float cumAt(int n) {
  float b = 0.0;
  for (int i = 0; i < MAX_LAYERS; i++) {
    if (i >= n) break;
    b = uLayerA[i].a;
  }
  return b;
}

/** Rodrigues rotation of v about unit axis k by aRad. */
vec3 rotAbout(vec3 v, vec3 k, float aRad) {
  float c = cos(aRad), s = sin(aRad);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

/** Smooth relief field — the GLSL twin of hillField() in surfaces.js. */
float hillField(vec2 p, float wl) {
  float k = (2.0 * PI) / max(1e-3, wl);
  float h =
      0.55 * sin(k * (0.90 * p.x + 0.44 * p.y))
    + 0.32 * sin(k * 1.7 * (-0.42 * p.x + 0.91 * p.y) + 2.1)
    + 0.18 * sin(k * 2.9 * (0.74 * p.x - 0.67 * p.y) + 4.3);
  return h / 1.05;
}

/**
 * Surface height. Packed parameters, so changing the landform kind is a
 * uniform update rather than a recompile:
 *   a = (base, amplitude, wavelength, azimuth)
 *   b = (centerX, centerY, radius, gradient)
 *   c = (slopeAngle, roughness, kindCode, unused)
 */
float surfH(vec4 a, vec4 b, vec4 c, vec2 xy) {
  // Flat means flat: roughness is remembered but must not leak into a plain.
  if (c.z < 0.5) return a.x;

  float az = radians(a.w);
  vec2 along = vec2(sin(az), cos(az));
  vec2 perpv = vec2(cos(az), -sin(az));
  vec2 d = xy - b.xy;
  float u = dot(d, along);
  float v = dot(d, perpv);

  float kind = c.z;
  float h = 0.0;

  if (kind < 0.5) {                       // flat
    h = 0.0;
  } else if (kind < 1.5) {                // slope
    h = -u * tan(radians(c.x));
  } else if (kind < 2.5) {                // hills
    h = a.y * hillField(xy, a.z);
  } else if (kind < 3.5) {                // valley
    h = -a.y * max(0.0, 1.0 - abs(v) / max(1e-3, b.z)) - b.w * (u / 1000.0);
  } else if (kind < 4.5) {                // ridge
    h = a.y * max(0.0, 1.0 - abs(v) / max(1e-3, b.z)) - b.w * (u / 1000.0);
  } else {                                // mountain
    float t = length(d) / max(1e-3, b.z);
    h = t >= 1.0 ? 0.0 : a.y * 0.5 * (1.0 + cos(PI * t));
  }

  if (c.y > 0.0) {
    h += c.y * a.y * 0.35 * hillField(xy, max(1e-3, a.z) * 0.45);
  }
  return a.x + h;
}
`;

// ---------------------------------------------------------------------------
// Per-event uniform declarations and inverse-transform source
// ---------------------------------------------------------------------------
// Each generator returns { decl, code }. `code` runs with `p` holding the
// point being walked back through time, `lo`/`hi` bracketing the currently
// active part of the stratigraphic column, and `uid` as an out parameter.

function emitTilt(p) {
  return {
    decl: `uniform vec3 ${p}_axis; uniform vec3 ${p}_center; uniform float ${p}_angle;`,
    code: `  p = rotAbout(p - ${p}_center, ${p}_axis, -${p}_angle) + ${p}_center;`,
  };
}

function emitFold(p) {
  return {
    decl: `uniform vec3 ${p}_perp; uniform vec3 ${p}_wave; uniform vec3 ${p}_center; uniform float ${p}_plunge;`,
    // _wave = (amplitude, angular wavenumber, phase in radians)
    code: `  {
    // A plunging fold is an upright fold that was tilted about the horizontal
    // axis perpendicular to its trend, so undo the tilt first. Leaning the
    // displacement direction instead would only shear the fold: the wave
    // would still depend on horizontal position alone, which leaves the
    // hinge of a flat bed horizontal no matter how far it is leaned.
    vec3 d = rotAbout(p - ${p}_center, ${p}_perp, ${p}_plunge);
    d.z -= ${p}_wave.x * cos(${p}_wave.y * dot(d, ${p}_perp) + ${p}_wave.z);
    p = d + ${p}_center;
  }`,
  };
}

function emitDomeBasin(p) {
  return {
    decl: `uniform vec4 ${p}_c; uniform vec3 ${p}_r;`,
    // _c = (centerX, centerY, amplitude, azimuthRadians), _r = (radiusA, radiusB, unused)
    code: `  {
    vec2 d = p.xy - ${p}_c.xy;
    float ca = cos(${p}_c.w), sa = sin(${p}_c.w);
    vec2 e = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
    float t = length(e / max(vec2(1.0), ${p}_r.xy));
    p.z -= t >= 1.0 ? 0.0 : ${p}_c.z * 0.5 * (1.0 + cos(PI * t));
  }`,
  };
}

function emitFault(p) {
  return {
    decl: `uniform vec3 ${p}_normal; uniform vec3 ${p}_center; uniform vec3 ${p}_slip;`,
    // Slip lies in the fault plane, so removing it cannot move a point across
    // the plane — the hanging-wall test is the same before and after.
    code: `  if (dot(p - ${p}_center, ${p}_normal) > 0.0) p -= ${p}_slip;`,
  };
}

function emitDike(p) {
  return {
    decl: `uniform vec3 ${p}_normal; uniform vec4 ${p}_geom; uniform vec2 ${p}_zrange; uniform vec4 ${p}_rock;`,
    // _geom = (centerX, centerY, halfThickness, unused), _rock = (rgb, patternId)
    code: `  if (abs(dot(p - vec3(${p}_geom.xy, 0.0), ${p}_normal)) <= ${p}_geom.z
      && p.z <= ${p}_zrange.y && p.z >= ${p}_zrange.x) {
    uid = ${p}_UID; return vec4(${p}_rock.rgb, ${p}_rock.w);
  }`,
  };
}

function emitPluton(p) {
  return {
    decl: `uniform vec3 ${p}_center; uniform vec3 ${p}_radii; uniform float ${p}_az; uniform vec4 ${p}_rock;`,
    code: `  {
    vec3 d = p - ${p}_center;
    float ca = cos(${p}_az), sa = sin(${p}_az);
    vec3 e = vec3(d.x * ca - d.y * sa, d.x * sa + d.y * ca, d.z);
    if (length(e / max(vec3(1.0), ${p}_radii)) <= 1.0) {
      uid = ${p}_UID; return vec4(${p}_rock.rgb, ${p}_rock.w);
    }
  }`,
  };
}

function emitUnconformity(p) {
  return {
    decl: `uniform vec4 ${p}_s0; uniform vec4 ${p}_s1; uniform vec4 ${p}_s2; uniform float ${p}_above;`,
    code: `  {
    int above = int(${p}_above + 0.5);
    above = min(above, hi);
    above = max(above, lo);
    float usurf = surfH(${p}_s0, ${p}_s1, ${p}_s2, p.xy);
    if (p.z > usurf) {
      // Above the erosion surface: these units were deposited after it, and
      // none of the older history touched them. s2.w picks whether they lie
      // flat (onlapping the old surface) or drape it. Onlapping beds have to
      // fill the paleotopography they were laid down on, so the deepest of
      // them infills wherever the old surface drops below the base of the
      // flat-lying stack — hence the true.
      float tPost = cumAt(above) - cumAt(lo);
      float datum = mix(usurf, ${p}_s0.x, ${p}_s2.w);
      return pickLayer(datum + tPost - p.z, lo, above, true, uid);
    }
    lo = above;   // below it: keep walking back, older units only
  }`,
  };
}

const EMITTERS = {
  tilt: emitTilt,
  fold: emitFold,
  domebasin: emitDomeBasin,
  fault: emitFault,
  dike: emitDike,
  pluton: emitPluton,
  unconformity: emitUnconformity,
};

export function uniformPrefix(index) { return `ev${index}`; }

// ---------------------------------------------------------------------------
// Lithology patterns
// ---------------------------------------------------------------------------

const PATTERNS = /* glsl */ `
float aastep(float t, float v) {
  float w = fwidth(v) * 0.8 + 1e-5;
  return smoothstep(t - w, t + w, v);
}
float band(float t, float v) { return 1.0 - aastep(t, abs(v)); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

vec2 stagger(vec2 q) { return vec2(q.x + mod(floor(q.y), 2.0) * 0.5, q.y); }

float pDots(vec2 q, float r) {
  vec2 g = fract(stagger(q)) - 0.5;
  return band(r, length(g));
}
float pDash(vec2 q) {
  vec2 s = stagger(q);
  return band(0.055, fract(q.y) - 0.5) * band(0.30, fract(s.x) - 0.5);
}
float pBrick(vec2 q) {
  // Horizontal mortar sits on the row BOUNDARY (fract(q.y) == 0) and the
  // vertical tick spans the row. Putting the horizontal line through the row
  // center instead makes the two cross and reads as plus signs, not bricks.
  vec2 s = stagger(q);
  float course = band(0.045, fract(q.y + 0.5) - 0.5);
  float head = band(0.045, fract(s.x) - 0.5);
  return max(course, head);
}
float pPebble(vec2 q) {
  vec2 id = floor(q);
  vec2 g = fract(q) - 0.5;
  vec2 off = (vec2(hash2(id + vec2(3.1, 7.7)), hash2(id + vec2(9.3, 1.4))) - 0.5) * 0.36;
  float r = 0.17 + 0.15 * hash2(id);
  return band(0.038, length(g - off) - r);
}
float pCross(vec2 q) {
  vec2 g = fract(stagger(q)) - 0.5;
  float a = band(0.035, g.x) * band(0.15, g.y);
  float b = band(0.035, g.y) * band(0.15, g.x);
  return max(a, b);
}
float pChevron(vec2 q) {
  vec2 g = fract(stagger(q)) - 0.5;
  return band(0.05, abs(g.x) - g.y - 0.06) * band(0.26, g.x);
}
float pWave(vec2 q) {
  float y = q.y + 0.12 * sin(q.x * 2.0 * PI);
  return band(0.05, fract(y) - 0.5);
}
float pDolo(vec2 q) {
  vec2 g = fract(stagger(q)) - 0.5;
  float box = band(0.32, g.x) * band(0.32, g.y);
  return max(pBrick(q), band(0.032, g.x - g.y) * box);
}

/** Steeply inclined, contorted foliation — undifferentiated basement. */
float pBasement(vec2 q) {
  // The line family is y + m*x = const, so the fabric genuinely LEANS. Adding
  // a shear to x instead only shifts each line along itself, which leaves the
  // foliation horizontal and merely re-folds it.
  const float lean = 1.1;
  float y = (q.y + q.x * lean) * 0.8
          + 0.20 * sin(q.x * 2.0 * PI * 0.5)
          + 0.10 * sin(q.y * 2.0 * PI * 0.85 + 1.7);
  return band(0.06, fract(y) - 0.5);
}
float pVert(vec2 q) {
  vec2 s = stagger(q);
  return band(0.055, fract(s.x) - 0.5) * band(0.30, fract(q.y) - 0.5);
}

/** Ink coverage 0..1 for a lithology pattern id, in pattern-cell space. */
float patternInk(float id, vec2 q) {
  if (id < 0.5) return 0.0;                       // 0  none
  if (id < 1.5) return pDots(q, 0.075);           // 1  sandstone
  if (id < 2.5) return pDash(q);                  // 2  shale / mudstone
  if (id < 3.5) return pBrick(q);                 // 3  limestone / marble
  if (id < 4.5) return pPebble(q);                // 4  conglomerate
  if (id < 5.5) return pCross(q);                 // 5  plutonic
  if (id < 6.5) return pChevron(q);               // 6  volcanic
  if (id < 7.5) return pWave(q);                  // 7  metamorphic
  if (id < 8.5) return 0.0;                       // 8  coal (solid)
  if (id < 9.5) return pDolo(q);                  // 9  dolostone
  if (id < 10.5) return pDots(q * 2.4, 0.06);     // 10 siltstone
  if (id < 11.5) return pVert(q);                 // 11 evaporite
  if (id < 12.5) return max(pDots(q * 1.6, 0.05), pChevron(q) * 0.7); // 12 tuff
  return pBasement(q);                            // 13 basement
}
`;

// ---------------------------------------------------------------------------
// Vertex shader
// ---------------------------------------------------------------------------

export const VERTEX = /* glsl */ `
uniform float uExag;
attribute float top;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vTop;

void main() {
  vTop = top;
  // vWorld stays in true geologic coordinates so the history walk is honest.
  // Vertical exaggeration is applied by scaling the mesh itself (which keeps
  // raycasting for the identify tool working), so all this shader has to do
  // is un-skew the normal for lighting.
  vWorld = position;
  vNrm = normalize(vec3(normal.xy, normal.z / max(0.001, uExag)));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Fragment shader assembly
// ---------------------------------------------------------------------------

/**
 * Build the fragment shader for a given event list.
 * `events` must already be filtered to the enabled ones, oldest first.
 */
export function buildFragmentShader(events) {
  const decls = [];
  const uidDefs = [];
  const body = [];

  // Walk the history backwards: youngest event undone first.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const emit = EMITTERS[e.type];
    if (!emit) continue;
    const p = uniformPrefix(i);
    const { decl, code } = emit(p);
    decls.push(decl);
    if (e.type === 'dike' || e.type === 'pluton') {
      uidDefs.push(`#define ${p}_UID ${(100 + i).toFixed(1)}`);
    }
    body.push(`  // ${e.name} (${e.type})`);
    body.push(code);
  }

  return /* glsl */ `
precision highp float;
${COMMON}
${PATTERNS}
${uidDefs.join('\n')}
${decls.join('\n')}

uniform float uPatternScale;
uniform float uPatternStrength;
uniform float uContactStrength;
uniform vec3  uLightDir;
uniform float uSamples;
uniform float uExag;

uniform float uContourInterval;
uniform float uContourIndexEvery;
uniform vec4  uLabelSpots[24];   // (x, y, gap radius, unused)
uniform int   uLabelCount;

varying vec3 vWorld;
varying vec3 vNrm;
varying float vTop;

/**
 * Pick a unit by depth below the top of the sub-column [lo, hi).
 * Depths at or above the top extend the youngest unit of that sub-column:
 * the block has to be made of something everywhere, and repeating the top
 * unit is the reading a geologist expects.
 *
 * infill extends the DEEPEST unit downward instead of falling through to
 * basement — see layerAt() in unmake.js. The deepest unit is carried along in
 * the walk rather than looked up afterwards, because GLSL ES 1.00 forbids
 * indexing a uniform array with a computed index.
 *
 * (No backticks in here: this whole block sits inside a JS template literal.)
 */
vec4 pickLayer(float depth, int lo, int hi, bool infill, out float uid) {
  float base = cumAt(lo);
  vec4 deepest = vec4(0.0);
  float deepestUid = 0.0;
  for (int i = 0; i < MAX_LAYERS; i++) {
    if (i < lo) continue;
    if (i >= hi) break;
    if (depth <= 0.0 || depth < uLayerA[i].a - base) {
      uid = float(i) + 1.0;
      return vec4(uLayerA[i].rgb, uLayerB[i].x);
    }
    deepest = vec4(uLayerA[i].rgb, uLayerB[i].x);
    deepestUid = float(i) + 1.0;
  }
  if (infill && deepestUid > 0.5) {
    uid = deepestUid;
    return deepest;
  }
  uid = 0.0;
  return vec4(uBasementColor, uBasementPattern);
}

/** Run the history backwards and report the rock at P. */
vec4 rockSample(vec3 P, out float uid) {
  vec3 p = P;
  int lo = 0;
  int hi = uLayerCount;
  uid = 0.0;
${body.join('\n')}
  return pickLayer(-p.z, lo, hi, false, uid);
}

void main() {
  vec3 n = normalize(vNrm);

  // Screen-space footprint of this fragment, used both to supersample the
  // geology (layer contacts are shader-computed, so MSAA cannot help them)
  // and to fade lithology patterns out before they alias.
  vec3 ddx = dFdx(vWorld);
  vec3 ddy = dFdy(vWorld);

  float uid0;
  vec4 c0 = rockSample(vWorld, uid0);
  vec3 col = c0.rgb;
  float edge = 0.0;

  if (uSamples > 1.5) {
    vec3 acc = c0.rgb;
    for (int s = 0; s < 3; s++) {
      vec2 o = s == 0 ? vec2(0.32, 0.11) : (s == 1 ? vec2(-0.11, 0.32) : vec2(-0.29, -0.27));
      float uidS;
      vec4 cs = rockSample(vWorld + ddx * o.x + ddy * o.y, uidS);
      acc += cs.rgb;
      edge += step(0.5, abs(uidS - uid0));
    }
    col = acc * 0.25;
    edge /= 3.0;
  }

  // Lithology ornament, in a face-attached frame so patterns stand upright on
  // the cut faces and lie flat on the map surface.
  if (uPatternStrength > 0.0) {
    vec3 an = abs(n);
    vec2 q;
    if (an.z > an.x && an.z > an.y) q = vWorld.xy;
    else if (an.x > an.y)           q = vec2(vWorld.y, vWorld.z);
    else                            q = vec2(vWorld.x, vWorld.z);
    q /= max(1.0, uPatternScale);

    float dens = length(fwidth(q));
    float fade = 1.0 - smoothstep(0.22, 0.62, dens);
    if (fade > 0.001) {
      float ink = patternInk(c0.a, q) * fade * uPatternStrength;
      col = mix(col, col * 0.42, ink);
    }
  }

  // Contacts fall out of the supersampling for free: where the samples
  // disagree, we are straddling a boundary.
  col = mix(col, col * 0.25, edge * uContactStrength);

  // Lighting: a warm key, a cool sky fill, and a touch of ground bounce.
  vec3 L = normalize(uLightDir);
  float key = max(0.0, dot(n, L));
  float sky = 0.5 + 0.5 * n.z;
  vec3 lit = col * (0.34 + 0.62 * key) + col * sky * 0.22;
  lit += vec3(0.05, 0.045, 0.04) * pow(max(0.0, 1.0 - abs(dot(n, normalize(vec3(0.0, 0.0, 1.0))))), 3.0);

  // Contours, on the land surface only. Spacing is measured in screen space
  // via fwidth, so the lines keep a constant on-screen weight at any zoom and
  // fade out before they can alias into a solid wash.
  if (vTop > 0.5 && uContourInterval > 0.0) {
    float f = vWorld.z / uContourInterval;
    float w = fwidth(f);
    if (w > 1e-6) {
      float fade = 1.0 - smoothstep(0.30, 0.75, w);
      if (fade > 0.001) {
        float d = abs(fract(f + 0.5) - 0.5) / w;
        float idx = floor(f + 0.5);
        float major = abs(mod(idx, uContourIndexEvery)) < 0.5 ? 1.0 : 0.0;
        float halfW = mix(0.55, 1.05, major);
        float ink = (1.0 - smoothstep(halfW - 0.5, halfW + 0.5, d)) * fade;
        ink *= mix(0.5, 0.85, major);

        // Break the line where an elevation label sits, the way a map does.
        // Only worth testing on fragments that actually carry ink.
        if (ink > 0.002 && major > 0.5) {
          for (int i = 0; i < 24; i++) {
            if (i >= uLabelCount) break;
            vec4 sp = uLabelSpots[i];
            float r = length(vWorld.xy - sp.xy) / max(sp.z, 1e-4);
            ink *= smoothstep(0.82, 1.06, r);
          }
        }
        // Dark rock needs a light line and light rock a dark one, or the
        // contour disappears on coal and basement. Judge that on the rock's
        // own colour, not the shaded result: hillshading varies across a
        // single unit and would flip the line's polarity mid-slope.
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 lineCol = lum > 0.34 ? lit * 0.45 : lit + vec3(0.22);
        lit = mix(lit, lineCol, clamp(ink, 0.0, 1.0));
      }
    }
  }

  gl_FragColor = vec4(lit, 1.0);
}
`;
}
