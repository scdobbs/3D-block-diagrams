// Elevation labels for the index (heavy) contours.
//
// The contour lines themselves are shaded per fragment from elevation and
// never exist as geometry — but a label has to sit at a *place*, so the index
// contours do get traced here, on the CPU, with marching squares.
//
// Cartographic convention is that the number sits in a gap in the line rather
// than on top of it. The gap is punched by the shader: every label reports its
// map position and radius, and contour ink is suppressed inside those discs.

import * as THREE from '../../vendor/three.module.js';
import { surfaceHeight, surfaceRange } from '../geo/surfaces.js';

export const MAX_LABELS = 24;

// Marching-squares segment table. Corner bits: 1 = SW, 2 = SE, 4 = NE, 8 = NW.
// Edges: 0 = south, 1 = east, 2 = north, 3 = west.
const CASES = [
  [], [[0, 3]], [[0, 1]], [[1, 3]],
  [[1, 2]], [[0, 1], [2, 3]], [[0, 2]], [[2, 3]],
  [[2, 3]], [[0, 2]], [[0, 3], [1, 2]], [[1, 2]],
  [[1, 3]], [[0, 1]], [[0, 3]], [],
];

/**
 * Sample the terrain once. Every level then marches over this grid, which is
 * the difference between one pass of trigonometry and one per contour —
 * terrain sliders rebuild labels on each drag event, so it matters.
 */
function sampleGrid(topo, box, res) {
  const g = new Float32Array((res + 1) * (res + 1));
  const dx = (box.x1 - box.x0) / res;
  const dy = (box.y1 - box.y0) / res;
  for (let j = 0; j <= res; j++) {
    const y = box.y0 + j * dy;
    for (let i = 0; i <= res; i++) {
      g[j * (res + 1) + i] = surfaceHeight(topo, box.x0 + i * dx, y);
    }
  }
  return g;
}

/**
 * Segments of one contour level across the block footprint.
 * Returns a flat list of { mid: [x, y], dir: [dx, dy] } — joined polylines
 * are not needed, because labels are placed from well-separated segments and
 * a short segment is already a good local tangent.
 */
function traceLevel(grid, box, level, res) {
  const segs = [];
  const dx = (box.x1 - box.x0) / res;
  const dy = (box.y1 - box.y0) / res;
  const W = res + 1;

  for (let j = 0; j < res; j++) {
    const y0 = box.y0 + j * dy;
    const y1 = y0 + dy;

    for (let i = 0; i < res; i++) {
      const x0 = box.x0 + i * dx;
      const x1 = x0 + dx;
      const h00 = grid[j * W + i], h10 = grid[j * W + i + 1];
      const h11 = grid[(j + 1) * W + i + 1], h01 = grid[(j + 1) * W + i];

      const code = (h00 > level ? 1 : 0) | (h10 > level ? 2 : 0)
        | (h11 > level ? 4 : 0) | (h01 > level ? 8 : 0);
      const pairs = CASES[code];
      if (!pairs.length) continue;

      const t = (a, b) => (level - a) / (b - a || 1e-6);
      const edge = (e) => {
        switch (e) {
          case 0: return [x0 + dx * t(h00, h10), y0];
          case 1: return [x1, y0 + dy * t(h10, h11)];
          case 2: return [x0 + dx * t(h01, h11), y1];
          default: return [x0, y0 + dy * t(h00, h01)];
        }
      };

      for (const [ea, eb] of pairs) {
        const a = edge(ea), b = edge(eb);
        segs.push({
          mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
          dir: [b[0] - a[0], b[1] - a[1]],
        });
      }
    }
  }
  return segs;
}

/**
 * Choose label sites for every index contour crossing the block.
 * @returns {{ labels: Array, spots: Float32Array }}
 *   labels — { x, y, z, angle, text, level }
 *   spots  — packed (x, y, radius, 0) per label, for the shader's line gap
 */
