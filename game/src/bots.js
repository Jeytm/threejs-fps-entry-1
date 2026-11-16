// Bots: the Cobalt defenders (and they plant/defuse too — the objective runs on
// both sides). Each bot walks the waypoint graph, holds a defensive position
// watching a lane, engages on sight, reacts to being shot, and plays the bomb:
// defenders defuse a planted bomb; the attacking bot escorts and plants when the
// site is clear. Bots share the player's movement feel (accelerate, crouch on
// hold) so their fire and motion read as human.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { MAP, nearestNode, findPath } from './map.js';
import { moveAABB } from './geometry.js';
import { WEAPONS } from './weapons.js';
import { segmentClear } from './combat.js';
import { scratch, release } from './scratch.js';

const GRAVITY = 20;
const RADIUS = 0.34;
const HEIGHT = 1.72;

// Skill knobs, per-bot variation applied at spawn.
const BASE = {
  reaction: 0.32, // seconds from seeing to firing
  aimError: 0.055, // radians of initial aim error
  burstMin: 2,
  burstMax: 5,
  fov: 1.25, // half-angle of vision cone
  viewDist: 46,
};

export function createBot(name, weaponKey, skill) {
  const weapon = WEAPONS[weaponKey];
  return {
    name,
    isPlayer: false,
    isBot: true,
    team: 'cobalt',
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    height: HEIGHT,
    radius: RADIUS,
    alive: true,
    health: 100,
    weapon,
    weaponKey,
    mag: weapon.magSize,
    reserve: weapon.reserve,
    reloading: 0,
    fireCd: 0,
    burstLeft: 0,
    burstPause: 0,
    // Perception state.
    target: null,
    seeTimer: 0,
    loseTimer: 0,
    lastSeen: { x: 0, y: 0, z: 0 },
    // Plan state: 'route' | 'hold' | 'plant' | 'defuse' | 'hunt'
    mode: 'hold',
    path: [],
    pathIdx: 0,
    goal: null,
    holdPoint: null,
    holdLook: null,
    holdDwell: 0,
    repathTimer: 0,
    strafe: 0,
    strafeTimer: 0,
    aimYaw: 0,
    aimPitch: 0,
    // Skill roll, 0..1, set at spawn.
    skill,
    reaction: BASE.reaction + (1 - skill) * 0.25,
    aimError: BASE.aimError * (0.6 + (1 - skill) * 0.9),
    mesh: null,
    // Bomb task assigned by the round manager.
    task: null,
    plantProgress: 0,
    defuseProgress: 0,
  };
}

// Build the visible body: cobalt body box, visor stripe, head cube.
export function buildBotMesh(bot, scene) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#3d4650', roughness: 0.7, metalness: 0.3 });
  const visorMat = new THREE.MeshStandardMaterial({ color: PALETTE.cobalt, roughness: 0.3, metalness: 0.4, emissive: PALETTE.cobalt, emissiveIntensity: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.34), bodyMat);
  torso.position.y = 1.06;
  torso.castShadow = true;
  g.add(torso);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 0.3), bodyMat);
  legs.position.y = 0.36;
  legs.castShadow = true;
  g.add(legs);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.3), bodyMat);
  head.position.y = 1.58;
  head.castShadow = true;
  g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.05), visorMat);
  visor.position.set(0, 1.6, -0.16);
  g.add(visor);
  // Gun held forward.
  const gunMat = new THREE.MeshStandardMaterial({ color: '#22262b', roughness: 0.5, metalness: 0.5 });
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.55), gunMat);
  gun.position.set(0.2, 1.12, -0.3);
  g.add(gun);
  bot.mesh = g;
  scene.add(g);
  return g;
}

export function disposeBotMesh(bot, scene) {
  if (bot.mesh) {
    scene.remove(bot.mesh);
    bot.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    bot.mesh = null;
  }
}

