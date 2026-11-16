// Combat resolution: hitscan shots (ray vs world, then ray vs character
// head/torso/legs zones), the tracer/impact effect pools, and grenade physics.
// All pools are preallocated — a firefight allocates nothing.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { colliders, rayBox } from './geometry.js';
import { applyZoneDamage } from './weapons.js';
import { sounds } from './audio.js';
import { scratch, release } from './scratch.js';

export const ZONES = { HEAD_Y: 1.52, HEAD_R: 0.18, LEGS_Y: 0.72 };

// One character hitbox: position (feet), height, radius. Parts:
//   head: eye+ above feet, torso: between legsY and headY, legs: below legsY.
// Ray/zone test in 2D cylinders approximated by an AABB footprint.
function rayCharacter(origin, dir, maxT, ch) {
  const headY = ch.pos.y + ch.height;
  const legsY = ch.pos.y + ZONES.LEGS_Y;
  // Vertical slab the character occupies.
  let tEnter = 0;
  let tExit = maxT;
  const loY = ch.pos.y;
  const hiY = headY + 0.1;
  if (dir.y === 0) {
    if (origin.y < loY || origin.y > hiY) return null;
  } else {
    let t1 = (loY - origin.y) / dir.y;
    let t2 = (hiY - origin.y) / dir.y;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tEnter = Math.max(tEnter, t1);
    tExit = Math.min(tExit, t2);
  }
  // Horizontal slab (square footprint of side 2r).
  const r = ch.radius;
  for (let a = 0; a < 2; a += 1) {
    const o = a === 0 ? origin.x : origin.z;
    const d = a === 0 ? dir.x : dir.z;
    const c = a === 0 ? ch.pos.x : ch.pos.z;
    if (d === 0) {
      if (o < c - r || o > c + r) return null;
      continue;
    }
    let t1 = (c - r - o) / d;
    let t2 = (c + r - o) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tEnter = Math.max(tEnter, t1);
    tExit = Math.min(tExit, t2);
  }
  if (tEnter > tExit || tExit < 0) return null;
  const t = Math.max(tEnter, 0);
  if (t > maxT) return null;
  // Which zone did we pierce at height t along the ray?
  const hitY = origin.y + dir.y * t;
  let part = 'torso';
  if (hitY > headY - 0.26) part = 'head';
  else if (hitY < legsY) part = 'legs';
  return { t, part };
}

// Fire a hitscan shot. Returns the hit description (also used for hit markers),
// or null when nothing was hit. Damages characters via combat.damage callback.
export function fireHitscan(world, shooter, origin, dir, weapon, combat) {
  // World geometry first: bullets stop at walls.
  const normal = scratch(0, 0, 0);
  const wallT = rayBox(origin, dir, weapon.range, normal);
  release(1);
  let bestT = wallT >= 0 ? wallT : weapon.range;
  let target = null;
  let part = null;
  const list = world.characters;
  for (let i = 0; i < list.length; i += 1) {
    const ch = list[i];
    if (ch === shooter || !ch.alive) continue;
    const hit = rayCharacter(origin, dir, bestT, ch);
    if (hit) { bestT = hit.t; target = ch; part = hit.part; }
  }
  // Tracer to the impact point (or full range into the sky).
  const endX = origin.x + dir.x * bestT;
  const endY = origin.y + dir.y * bestT;
  const endZ = origin.z + dir.z * bestT;
  spawnTracer(origin.x, origin.y, origin.z, endX, endY, endZ, weapon.tracer, shooter.isPlayer ? 0 : 1);
  if (target) {
    const dist = bestT;
    const { amount, killed } = applyZoneDamage(weapon, part, target.health, dist);
    combat.applyDamage(target, amount, part, killed, shooter);
    spawnImpact(endX, endY, endZ, part === 'head' ? 0xff5040 : 0xd9c090);
    return { target, part, killed, amount };
  }
  if (wallT >= 0) {
    // Spark off the wall, offset slightly along the normal.
    spawnImpact(
      endX + normal.x * 0.03,
      endY + normal.y * 0.03,
      endZ + normal.z * 0.03,
      0xffd9a0,
    );
  }
  return null;
}