export function buildContourLabels(doc, interval, indexEvery, box) {
  const empty = { labels: [], spots: new Float32Array(MAX_LABELS * 4) };
  if (!(interval > 0)) return empty;

  const step = interval * indexEvery;
  const { lo, hi } = surfaceRange(doc.topo, doc.block.width, doc.block.depth);
  if (!(hi - lo > 1)) return empty;

  const span = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const labelW = span * 0.105;
  const minGap = span * 0.5;           // keep labels from crowding each other
  const margin = span * 0.08;          // and off the block edges, where they clip
  const perLevel = 3;                  // a level repeated six times is just noise
  const res = 96;

  const labels = [];
  const first = Math.ceil((lo + 1) / step) * step;
  const grid = sampleGrid(doc.topo, box, res);

  for (let level = first; level <= hi - 1 && labels.length < MAX_LABELS; level += step) {
    const segs = traceLevel(grid, box, level, res);
    if (segs.length < 8) continue;     // a scrap of contour is not worth naming

    // Prefer sites where the contour runs across the map rather than up it:
    // a near-vertical label is legal cartography but awkward to read.
    const cands = segs
      .map((s) => {
        const len = Math.hypot(s.dir[0], s.dir[1]) || 1;
        return { s, flat: Math.abs(s.dir[1] / len) };
      })
      .sort((a, b) => a.flat - b.flat);

    const placed = [];
    for (const { s } of cands) {
      if (placed.length >= perLevel || labels.length >= MAX_LABELS) break;
      const [x, y] = s.mid;
      if (x < box.x0 + margin || x > box.x1 - margin
        || y < box.y0 + margin || y > box.y1 - margin) continue;
      if (placed.some((p) => Math.hypot(p[0] - x, p[1] - y) < minGap)) continue;

      // Only label where the contour actually continues through the gap we
      // are about to punch, or the number ends up ringed by a stray islet.
      let near = 0;
      for (const t of segs) {
        if (Math.hypot(t.mid[0] - x, t.mid[1] - y) < labelW) { near++; if (near > 4) break; }
      }
      if (near <= 4) continue;

      const len = Math.hypot(s.dir[0], s.dir[1]) || 1;
      let dxn = s.dir[0] / len;
      let dyn = s.dir[1] / len;
      // Read left to right when the map is north-up.
      if (dxn < 0) { dxn = -dxn; dyn = -dyn; }

      placed.push([x, y]);
      labels.push({
        x, y, level,
        angle: Math.atan2(dyn, dxn),
        text: formatLevel(level),
      });
    }
  }

  // Sit the label above the highest ground it covers, so a plate lying flat
  // on a slope does not sink into the hillside at its uphill edge.
  const half = labelW / 2;
  for (const L of labels) {
    let top = -Infinity;
    for (const ox of [-half, 0, half]) {
      for (const oy of [-half * 0.5, 0, half * 0.5]) {
        top = Math.max(top, surfaceHeight(doc.topo, L.x + ox, L.y + oy));
      }
    }
    L.z = top + Math.max(2, span * 0.004);
  }

  const spots = new Float32Array(MAX_LABELS * 4);
  labels.forEach((L, i) => {
    spots[i * 4] = L.x;
    spots[i * 4 + 1] = L.y;
    spots[i * 4 + 2] = labelW * 0.62;   // gap radius, a little wider than the text
  });

  return { labels, spots, labelW };
}

function formatLevel(v) {
  const r = Math.round(v);
  return Math.abs(r) < 0.5 ? '0' : String(r);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const textureCache = new Map();

/** A canvas texture of one elevation number, cached per string. */
function labelTexture(text) {
  if (textureCache.has(text)) return textureCache.get(text);

  const W = 256, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');

  g.font = 'bold 78px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Light halo under dark text: legible over pale sandstone and over coal
  // alike, without having to know which unit the label happens to land on.
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(245, 245, 240, 0.92)';
  g.lineWidth = 14;
  g.strokeText(text, W / 2, H / 2 + 4);
  g.fillStyle = '#15191c';
  g.fillText(text, W / 2, H / 2 + 4);

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  textureCache.set(text, tex);
  return tex;
}

/** Build the flat label plates that lie on the map face. */
export function buildLabelMeshes(labels, labelW) {
  const group = new THREE.Group();
  const h = labelW * 0.5;
  for (const L of labels) {
    const mat = new THREE.MeshBasicMaterial({
      map: labelTexture(L.text),
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(labelW, h), mat);
    mesh.position.set(L.x, L.y, L.z);
    mesh.rotation.z = L.angle;          // lying flat, turned along the contour
    group.add(mesh);
  }
  return group;
}