// Round-start placement: give the bot its plan for this round.
export function assignPlan(bot, plan, bomb) {
  bot.mode = plan.mode;
  bot.path = plan.path.slice();
  bot.pathIdx = 0;
  bot.goal = plan.goal;
  bot.holdPoint = plan.holdPoint;
  bot.holdLook = plan.holdLook;
  bot.task = plan.task ?? null;
  bot.plantProgress = 0;
  bot.defuseProgress = 0;
  bot.target = null;
  bot.seeTimer = 0;
  bot.mag = bot.weapon.magSize;
  bot.reserve = bot.weapon.reserve;
  bot.reloading = 0;
  bot.alive = true;
  bot.health = 100;
  bot.bomb = bomb;
}

// Perception + combat + movement, once per fixed tick.
export function stepBot(bot, dt, world, random, events) {
  if (!bot.alive) return;

  perceive(bot, dt, world, random);
  combatTick(bot, dt, world, random, events);
  if (!bot.alive) return;

  // Objective behaviour beats combat movement: planting/defusing bots stand
  // still but keep shooting if a target shows.
  const busy = (bot.mode === 'plant' && bot.plantProgress > 0) || (bot.mode === 'defuse' && bot.defuseProgress > 0);

  if (!busy) {
    moveTick(bot, dt, world, random);
  } else {
    // Standing: heavy friction.
    bot.vel.x *= Math.max(0, 1 - 9 * dt);
    bot.vel.z *= Math.max(0, 1 - 9 * dt);
  }
  physics(bot, dt, world);
  objectiveTick(bot, dt, world, events);
}

// Can the bot see any enemy? Sets target / lastSeen / timers.
function perceive(bot, dt, world, random) {
  const eye = scratch(bot.pos.x, bot.pos.y + 1.58, bot.pos.z);
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < world.characters.length; i += 1) {
    const ch = world.characters[i];
    if (!ch.alive || ch.team === bot.team) continue;
    const ty = (ch.height ?? 1.72) * (ch.crouching ? 0.72 : 1);
    const chestY = ch.pos.y + ty * 0.75;
    const dx = ch.pos.x - bot.pos.x;
    const dz = ch.pos.z - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > BASE.viewDist) continue;
    // Field of view around the bot's facing.
    const facingX = -Math.sin(bot.aimYaw);
    const facingZ = -Math.cos(bot.aimYaw);
    const dot = (dx / (dist || 1)) * facingX + (dz / (dist || 1)) * facingZ;
    if (dot < Math.cos(BASE.fov)) continue;
    const targetEye = scratch(ch.pos.x, chestY, ch.pos.z);
    const clear = segmentClear(eye, targetEye);
    release(1);
    if (!clear) continue;
    // Prefer the closest visible enemy.
    const score = 1 / (dist + 1);
    if (score > bestScore) { bestScore = score; best = ch; }
  }
  release(1);

  if (best) {
    if (bot.target !== best) {
      bot.target = best;
      bot.seeTimer = 0;
    }
    bot.seeTimer += dt;
    bot.lastSeen.x = best.pos.x;
    bot.lastSeen.y = best.pos.y;
    bot.lastSeen.z = best.pos.z;
    bot.loseTimer = 0;
  } else if (bot.target) {
    bot.loseTimer += dt;
    if (bot.loseTimer > 1.6) {
      // Lost them: hunt last seen briefly.
      bot.target = null;
      if (random() < 0.6) {
        bot.mode = bot.mode === 'hold' ? 'hunt' : bot.mode;
        bot.goal = nearestNode(bot.lastSeen.x, bot.lastSeen.z, bot.lastSeen.y);
        bot.path = findPath(nearestNode(bot.pos.x, bot.pos.z, bot.pos.y), bot.goal);
        bot.pathIdx = 0;
        bot.holdDwell = 1.5 + random() * 2;
      }
    }
  }
}