// Visual pools ----------------------------------------------------------------

const TRACER_LIFE = 0.07;
const IMPACT_LIFE = 0.3;
const TRACER_MAX = 40;
const IMPACT_MAX = 60;

const tracerPool = [];
const impactPool = [];
const activeTracers = [];
const activeImpacts = [];

export function buildEffects(scene) {
  const tracerGeo = new THREE.BoxGeometry(0.022, 0.022, 1);
  for (let i = 0; i < TRACER_MAX; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(tracerGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    tracerPool.push(mesh);
  }
  const impactGeo = new THREE.SphereGeometry(0.05, 5, 4);
  for (let i = 0; i < IMPACT_MAX; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(impactGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    impactPool.push(mesh);
  }
}

function spawnTracer(x0, y0, z0, x1, y1, z1, color, team) {
  const mesh = tracerPool.find((m) => !m.visible);
  if (!mesh) return;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.01) return;
  mesh.position.set(x0 + dx * 0.5, y0 + dy * 0.5, z0 + dz * 0.5);
  mesh.scale.set(1, 1, len);
  mesh.lookAt(x1, y1, z1);
  mesh.material.color.setHex(color);
  mesh.material.opacity = 0.85;
  mesh.visible = true;
  activeTracers.push({ mesh, life: TRACER_LIFE, team });
}

function spawnImpact(x, y, z, color) {
  const mesh = impactPool.find((m) => !m.visible);
  if (!mesh) return;
  mesh.position.set(x, y, z);
  mesh.material.color.setHex(color);
  mesh.material.opacity = 1;
  mesh.visible = true;
  activeImpacts.push({ mesh, life: IMPACT_LIFE });
}

// Render-side tick for fading effects.
export function updateEffects(dt) {
  for (let i = activeTracers.length - 1; i >= 0; i -= 1) {
    const t = activeTracers[i];
    t.life -= dt;
    if (t.life <= 0) {
      t.mesh.visible = false;
      activeTracers.splice(i, 1);
    } else {
      t.mesh.material.opacity = (t.life / TRACER_LIFE) * 0.85;
    }
  }
  for (let i = activeImpacts.length - 1; i >= 0; i -= 1) {
    const p = activeImpacts[i];
    p.life -= dt;
    if (p.life <= 0) {
      p.mesh.visible = false;
      activeImpacts.splice(i, 1);
    } else {
      p.mesh.material.opacity = p.life / IMPACT_LIFE;
      p.mesh.scale.setScalar(1 + (1 - p.life / IMPACT_LIFE) * 1.5);
    }
  }
}

// Grenades --------------------------------------------------------------------

const GRENADE_MAX = 8;
const grenadePool = [];
const activeGrenades = [];
let explosionFx = null;

export function buildGrenades(scene) {
  const geo = new THREE.SphereGeometry(0.11, 6, 5);
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.5, metalness: 0.6, emissive: PALETTE.amber, emissiveIntensity: 0.4 });
  for (let i = 0; i < GRENADE_MAX; i += 1) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.castShadow = true;
    scene.add(mesh);
    grenadePool.push(mesh);
  }
  explosionFx = new THREE.PointLight(PALETTE.amber, 0, 30, 1.6);
  scene.add(explosionFx);
}

export function throwGrenade(owner, x, y, z, dx, dy, dz, speed, fuse) {
  const mesh = grenadePool.find((m) => !m.visible);
  if (!mesh) return;
  mesh.position.set(x, y, z);
  mesh.visible = true;
  activeGrenades.push({
    mesh,
    owner,
    vx: dx * speed,
    vy: dy * speed,
    vz: dz * speed,
    fuse,
    alive: true,
  });
}

