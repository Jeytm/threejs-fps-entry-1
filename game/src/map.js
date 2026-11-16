// The Foundry — the game's original map. A dusk-lit steel foundry yard: three
// east-west routes (a north lane, a central yard crossed by a raised spine
// walkway, a south lane) feeding two bomb sites on the east side. This module
// builds every mesh, collider and light once, and publishes the static data the
// rest of the game reads: spawn points, plant zones, the waypoint graph, attack
// routes and defensive holds.
import * as THREE from 'three';
import { PALETTE, FINISH } from './palette.js';
import { addCollider, clearColliders } from './geometry.js';

export const MAP = {
  bounds: { minX: -20, maxX: 20, minZ: -17, maxZ: 17 },
  plantSites: {
    A: { x: 12.5, z: -5, r: 2.7 },
    B: { x: 12.5, z: 5, r: 2.7 },
  },
  // Spawn points: position plus a point to face at round start.
  copperSpawns: [
    { x: -17.5, z: -9, fx: 0, fz: -4 },
    { x: -17.5, z: 0, fx: 0, fz: 0 },
    { x: -17.5, z: 9, fx: 0, fz: 4 },
    { x: -18.5, z: -4, fx: 0, fz: 0 },
    { x: -18.5, z: 4, fx: 0, fz: 0 },
  ],
  cobaltSpawns: [
    { x: 17.5, z: -9, fx: 12.5, fz: -5 },
    { x: 17.5, z: 0, fx: 12.5, fz: 0 },
    { x: 17.5, z: 9, fx: 12.5, fz: 5 },
    { x: 18.5, z: -4, fx: 12.5, fz: -5 },
    { x: 18.5, z: 4, fx: 12.5, fz: 5 },
  ],
  // Waypoint graph. Deck nodes sit on the ramp centerline (z = 0.85) so ramp
  // edges climb the steps cleanly; everything else is ground level.
  nodes: {
    c0: [-18, 0, 0], c1: [-18, 0, -11], c2: [-18, 0, 11],
    w1: [-13, 0, -13.5], w2: [-13, 0, 13.5],
    wdN: [-7.5, 0, -9], wdS: [-7.5, 0, 9],
    w3: [-8, 0, -5], w4: [-8, 0, 5],
    r0: [-13.2, 0, 0.85], up1: [-6, 0, -0.7], up2: [6, 0, -0.7],
    d1: [-9, 2.5, 0.85], d2: [0, 2.5, 0.85], d3: [9, 2.5, 0.85],
    r1: [13.2, 0, 0.85],
    doorN: [0, 0, -9], doorS: [0, 0, 9],
    edN: [7.5, 0, -9], edS: [7.5, 0, 9],
    n1: [0, 0, -13.5], s1: [0, 0, 13.5],
    n2: [13, 0, -13.5], s2: [13, 0, 13.5],
    a0: [7, 0, -5], b0: [7, 0, 5],
    a1: [12.5, 0, -5], b1: [12.5, 0, 5],
    e0: [18, 0, 0], e1: [18, 0, -11], e2: [18, 0, 11],
  },
  edges: [
    ['c0', 'c1'], ['c0', 'c2'], ['c0', 'w3'], ['c0', 'w4'], ['c0', 'r0'], ['c0', 'up1'],
    ['c1', 'w1'], ['c1', 'r0'],
    ['c2', 'w2'], ['c2', 'r0'],
    ['w1', 'wdN'], ['w1', 'n1'],
    ['w2', 'wdS'], ['w2', 's1'],
    ['wdN', 'w3'], ['wdN', 'n1'],
    ['wdS', 'w4'], ['wdS', 's1'],
    ['w3', 'w4'], ['w3', 'doorN'], ['w3', 'up1'],
    ['w4', 'doorS'], ['w4', 'up1'],
    ['r0', 'd1'],
    ['up1', 'up2'],
    ['up2', 'a0'], ['up2', 'b0'], ['up2', 'e0'],
    ['d1', 'd2'], ['d2', 'd3'], ['d3', 'r1'],
    ['r1', 'a1'], ['r1', 'b1'], ['r1', 'e0'],
    ['doorN', 'a0'], ['doorN', 'n1'],
    ['doorS', 'b0'], ['doorS', 's1'],
    ['edN', 'a0'], ['edN', 'a1'], ['edN', 'n2'],
    ['edS', 'b0'], ['edS', 'b1'], ['edS', 's2'],
    ['a0', 'a1'], ['a0', 'e0'],
    ['b0', 'b1'], ['b0', 'e0'],
    ['a1', 'e0'], ['b1', 'e0'],
    ['n1', 'n2'], ['s1', 's2'],
    ['n2', 'e1'], ['s2', 'e2'],
    ['e0', 'e1'], ['e0', 'e2'],
  ],
  // Named attack routes for the Copper bots, grouped by target site.
  routes: {
    A: [
      ['c0', 'r0', 'd1', 'd2', 'd3', 'r1', 'a1'],
      ['c0', 'c1', 'w1', 'n1', 'n2', 'edN', 'a1'],
      ['c0', 'w3', 'doorN', 'a0', 'a1'],
      ['c0', 'up1', 'up2', 'a0', 'a1'],
    ],
    B: [
      ['c0', 'r0', 'd1', 'd2', 'd3', 'r1', 'b1'],
      ['c0', 'c2', 'w2', 's1', 's2', 'edS', 'b1'],
      ['c0', 'w4', 'doorS', 'b0', 'b1'],
      ['c0', 'up1', 'up2', 'b0', 'b1'],
    ],
  },
  // Where Cobalt defenders set up, and which waypoint they watch.
  holds: [
    { node: 'a1', look: 'a0' },
    { node: 'b1', look: 'b0' },
    { node: 'edN', look: 'doorN' },
    { node: 'edS', look: 'doorS' },
    { node: 'd3', look: 'd1' },
    { node: 'n2', look: 'n1' },
    { node: 's2', look: 's1' },
    { node: 'r1', look: 'd3' },
    { node: 'a0', look: 'doorN' },
    { node: 'b0', look: 'doorS' },
  ],
};