// Aim toward target with error; fire when ready.
function combatTick(bot, dt, world, random, events) {
  if (bot.fireCd > 0) bot.fireCd -= dt;
  if (bot.burstPause > 0) bot.burstPause -= dt;
  if (bot.reloading > 0) {
    bot.reloading -= dt;
    if (bot.reloading <= 0) {
      const need = bot.weapon.magSize - bot.mag;
      const take = Math.min(need, bot.reserve);
      bot.mag += take;
      bot.reserve -= take;
    }
  }

  // Default aim: hold look direction or drift forward along path.
  let wantYaw = bot.aimYaw;
  let wantPitch = 0;
  if (bot.holdLook && !bot.target && (bot.mode === 'hold' || bot.holdDwell > 0)) {
    const look = MAP.nodes[bot.holdLook];
    wantYaw = Math.atan2(-(look[0] - bot.pos.x), -(look[2] - bot.pos.z));
  }

  if (bot.target && bot.target.alive) {
    const t = bot.target;
    const eyeY = bot.pos.y + 1.58;
    const aimY = t.pos.y + (t.height ?? 1.72) * 0.8;
    const dx = t.pos.x - bot.pos.x;
    const dz = t.pos.z - bot.pos.z;
    const dy = aimY - eyeY;
    const flat = Math.hypot(dx, dz);
    // Aim error shrinks as the bot keeps sight (tracking).
    const err = bot.aimError * Math.max(0.25, 1 - bot.seeTimer * 1.4);
    wantYaw = Math.atan2(-dx, -dz) + (random() - 0.5) * err;
    wantPitch = Math.atan2(dy, flat) + (random() - 0.5) * err;
  }
  // Turn smoothly.
  const turnRate = (bot.target ? 10 : 5) * dt;
  let dYaw = wantYaw - bot.aimYaw;
  while (dYaw > Math.PI) dYaw -= Math.PI * 2;
  while (dYaw < -Math.PI) dYaw += Math.PI * 2;
  bot.aimYaw += dYaw * Math.min(1, turnRate);
  bot.aimPitch += (wantPitch - bot.aimPitch) * Math.min(1, turnRate);

  if (!bot.target || !bot.target.alive) return;

  // Trigger discipline: reaction delay, then bursts with pauses.
  if (bot.seeTimer < bot.reaction) return;
  if (bot.burstPause > 0 || bot.fireCd > 0) return;
  if (bot.reloading > 0) return;
  if (bot.mag <= 0) {
    if (bot.reserve > 0) bot.reloading = bot.weapon.reloadTime;
    return;
  }
  // Fire one round of the burst.
  const spreadDir = scratch(0, 0, 0);
  const flat = Math.hypot(bot.target.pos.x - bot.pos.x, bot.target.pos.z - bot.pos.z);
  const dist = Math.hypot(flat, bot.target.pos.y + 0.8 - (bot.pos.y + 1.58));
  const spread = bot.weapon.spreadStill + (moving01(bot) * bot.weapon.spreadMove);
  const yaw = bot.aimYaw + (random() - 0.5) * spread;
  const pitch = bot.aimPitch + (random() - 0.5) * spread;
  const cp = Math.cos(pitch);
  spreadDir.x = -Math.sin(yaw) * cp;
  spreadDir.y = Math.sin(pitch);
  spreadDir.z = -Math.cos(yaw) * cp;
  events.onBotShoot(bot, spreadDir, dist);
  release(1);
  bot.mag -= 1;
  bot.fireCd = bot.weapon.fireGap;
  if (bot.burstLeft <= 0) bot.burstLeft = BASE.burstMin + Math.floor(random() * (BASE.burstMax - BASE.burstMin));
  bot.burstLeft -= 1;
  if (bot.burstLeft <= 0) bot.burstPause = 0.25 + random() * 0.4;
}

// How much of max speed the bot is using, 0..1 (for spread).
function moving01(bot) {
  return Math.min(1, Math.hypot(bot.vel.x, bot.vel.z) / 5.4);
}