// Grenade physics: gravity, bounce off colliders (axis-separated), detonate on
// fuse. damageCallback(target, amount) applies area damage.
export function stepGrenades(dt, characters, damageCallback) {
  for (let i = activeGrenades.length - 1; i >= 0; i -= 1) {
    const g = activeGrenades[i];
    g.fuse -= dt;
    if (g.fuse <= 0) { detonate(g, characters, damageCallback); activeGrenades.splice(i, 1); continue; }
    // Integrate with a couple of substeps against colliders.
    const steps = 2;
    const sdt = dt / steps;
    for (let s = 0; s < steps && g.alive; s += 1) {
      g.vy -= 14 * sdt;
      const p = g.mesh.position;
      const nx = p.x + g.vx * sdt;
      const ny = p.y + g.vy * sdt;
      const nz = p.z + g.vz * sdt;
      let bounced = false;
      for (let c = 0; c < colliders.length; c += 1) {
        const b = colliders[c];
        if (nx > b[0] - 0.1 && nx < b[3] + 0.1 && nz > b[2] - 0.1 && nz < b[5] + 0.1 && ny > b[1] - 0.1 && ny < b[4] + 0.1) {
          // Bounce: reflect on the shallowest axis.
          const pen = [
            { a: 'x', v: nx < (b[0] + b[3]) / 2 ? b[0] - nx : nx - b[3] },
            { a: 'y', v: ny < (b[1] + b[4]) / 2 ? b[1] - ny : ny - b[4] },
            { a: 'z', v: nz < (b[2] + b[5]) / 2 ? b[2] - nz : nz - b[5] },
          ];
          pen.sort((m, n) => m.v - n.v);
          const axis = pen[0].a;
          if (axis === 'x') { g.vx *= -0.45; }
          else if (axis === 'y') { g.vy *= -0.42; g.vx *= 0.8; g.vz *= 0.8; }
          else { g.vz *= -0.45; }
          bounced = true;
          break;
        }
      }
      if (!bounced) {
        p.x = nx; p.y = ny; p.z = nz;
      }
      if (p.y < 0.1) { p.y = 0.1; g.vy = Math.abs(g.vy) * 0.42; g.vx *= 0.8; g.vz *= 0.8; }
      if (Math.abs(g.vx) < 0.4 && Math.abs(g.vz) < 0.4 && p.y <= 0.11) { g.vx = 0; g.vz = 0; }
    }
  }
}

function detonate(g, characters, damageCallback) {
  g.mesh.visible = false;
  sounds.explosion();
  const p = g.mesh.position;
  explosionFx.position.set(p.x, p.y + 0.5, p.z);
  explosionFx.intensity = 220;
  spawnImpact(p.x, p.y, p.z, 0xffe0b0);
  for (let i = 0; i < 5; i += 1) spawnImpact(p.x + (Math.random() - 0.5) * 2, p.y + Math.random() * 1.5, p.z + (Math.random() - 0.5) * 2, 0xffb060);
  for (let i = 0; i < characters.length; i += 1) {
    const ch = characters[i];
    if (!ch.alive) continue;
    const dx = ch.pos.x - p.x;
    const dy = ch.pos.y + 0.9 - p.y;
    const dz = ch.pos.z - p.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 7.5) {
      const falloff = 1 - d / 7.5;
      const amount = Math.round(105 * falloff * falloff);
      if (amount > 0) damageCallback(ch, amount, 'torso', false, g.owner);
    }
  }
}

export function updateGrenadeFx(dt) {
  if (explosionFx.intensity > 0) {
    explosionFx.intensity = Math.max(0, explosionFx.intensity - dt * 900);
  }
}

export function clearGrenades() {
  for (let i = 0; i < activeGrenades.length; i += 1) activeGrenades[i].mesh.visible = false;
  activeGrenades.length = 0;
}

export function activeGrenadeCount() {
  return activeGrenades.length;
}

// Bots need the character ray test for their line-of-sight checks. Returns true
// when nothing blocks the segment (walls only — other characters don't block
// sight in this game).
export function segmentClear(origin, end) {
  const dx = end.x - origin.x;
  const dy = end.y - origin.y;
  const dz = end.z - origin.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.001) return true;
  const dir = scratch(dx / len, dy / len, dz / len);
  const t = rayBox(origin, dir, len, null);
  release(1);
  return t < 0;
}