// Adjacency, filled once at import: name -> [neighbour names].
const adjacency = {};
for (const name of Object.keys(MAP.nodes)) adjacency[name] = [];
for (const [a, b] of MAP.edges) {
  adjacency[a].push(b);
  adjacency[b].push(a);
}
MAP.adjacency = adjacency;

// The mesh/collider builders. Materials are built once and shared.
const materials = {};
for (const name of Object.keys(PALETTE)) {
  materials[name] = new THREE.MeshStandardMaterial({ color: PALETTE[name], ...FINISH[name] });
}
function glow(name, intensity) {
  const m = materials[name].clone();
  m.emissive = new THREE.Color(PALETTE[name]);
  m.emissiveIntensity = intensity;
  return m;
}

export function buildMap(scene) {
  clearColliders();
  const group = new THREE.Group();
  scene.add(group);

  // block(w, h, d, x, yBottom, z, material, solid) — y is the bottom face.
  function block(w, h, d, x, y, z, mat, isSolid) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (isSolid) addCollider(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2);
    return mesh;
  }

  // Floor slab (top face at y=0) and outer walls.
  block(44, 1, 38, 0, -1, 0, materials.ground, true);
  block(1.2, 6, 36, -20.6, 0, 0, materials.wall, true);
  block(1.2, 6, 36, 20.6, 0, 0, materials.wall, true);
  block(42, 6, 1.2, 0, 0, -17.6, materials.wall, true);
  block(42, 6, 1.2, 0, 0, 17.6, materials.wall, true);
  // Plinth strip along the walls, purely visual.
  for (const [w, h, d, x, z] of [
    [42, 0.5, 0.3, 0, -16.85], [42, 0.5, 0.3, 0, 16.85],
    [0.3, 0.5, 36, -19.85, 0], [0.3, 0.5, 36, 19.85, 0],
  ]) block(w, h, d, x, 0, z, materials.metal, false);

  // Spine walkway: deck slab, railings, support columns, stepped ramps.
  block(20, 0.25, 3, 0, 2.25, 0, materials.metal, true);
  block(19.4, 0.9, 0.12, 0, 2.5, 1.5, materials.rust, true);
  block(19.4, 0.9, 0.12, 0, 2.5, -1.5, materials.rust, true);
  for (const x of [-9.5, 9.5]) for (const z of [-1.3, 1.3]) {
    block(0.35, 2.25, 0.35, x, 0, z, materials.metal, true);
  }
  // Ramps: five 0.5 m steps at each end, rising toward the deck (top = 2.5).
  // East stairs occupy x 10.0..12.6, west stairs x -12.6..-10.0; the shortest
  // step is outermost so movers climb from the yard floor.
  for (let i = 0; i < 5; i += 1) {
    const h = 0.5 * (i + 1);
    block(0.52, h, 1.3, 12.6 - 0.52 * i - 0.26, 0, 0.85, materials.rust, true);
    block(0.52, h, 1.3, -12.6 + 0.52 * i + 0.26, 0, 0.85, materials.rust, true);
  }

  // Lane dividers with three doorways each (west, centre, east gaps).
  for (const z of [-9, 9]) {
    block(6, 4, 1, -12, 0, z, materials.wall, true);
    block(3.5, 4, 1, -4.25, 0, z, materials.wall, true);
    block(3.5, 4, 1, 4.25, 0, z, materials.wall, true);
    block(6, 4, 1, 12, 0, z, materials.wall, true);
  }

  // Corner vent housings near the spawns.
  for (const x of [-18, 18]) for (const z of [-14, 14]) {
    block(2.6, 5, 2.6, x, 0, z, materials.metal, true);
    block(1.2, 0.6, 1.2, x, 5, z, materials.rust, false);
  }

  // Crates: singles are jump-cover, stacks block sightlines.
  const crate = (x, z) => block(1.15, 0.95, 1.15, x, 0, z, materials.rust, true);
  const stack = (x, z) => {
    block(1.3, 1.9, 1.3, x, 0, z, materials.rust, true);
    block(0.9, 0.9, 0.9, x + 0.1, 1.9, z - 0.08, materials.metal, false);
  };
  crate(2.5, -2.6); crate(-2.5, 2.6);
  stack(2.5, 3.4); stack(-2.5, -3.4);
  crate(-6.5, -15.7); crate(4.5, -11.6); stack(11, -15.4);
  crate(-6.5, 15.7); crate(4.5, 11.6); stack(11, 15.4);
  crate(9.6, -2.2); crate(15, -7.2); stack(11.6, -7.4);
  crate(9.6, 2.2); crate(15, 7.2); stack(11.6, 7.4);

  // Plant sites: glowing floor panel, corner posts, hanging sign.
  const siteMat = glow('amber', 0.55);
  const postMat = glow('amber', 0.9);
  for (const key of ['A', 'B']) {
    const s = MAP.plantSites[key];
    const panel = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.06, 5.4), siteMat);
    panel.position.set(s.x, 0.03, s.z);
    panel.receiveShadow = true;
    group.add(panel);
    for (const [dx, dz] of [[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.16), postMat);
      post.position.set(s.x + dx, 0.55, s.z + dz);
      group.add(post);
    }
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.18), siteMat);
    sign.position.set(s.x, 3.4, s.z + (s.z > 0 ? -2.9 : 2.9));
    group.add(sign);
  }

  // Accent light strips: amber on the Copper (west) side, cobalt on Cobalt's.
  const amberStrip = glow('amber', 1.4);
  const cobaltStrip = glow('cobalt', 1.4);
  for (const z of [-13.5, 0, 13.5]) {
    const west = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 3), amberStrip);
    west.position.set(-19.9, 3.2, z);
    group.add(west);
    const east = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 3), cobaltStrip);
    east.position.set(19.9, 3.2, z);
    group.add(east);
  }
  // Flood panels above the spine walkway.
  const flood = glow('ink', 1.1);
  for (const x of [-6, 0, 6]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 1.1), flood);
    panel.position.set(x, 4.6, 0);
    group.add(panel);
  }

  // Skyline silhouettes beyond the walls (visual only).
  const skyMat = materials.wall;
  const silhouette = (w, h, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), skyMat);
    m.position.set(x, h / 2, z);
    group.add(m);
  };
  silhouette(5, 17, 5, 0, -26);
  silhouette(4, 13, 4, -30, -8);
  silhouette(6, 10, 6, 30, 10);
  silhouette(14, 8, 3, -4, 26);
  silhouette(3, 12, 3, 24, -20);

  // Lighting rig: cool hemisphere dusk, one warm shadow-casting key from the
  // west, a cobalt fill from the east, amber points over each plant site.
  const hemi = new THREE.HemisphereLight('#46505c', '#2e2620', 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(PALETTE.ink, 1.5);
  key.position.set(-30, 26, -14);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 90;
  key.shadow.bias = -0.0004;
  scene.add(key);
  scene.add(key.target);
  const fill = new THREE.DirectionalLight(PALETTE.cobalt, 0.45);
  fill.position.set(26, 18, 16);
  scene.add(fill);
  for (const key2 of ['A', 'B']) {
    const s = MAP.plantSites[key2];
    const point = new THREE.PointLight(PALETTE.amber, 36, 15, 2);
    point.position.set(s.x, 3.6, s.z);
    scene.add(point);
  }
  const spineLight = new THREE.PointLight(PALETTE.ink, 26, 16, 2);
  spineLight.position.set(0, 4.4, 0);
  scene.add(spineLight);
}