// Movement: follow path, hold position, hunt, strafe in combat. All rolls come
// from the seeded random so sim stays deterministic.
function moveTick(bot, dt, world, random) {
  const speedMult = bot.weapon.moveSpeed;
  const maxSpeed = 5.0 * speedMult;
  let wishX = 0;
  let wishZ = 0;

  const atGoal = bot.goal && Math.hypot(MAP.nodes[bot.goal][0] - bot.pos.x, MAP.nodes[bot.goal][2] - bot.pos.z) < 1.2
    && Math.abs(MAP.nodes[bot.goal][1] - bot.pos.y) < 1.5;

  if (bot.target && bot.target.alive) {
    // In a fight: strafe and close distance a little.
    bot.strafeTimer -= dt;
    if (bot.strafeTimer <= 0) {
      bot.strafe = random() < 0.5 ? -1 : 1;
      bot.strafeTimer = 0.5 + random() * 0.7;
    }
    const dx = bot.target.pos.x - bot.pos.x;
    const dz = bot.target.pos.z - bot.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const push = dist > 14 ? 0.7 : dist < 6 ? -0.5 : 0;
    const fx = dx / dist;
    const fz = dz / dist;
    wishX = fx * push + -fz * bot.strafe * 0.6;
    wishZ = fz * push + fx * bot.strafe * 0.6;
    // Cancel the plan while fighting; resume after (mode keeps its meaning).
    bot.pathIdx = bot.path.length;
  } else if (bot.mode === 'hold') {
    if (atGoal) {
      // Dwell at the hold, then re-pick a hold point via the round plan.
      bot.holdDwell += dt;
      // Small idle shuffle keeps them from statue-freezing.
      if (bot.holdDwell > 2.2 && random() < 0.005) {
        bot.holdDwell = 0;
        bot.strafe = random() < 0.5 ? -1 : 1;
      }
      if (bot.strafe !== 0) {
        wishX = Math.cos(bot.aimYaw) * bot.strafe * 0.3;
        wishZ = -Math.sin(bot.aimYaw) * bot.strafe * 0.3;
        if (bot.holdDwell > 0.4) bot.strafe = 0;
      }
    } else {
      followPath(bot, dt);
      const node = currentWaypoint(bot);
      if (node) {
        wishX = node.x;
        wishZ = node.z;
        release(1);
      }
    }
  } else {
    // route / hunt / plant-approach / defuse-approach: walk the path.
    if (!atGoal) {
      if (bot.pathIdx >= bot.path.length && bot.goal) {
        bot.path = findPath(nearestNode(bot.pos.x, bot.pos.z, bot.pos.y), bot.goal);
        bot.pathIdx = 0;
      }
      followPath(bot, dt);
      const node = currentWaypoint(bot);
      if (node) {
        wishX = node.x;
        wishZ = node.z;
        release(1);
      }
    }
  }

  const len = Math.hypot(wishX, wishZ);
  if (len > 0.001) {
    wishX = (wishX / len) * maxSpeed;
    wishZ = (wishZ / len) * maxSpeed;
    const accel = 30;
    const dvx = wishX - bot.vel.x;
    const dvz = wishZ - bot.vel.z;
    const dLen = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dLen > maxDv) {
      bot.vel.x += (dvx / dLen) * maxDv;
      bot.vel.z += (dvz / dLen) * maxDv;
    } else {
      bot.vel.x = wishX;
      bot.vel.z = wishZ;
    }
  } else {
    const damp = Math.max(0, 1 - 9 * dt);
    bot.vel.x *= damp;
    bot.vel.z *= damp;
  }
}

// Pull the next waypoint's world position into a scratch vec, advancing the
// path index when reached (flat distance AND level must both match — a node
// overhead on the deck is not "reached" from the yard floor).
function currentWaypoint(bot) {
  while (bot.pathIdx < bot.path.length) {
    const name = bot.path[bot.pathIdx];
    const n = MAP.nodes[name];
    const dx = n[0] - bot.pos.x;
    const dz = n[2] - bot.pos.z;
    if (Math.hypot(dx, dz) < 1.0 && Math.abs(n[1] - bot.pos.y) < 1.5) {
      bot.pathIdx += 1;
      continue;
    }
    const out = scratch(dx, 0, dz);
    return out;
  }
  return null;
}

