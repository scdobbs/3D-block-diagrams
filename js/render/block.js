// Block geometry: a rectangular prism whose lid follows the topographic
// surface. Color comes entirely from the fragment shader, so this mesh
// carries no attributes beyond position and normal — its only job is to be
// the right shape and give every fragment an honest world position.

import * as THREE from '../../vendor/three.module.js';
import { surfaceHeight, surfaceNormal, surfaceRange } from '../geo/surfaces.js';

/**
 * @param {object} block  { width, depth, height } in metres
 * @param {object} topo   surface parameters
 * @param {number} res    grid divisions along each map axis
 */
/**
 * Map footprint of the block. The cutaway trims the east and north sides
 * inward, which slides those walls through the model and exposes fresh
 * cross-sections — serial sectioning, and the only way to see an intrusion
 * that sits entirely inside the block.
 */
export function footprint(block) {
  const { width: W, depth: D } = block;
  const cutE = Math.min(Math.max(0, block.cutE || 0), W * 0.85);
  const cutN = Math.min(Math.max(0, block.cutN || 0), D * 0.85);
  return { x0: -W / 2, x1: W / 2 - cutE, y0: -D / 2, y1: D / 2 - cutN };
}

export function buildBlockGeometry(block, topo, res = 96) {
  const { width: W, depth: D, height: H } = block;
  const { x0, x1, y0, y1 } = footprint(block);
  const { lo } = surfaceRange(topo, W, D);
  // The base sits a full block-height below the lowest point of the terrain,
  // so a deep valley never punches through the bottom of the model.
  const zBase = lo - H;

  const pos = [];
  const nrm = [];
  const idx = [];

  const xAt = (i) => x0 + (i / res) * (x1 - x0);
  const yAt = (j) => y0 + (j / res) * (y1 - y0);

  // --- top surface -------------------------------------------------------
  const topStart = 0;
  for (let j = 0; j <= res; j++) {
    for (let i = 0; i <= res; i++) {
      const x = xAt(i), y = yAt(j);
      const z = surfaceHeight(topo, x, y);
      const n = surfaceNormal(topo, x, y, Math.max(1, W / res));
      pos.push(x, y, z);
      nrm.push(n[0], n[1], n[2]);
    }
  }
  const rowW = res + 1;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = topStart + j * rowW + i;
      const b = a + 1;
      const c = a + rowW;
      const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }

  // --- four walls --------------------------------------------------------
  // Each wall is a strip: the upper edge follows the terrain, the lower edge
  // is flat. Wound so the outward face is front-facing.
  const wall = (edgeFn, normal, flip) => {
    const start = pos.length / 3;
    for (let i = 0; i <= res; i++) {
      const [x, y] = edgeFn(i);
      const z = surfaceHeight(topo, x, y);
      pos.push(x, y, z);
      nrm.push(normal[0], normal[1], normal[2]);
      pos.push(x, y, zBase);
      nrm.push(normal[0], normal[1], normal[2]);
    }
    for (let i = 0; i < res; i++) {
      const a = start + i * 2;      // upper
      const b = a + 1;              // lower
      const c = a + 2;              // next upper
      const d = a + 3;              // next lower
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  };

  wall((i) => [xAt(i), y0], [0, -1, 0], false);  // south
  wall((i) => [xAt(i), y1], [0, 1, 0], true);    // north
  wall((i) => [x0, yAt(i)], [-1, 0, 0], true);   // west
  wall((i) => [x1, yAt(i)], [1, 0, 0], false);   // east

  // --- base --------------------------------------------------------------
  const bs = pos.length / 3;
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (const [x, y] of corners) { pos.push(x, y, zBase); nrm.push(0, 0, -1); }
  idx.push(bs, bs + 2, bs + 1, bs, bs + 3, bs + 2);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.userData.zBase = zBase;
  return g;
}

/** Wireframe outline of the block silhouette, drawn over the shaded solid. */
export function buildEdgeLines(block, topo, res = 96) {
  const { x0, x1, y0, y1 } = footprint(block);
  const zBase = buildBlockGeometryZBase(block, topo);
  const pts = [];

  const push = (a, b) => pts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  const top = (x, y) => [x, y, surfaceHeight(topo, x, y)];
  const lerp = (a, b, t) => a + (b - a) * t;

  // Skyline: the four terrain-following top edges.
  const edges = [
    (i) => [lerp(x0, x1, i / res), y0],
    (i) => [lerp(x0, x1, i / res), y1],
    (i) => [x0, lerp(y0, y1, i / res)],
    (i) => [x1, lerp(y0, y1, i / res)],
  ];
  for (const f of edges) {
    for (let i = 0; i < res; i++) {
      const [ax, ay] = f(i), [bx, by] = f(i + 1);
      push(top(ax, ay), top(bx, by));
    }
  }

  // Verticals at the corners, and the base rectangle.
  const cs = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (const [x, y] of cs) push(top(x, y), [x, y, zBase]);
  for (let i = 0; i < 4; i++) {
    const a = cs[i], b = cs[(i + 1) % 4];
    push([a[0], a[1], zBase], [b[0], b[1], zBase]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

export function buildBlockGeometryZBase(block, topo) {
  return surfaceRange(topo, block.width, block.depth).lo - block.height;
}