// Waypoint helpers -----------------------------------------------------------

export function nearestNode(x, z, y = 0) {
  // Prefer nodes on the mover's own level, so a yard-level mover never latches
  // onto deck nodes 2.5 m overhead (and vice versa). Falls back to plain 2D
  // nearest when no node sits within 1.5 m of the mover's height.
  let best = null;
  let bestD = Infinity;
  let fallback = null;
  let fallbackD = Infinity;
  for (const name of Object.keys(MAP.nodes)) {
    const n = MAP.nodes[name];
    const dx = n[0] - x;
    const dz = n[2] - z;
    const d = dx * dx + dz * dz;
    if (d < fallbackD) { fallbackD = d; fallback = name; }
    if (Math.abs(n[1] - y) > 1.5) continue;
    if (d < bestD) { bestD = d; best = name; }
  }
  return best ?? fallback;
}

// Breadth-first path (fewest waypoints) between two nodes. Returns a fresh
// array of names — pathfinding is rare (route changes), so allocating here is
// fine. Empty array when unreachable.
export function findPath(from, to) {
  if (from === to) return [to];
  const prev = { [from]: null };
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head];
    const nexts = MAP.adjacency[cur];
    for (let i = 0; i < nexts.length; i += 1) {
      const nxt = nexts[i];
      if (nxt in prev) continue;
      prev[nxt] = cur;
      if (nxt === to) {
        const path = [to];
        let step = to;
        while (prev[step] !== null) { step = prev[step]; path.push(step); }
        path.reverse();
        return path;
      }
      queue.push(nxt);
    }
  }
  return [];
}