function followPath(bot, dt) {
  // Repath periodically in case the goal moved or the path is stale.
  bot.repathTimer -= dt;
  if (bot.repathTimer <= 0 && bot.goal) {
    bot.repathTimer = 1.5;
    if (bot.pathIdx >= bot.path.length) {
      bot.path = findPath(nearestNode(bot.pos.x, bot.pos.z, bot.pos.y), bot.goal);
      bot.pathIdx = 0;
    }
  }
}

// Integrate velocity, resolve collisions, stay grounded.
function physics(bot, dt, world) {
  bot.vel.y -= GRAVITY * dt;
  const delta = { x: bot.vel.x * dt, y: bot.vel.y * dt, z: bot.vel.z * dt };
  const blocked = moveAABB(bot.pos, delta, RADIUS, HEIGHT, 2);
  if (bot.pos.y <= 0.001 || blocked) {
    bot.pos.y = Math.max(0, bot.pos.y);
    bot.vel.y = 0;
  }
  bot.pos.x = Math.max(-19.6, Math.min(19.6, bot.pos.x));
  bot.pos.z = Math.max(-16.6, Math.min(16.6, bot.pos.z));
  // Sync visible mesh.
  if (bot.mesh) {
    bot.mesh.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
    bot.mesh.rotation.y = bot.aimYaw;
    // Lean into crouch on hold for silhouette variety.
    const crouch = bot.mode === 'hold' && !bot.target && bot.pathIdx >= bot.path.length;
    bot.mesh.scale.y = crouch ? 0.85 : 1;
  }
}

// Plant / defuse logic. bomb = {state:'carried'|'planted'|'defused'|'exploded', ...}
function objectiveTick(bot, dt, world, events) {
  if (!bot.bomb || !bot.task) return;
  if (bot.target && bot.target.alive) return; // fight first

  if (bot.task === 'plant') {
    const site = bot.bomb.site;
    const dist = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
    if (dist < 2.4 && bot.mode === 'plant') {
      bot.plantProgress += dt / 3.2;
      events.onProgress?.('cobalt-plant', bot.plantProgress);
      if (bot.plantProgress >= 1) {
        bot.task = null;
        events.onPlanted?.(bot);
      }
    } else if (bot.mode === 'plant') {
      // Walk to the site centre.
      bot.goal = site.node;
      if (bot.pathIdx >= bot.path.length) {
        bot.path = findPath(nearestNode(bot.pos.x, bot.pos.z, bot.pos.y), bot.goal);
        bot.pathIdx = 0;
      }
    }
  } else if (bot.task === 'defuse') {
    if (bot.bomb.state !== 'planted') { bot.task = null; return; }
    const dist = Math.hypot(bot.bomb.pos.x - bot.pos.x, bot.bomb.pos.z - bot.pos.z);
    if (dist < 1.6) {
      bot.defuseProgress += dt / 5.0;
      events.onProgress?.('cobalt-defuse', bot.defuseProgress);
      if (bot.defuseProgress >= 1) {
        bot.task = null;
        events.onDefused?.(bot);
      }
    } else {
      bot.goal = nearestNode(bot.bomb.pos.x, bot.bomb.pos.z, bot.pos.y);
      if (bot.pathIdx >= bot.path.length) {
        bot.path = findPath(nearestNode(bot.pos.x, bot.pos.z, bot.pos.y), bot.goal);
        bot.pathIdx = 0;
      }
    }
  }
}

// Reaction to being shot lives in game.applyDamage (turn toward the shooter,
// hunt last seen); death flows through applyDamage too, so no passthrough here.
