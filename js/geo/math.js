// Orientation math for structural geology.
//
// Coordinate frame: X = East, Y = North, Z = Up. Distances are in metres.
// Azimuths (strike, trend, dip direction) are degrees clockwise from North.
// Dip and plunge are degrees below horizontal.
//
// Strike follows the right-hand rule: with the strike direction ahead of you,
// the bed dips down to your right.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Unit vector pointing along an azimuth, horizontal. */
export function azimuthVec(azDeg) {
  const a = azDeg * DEG;
  return [Math.sin(a), Math.cos(a), 0];
}

/**
 * Orthonormal frame for a plane given strike/dip.
 *   strikeVec  horizontal, along strike (right-hand rule)
 *   dipVec     down-dip, in the plane
 *   normal     unit normal with a positive Z component (i.e. points to the
 *              hanging wall for any dip < 90 degrees)
 */
export function planeFrame(strikeDeg, dipDeg) {
  const s = strikeDeg * DEG;
  const d = dipDeg * DEG;
  const sinS = Math.sin(s), cosS = Math.cos(s);
  const cosD = Math.cos(d), sinD = Math.sin(d);

  // Strike direction.
  const strikeVec = [sinS, cosS, 0];
  // Dip azimuth sits 90 degrees clockwise from strike.
  const dipAz = [cosS, -sinS, 0];
  // Down-dip vector in the plane.
  const dipVec = [cosD * dipAz[0], cosD * dipAz[1], -sinD];
  // normal = dipVec x strikeVec  ->  tilts toward the dip azimuth, Z >= 0.
  const normal = cross(dipVec, strikeVec);

  return { strikeVec, dipAz, dipVec, normal };
}

/**
 * Orthonormal frame for a linear structure (a fold axis) given trend/plunge.
 *   axis   the plunging line itself
 *   perp   horizontal, 90 degrees clockwise from the trend. Fold waveform is
 *          a function of position along this direction only.
 *   up     perp x axis. Displacement direction; lies in the axial surface.
 *
 * Because `perp` is horizontal and orthogonal to `up`, displacing a point
 * along `up` never changes its `perp` coordinate -- which is what makes the
 * fold transform exactly invertible.
 */
export function axisFrame(trendDeg, plungeDeg) {
  const t = trendDeg * DEG;
  const p = plungeDeg * DEG;
  const cosP = Math.cos(p), sinP = Math.sin(p);

  const axis = [Math.sin(t) * cosP, Math.cos(t) * cosP, -sinP];
  const perp = [Math.cos(t), -Math.sin(t), 0];
  const up = cross(perp, axis);
  return { axis, perp, up };
}

/**
 * Slip direction in a fault plane, from rake (pitch) measured in the plane
 * from the strike direction, rotating toward down-dip.
 *   rake 0    = slip along the strike azimuth (sinistral for a vertical fault)
 *   rake 90   = pure down-dip slip  (hanging wall drops -> normal fault)
 *   rake 180  = slip against the strike azimuth (dextral)
 *   rake 270  = pure up-dip slip    (hanging wall rises -> reverse fault)
 */
export function slipVec(strikeDeg, dipDeg, rakeDeg) {
  const { strikeVec, dipVec } = planeFrame(strikeDeg, dipDeg);
  const r = rakeDeg * DEG;
  const c = Math.cos(r), s = Math.sin(r);
  return [
    c * strikeVec[0] + s * dipVec[0],
    c * strikeVec[1] + s * dipVec[1],
    c * strikeVec[2] + s * dipVec[2],
  ];
}

/** Rodrigues rotation of `v` about unit axis `k` by `angleDeg`. */
export function rotateAbout(v, k, angleDeg) {
  const a = angleDeg * DEG;
  const c = Math.cos(a), s = Math.sin(a);
  const kv = dot(k, v);
  const kxv = cross(k, v);
  return [
    v[0] * c + kxv[0] * s + k[0] * kv * (1 - c),
    v[1] * c + kxv[1] * s + k[1] * kv * (1 - c),
    v[2] * c + kxv[2] * s + k[2] * kv * (1 - c),
  ];
}

/** Convert a plane normal back to strike/dip degrees. */
export function normalToStrikeDip(n) {
  let [x, y, z] = normalize(n);
  if (z < 0) { x = -x; y = -y; z = -z; }
  const dip = Math.acos(Math.min(1, Math.max(-1, z))) * RAD;
  // Dip azimuth is the horizontal projection of the normal.
  let dipAz = Math.atan2(x, y) * RAD;
  const strike = wrap360(dipAz - 90);
  return { strike, dip };
}

export function wrap360(a) { return ((a % 360) + 360) % 360; }

export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function normalize(a) {
  const L = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / L, a[1] / L, a[2] / L];
}

export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Format an azimuth as a quadrant bearing, e.g. 135 -> "S45E". */
export function quadrantBearing(azDeg) {
  const a = wrap360(azDeg);
  if (a === 0 || a === 360) return 'N';
  if (a === 90) return 'E';
  if (a === 180) return 'S';
  if (a === 270) return 'W';
  if (a < 90) return `N${round1(a)}E`;
  if (a < 180) return `S${round1(180 - a)}E`;
  if (a < 270) return `S${round1(a - 180)}W`;
  return `N${round1(360 - a)}W`;
}

function round1(v) { return Math.round(v * 10) / 10; }
