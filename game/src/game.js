// The world: one instance owns the scene, the map, the player, the Cobalt squad,
// the bomb, and the round state machine, and steps them all at the fixed tick.
// This is the whole simulation — rendering (main.js) only reads it. The Copper
// side (player) attacks with the bomb; Cobalt bots defend, defuse, and shoot
// back. Rounds end in a win or a loss for exactly one side — no draws.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createRandom } from './rng.js';
import { buildMap, MAP, nearestNode, findPath } from './map.js';
import { createPlayer, step as stepPlayer, look as lookPlayer, aimDir, eyeY, startReload, groundSpeed, gunSlot } from './player.js';
import { WEAPONS } from './weapons.js';
import { createBot, buildBotMesh, assignPlan, stepBot } from './bots.js';
import { createBomb, resetBomb, plantBomb, defuseBomb, siteAt, stepBomb } from './bomb.js';
import { fireHitscan, stepGrenades, throwGrenade, clearGrenades } from './combat.js';
import { sounds, resumeAudio } from './audio.js';
import { scratch, release } from './scratch.js';

export const BUY_TIME = 10;
export const ROUND_TIME = 90;
export const ROUNDS_TO_WIN = 5;
export const REWARD = { kill: 300, win: 3250, loss: 1900, lossBonus: 500, plant: 300, maxMoney: 9000 };
const BOT_NAMES = ['VEX', 'HALDANE', 'ROOK', 'KESTREL'];
const SQUAD_SIZE = 4;

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, 30, 95);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 220);
  scene.add(camera);

  const world = {
    renderer,
    scene,
    camera,
    canvas,
    characters: [],
    bots: [],
    random: createRandom(20260501),
    rounds: null,
    roundNumber: 1,
    loadout: { rifle: 'marrow', grenades: 0 },
    armorOwned: false,
    events: null,
  };

  buildMap(scene);

  const player = createPlayer(MAP.copperSpawns[0]);
  world.player = player;
  world.characters.push(player);

  for (let i = 0; i < SQUAD_SIZE; i += 1) {
    const bot = createBot(BOT_NAMES[i], i < 2 ? 'vandal' : 'marrow', 0.45 + 0.14 * i);
    buildBotMesh(bot, scene);
    world.bots.push(bot);
    world.characters.push(bot);
  }

  world.bomb = createBomb(scene);
  return world;
}

// Match (re)start: fresh economy and loadout, round 1.
export function startMatch(world) {
  const player = world.player;
  player.money = 800;
  player.kills = 0;
  player.deaths = 0;
  player.armor = 0;
  world.roundNumber = 1;
  world.loadout = { rifle: 'marrow', grenades: 0 };
  world.armorOwned = false;
  player.gun = 'marrow';
  player.loadout.marrow.mag = WEAPONS.marrow.magSize;
  player.loadout.marrow.reserve = WEAPONS.marrow.reserve;
  player.loadout.vandal.mag = 0;
  player.loadout.vandal.reserve = 0;
  startRound(world);
}

// One round: reset positions, health, bomb; buy phase first. Between rounds the
// bought loadout (world.loadout) persists; ammo refills.
export function startRound(world) {
  const player = world.player;
  const rounds = (world.rounds ??= {});
  rounds.number = world.roundNumber;
  rounds.phase = 'buy';
  rounds.phaseTimer = BUY_TIME;
  rounds.bombPlanted = false;
  rounds.copperScore ??= 0;
  rounds.cobaltScore ??= 0;
  rounds.winner = null;
  rounds.reason = '';
  rounds.matchOver = false;
  rounds.lossStreak = rounds.lossStreak ?? 0;

  resetBomb(world.bomb);
  clearGrenades();

  player.alive = true;
  player.health = 100;
  player.armor = world.armorOwned ? Math.max(player.armor, 50) : player.armor;
  player.gun = world.loadout.rifle;
  player.grenades = world.loadout.grenades;
  for (const key of Object.keys(player.loadout)) {
    const weapon = WEAPONS[key];
    const slot = player.loadout[key];
    slot.mag = weapon.magSize;
    slot.reserve = weapon.reserve;
  }
  const spawn = MAP.copperSpawns[0];
  player.pos.x = spawn.x; player.pos.y = 0; player.pos.z = spawn.z;
  player.vel.x = 0; player.vel.y = 0; player.vel.z = 0;
  player.yaw = Math.atan2(-(spawn.fx - spawn.x), -(spawn.fz - spawn.z));
  player.pitch = 0;
  player.recoilYaw = 0;
  player.recoilPitch = 0;
  player.planting = 0;
  player.defusing = 0;
  player.reloading = 0;
  player.fireCd = 0;
  player.height = 1.72;

  // Bots: one rover walks the spine, the rest hold positions watching lanes.
  // Paths are real node routes from each bot's spawn — a bare goal would
  // beeline through walls.
  const holds = shuffled(world.random, MAP.holds.slice());
  for (let i = 0; i < world.bots.length; i += 1) {
    const bot = world.bots[i];
    bot.mesh.visible = true;
    const sp = MAP.cobaltSpawns[i];
    bot.pos.x = sp.x; bot.pos.y = 0; bot.pos.z = sp.z;
    bot.vel.x = 0; bot.vel.y = 0; bot.vel.z = 0;
    bot.aimYaw = Math.atan2(-(sp.fx - sp.x), -(sp.fz - sp.z));
    const start = nearestNode(sp.x, sp.z, 0);
    const plan = i === 0
      ? { mode: 'route', goal: 'd2', path: findPath(start, 'd2'), holdPoint: null, holdLook: null, task: null }
      : { mode: 'hold', goal: holds[(i - 1) % holds.length].node, path: findPath(start, holds[(i - 1) % holds.length].node), holdPoint: holds[(i - 1) % holds.length].node, holdLook: holds[(i - 1) % holds.length].look, task: 'defuse' };
    assignPlan(bot, plan, world.bomb);
  }
}

function shuffled(random, arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// The fixed-step simulation tick. `input` is the input state (or a stub in shot
// mode); dt is the fixed step. hooks are the render-side callbacks.
export function stepWorld(world, input, dt, hooks) {
  const player = world.player;
  const rounds = world.rounds;
  const events = (world.events ??= makeEvents(world, hooks));

  resumeAudio();

  // --- Round phase machine ---------------------------------------------------
  if (rounds.phase === 'buy') {
    rounds.phaseTimer -= dt;
    if (rounds.phaseTimer <= 0) {
      rounds.phase = 'live';
      rounds.phaseTimer = ROUND_TIME;
      sounds.roundStart();
      hooks.onLive?.();
    }
  } else if (rounds.phase === 'live') {
    rounds.phaseTimer -= dt;
    if (rounds.phaseTimer <= 0) {
      // Timeout: with the bomb down the fuse governs; otherwise Cobalt held
      // (no plant = no draw).
      if (rounds.bombPlanted) {
        rounds.phaseTimer = 0.001; // stepBomb detonates this tick
      } else {
        finishRound(world, 'cobalt', 'Time expired — yard held', hooks);
      }
    }
  } else if (rounds.phase === 'end') {
    rounds.phaseTimer -= dt;
    if (rounds.phaseTimer <= 0) {
      if (rounds.matchOver) {
        rounds.phase = 'match';
        hooks.onMatchEnd?.();
        return;
      }
      world.roundNumber += 1;
      startRound(world);
      hooks.onNewRound?.();
      return;
    }
  }

  const live = rounds.phase === 'live';

  // --- Player -----------------------------------------------------------------
  const [dx, dy] = input.takeLook();
  if (live && player.alive) lookPlayer(player, dx, dy);

  // One-shot keys, live phase only.
  if (live && player.alive) {
    if (input.swap === 1) swapTo(world, world.loadout.rifle, hooks);
    else if (input.swap === 2) swapTo(world, 'marrow', hooks);
    else if (input.swap === 3 && player.grenades > 0) swapTo(world, 'fusepack', hooks);
    if (input.reload) startReload(player, WEAPONS[player.gun]);
  }
  // Shop toggle works during the buy phase even while dead.
  if (input.shop && rounds.phase === 'buy') hooks.onShopKey?.();
  input.swap = 0;
  input.reload = false;
  input.shop = false;
  // input.use is held (E), not one-shot — bombInteract reads it below.

  const busy = player.planting > 0 || player.defusing > 0;
  const speedMult = live ? WEAPONS[player.gun]?.moveSpeed ?? 1 : 0;
  stepPlayer(player, input, dt, busy ? speedMult * 0.15 : speedMult);

  // Firing.
  if (live && player.alive && input.firing && !busy) tryPlayerFire(world, hooks);

  // Bomb interactions.
  bombInteract(world, input, dt, hooks);

  // --- Bots & bomb --------------------------------------------------------------
  if (live) {
    for (const bot of world.bots) stepBot(bot, dt, world, world.random, events);
    stepBomb(world.bomb, dt, events);
  }

  // --- Grenades -------------------------------------------------------------------
  stepGrenades(dt, world.characters, (target, amount, part, killed, shooter) => {
    applyDamage(world, target, amount, part, shooter, hooks);
  });
}

// Player fire: hitscan for guns, throw for the fusepack.
function tryPlayerFire(world, hooks) {
  const player = world.player;
  const weapon = WEAPONS[player.gun];

  if (weapon.kind === 'grenade') {
    if (player.fireCd > 0 || player.grenades <= 0) return;
    player.grenades -= 1;
    player.fireCd = 0.7;
    const origin = scratch(player.pos.x, player.pos.y + eyeY(player) - 0.1, player.pos.z);
    const dir = aimDirScratch(player);
    throwGrenade(player, origin.x, origin.y, origin.z,
      dir.x, dir.y + 0.14, dir.z, WEAPONS.fusepack.throwSpeed, WEAPONS.fusepack.fuseTime);
    release(2);
    sounds.shot();
    hooks.onGrenadeThrown?.();
    if (player.grenades <= 0) swapTo(world, world.loadout.rifle, hooks);
    return;
  }

  if (player.reloading > 0 || player.fireCd > 0) return;
  const slot = gunSlot(player);
  if (slot.mag <= 0) {
    sounds.empty();
    player.fireCd = 0.25;
    startReload(player, weapon);
    return;
  }
  slot.mag -= 1;
  player.fireCd = weapon.fireGap;
  sounds.shot();
  hooks.onShot?.(weapon);

  // Spread: still shots are laser, moving shots spray (quadratic in speed).
  // Crouching tightens the cone.
  const moveFrac = Math.min(1, groundSpeed(player) / 5.4);
  const crouchBonus = player.crouching ? 0.65 : 1;
  const spread = (weapon.spreadStill + weapon.spreadMove * moveFrac * moveFrac) * crouchBonus;

  const origin = scratch(player.pos.x, player.pos.y + eyeY(player), player.pos.z);
  const dir = aimDirScratch(player);
  rotateDir(dir, (world.random() - 0.5) * 2 * spread, (world.random() - 0.5) * 2 * spread);
  const result = fireHitscan(world, player, origin, dir, weapon, {
    applyDamage: (target, amount, part, killed, shooter) => applyDamage(world, target, amount, part, shooter, hooks),
  });
  release(2); // origin + dir
  if (result) hooks.onPlayerHit?.(result);

  // Recoil climbs the aim; recovery is exponential in stepPlayer.
  player.recoilPitch += weapon.recoilKick * (0.8 + world.random() * 0.4);
  player.recoilYaw += (world.random() - 0.5) * weapon.recoilKick * 0.5;
}

function aimDirScratch(player) {
  const dir = scratch(0, 0, 0);
  aimDir(player, dir);
  return dir;
}

// Small random yaw/pitch cone, applied in place.
function rotateDir(dir, yaw, pitch) {
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const x = dir.x * cosY - dir.z * sinY;
  const z = dir.x * sinY + dir.z * cosY;
  dir.x = x;
  dir.z = z;
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const y = dir.y * cosP - Math.hypot(dir.x, dir.z) * sinP;
  const flat = Math.hypot(dir.x, dir.z) * cosP + dir.y * sinP;
  dir.y = y;
  const len = Math.hypot(dir.x, flat) || 1;
  dir.x = (dir.x / len) * Math.hypot(dir.x, flat);
  dir.z = (dir.z / len) * flat;
  const l2 = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= l2;
  dir.y /= l2;
  dir.z /= l2;
}

export function swapTo(world, gunKey, hooks) {
  const player = world.player;
  if (player.gun === gunKey) return;
  if (gunKey === 'fusepack' && player.grenades <= 0) return;
  if (gunKey === 'vandal' && world.loadout.rifle !== 'vandal') return;
  player.gun = gunKey;
  player.reloading = 0;
  player.reloadSlot = null;
  player.fireCd = Math.max(player.fireCd, 0.25);
  hooks.onGunChange?.(gunKey);
}

// E key: plant when carrying in a site, defuse when near the planted bomb.
function bombInteract(world, input, dt, hooks) {
  const player = world.player;
  const rounds = world.rounds;
  if (rounds.phase !== 'live' || !player.alive) return;

  const holdingUse = Boolean(input.use);
  const site = siteAt(player.pos.x, player.pos.z);

  if (world.bomb.state === 'carried' && site && holdingUse) {
    player.planting += dt / 3.2;
    hooks.onProgress?.('PLANTING…', player.planting);
    if (player.planting >= 1) {
      player.planting = 0;
      plantBomb(world.bomb, player.pos.x, player.pos.z, player);
      rounds.bombPlanted = true;
      player.money = Math.min(REWARD.maxMoney, player.money + REWARD.plant);
      hooks.onProgress?.(null, 0);
      hooks.onPlanted?.();
      // Defenders converge on the bomb.
      for (const bot of world.bots) {
        if (bot.alive && bot.task === 'defuse') {
          bot.mode = 'route';
          bot.goal = nearestNode(world.bomb.pos.x, world.bomb.pos.z, bot.pos.y);
          bot.path = [];
          bot.pathIdx = 0;
          bot.holdLook = null;
        }
      }
    }
  } else if (world.bomb.state === 'planted' && holdingUse) {
    const d = Math.hypot(world.bomb.pos.x - player.pos.x, world.bomb.pos.z - player.pos.z);
    if (d < 1.6) {
      player.defusing += dt / 5.0;
      hooks.onProgress?.('DEFUSING…', player.defusing);
      if (player.defusing >= 1) {
        player.defusing = 0;
        defuseBomb(world.bomb);
        hooks.onProgress?.(null, 0);
        hooks.onDefused?.();
        finishRound(world, 'copper', 'Bomb defused', hooks);
      }
    } else if (player.defusing > 0) {
      player.defusing = 0;
      hooks.onProgress?.(null, 0);
    }
  } else if ((player.planting > 0 || player.defusing > 0) && !holdingUse) {
    player.planting = 0;
    player.defusing = 0;
    hooks.onProgress?.(null, 0);
  }
}

function makeEvents(world, hooks) {
  return {
    onBotShoot(bot, dir) {
      sounds.enemyShot();
      const origin = scratch(bot.pos.x, bot.pos.y + 1.5, bot.pos.z);
      fireHitscan(world, bot, origin, dir, bot.weapon, {
        applyDamage: (target, amount, part, killed, shooter) => applyDamage(world, target, amount, part, shooter, hooks),
      });
      release(1);
      hooks.onBotShoot?.(bot);
    },
    onPlanted(bot) {
      plantBomb(world.bomb, bot.pos.x, bot.pos.z, bot);
      world.rounds.bombPlanted = true;
      hooks.onPlanted?.();
    },
    onDefused(bot) {
      void bot;
      if (world.bomb.state === 'planted') {
        defuseBomb(world.bomb);
        hooks.onDefused?.();
        finishRound(world, 'cobalt', 'Bomb defused', hooks);
      }
    },
    onBombExploded() {
      hooks.onBombExploded?.();
      finishRound(world, 'copper', 'Bomb detonated', hooks);
    },
    onDeath(victim, shooter, part) {
      handleKill(world, victim, shooter, part, hooks);
    },
    onProgress() {},
  };
}

// Central damage entry: armor soak, death handling, kill rewards.
export function applyDamage(world, target, amount, part, shooter, hooks) {
  if (!target.alive || world.rounds.phase !== 'live') return;
  let dmg = amount;
  if (target.armor > 0 && part !== 'head') {
    const soaked = Math.min(target.armor, dmg * 0.4);
    target.armor -= soaked;
    dmg -= soaked;
  }
  target.health -= dmg;
  // A shot bot turns toward the shooter even without line of sight.
  if (target.isBot && shooter && shooter.team !== target.team) {
    const dx = shooter.pos.x - target.pos.x;
    const dz = shooter.pos.z - target.pos.z;
    target.aimYaw = Math.atan2(-dx, -dz);
    target.lastSeen.x = shooter.pos.x;
    target.lastSeen.y = shooter.pos.y;
    target.lastSeen.z = shooter.pos.z;
    if (!target.target) {
      target.target = shooter;
      target.seeTimer = 0;
    }
    target.loseTimer = 0;
  }
  if (shooter === world.player && target.team !== 'copper') {
    hooks.onPlayerHitTarget?.(part, dmg, target.health <= 0);
  }
  if (target === world.player) {
    hooks.onPlayerDamaged?.(dmg, shooter);
  }
  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    if (target.mesh) target.mesh.visible = false;
    handleKill(world, target, shooter, part, hooks);
  }
}

function handleKill(world, victim, shooter, part, hooks) {
  const rounds = world.rounds;
  if (rounds.phase !== 'live') return;
  const killerName = shooter === world.player ? 'You' : shooter?.name ?? '—';
  const victimName = victim === world.player ? 'You' : victim.name;
  hooks.onKill?.(killerName, victimName, part, shooter === world.player);
  if (shooter === world.player && victim.team === 'cobalt' && victim !== world.player) {
    hooks.onPlayerHitTarget?.('kill', 0, true);
  }

  if (shooter === world.player && victim.team === 'cobalt') {
    world.player.money = Math.min(REWARD.maxMoney, world.player.money + REWARD.kill);
    world.player.kills += 1;
  }

  // Drop the bomb if the carrier died: it stays where they fell and can be
  // picked up by walking over it.
  if (victim === world.player && world.bomb.state === 'carried') {
    world.bomb.pos.x = victim.pos.x;
    world.bomb.pos.y = victim.pos.y;
    world.bomb.pos.z = victim.pos.z;
    world.bomb.state = 'dropped';
    world.bomb.mesh.position.set(world.bomb.pos.x, world.bomb.pos.y, world.bomb.pos.z);
    world.bomb.mesh.visible = true;
    hooks.onBombDropped?.();
  }
  if (victim.task === 'plant' || victim.task === 'defuse') victim.task = null;

  checkWinConditions(world, hooks);
}

// Win/loss evaluation, called on deaths and every live tick via conditions here.
export function checkWinConditions(world, hooks) {
  const rounds = world.rounds;
  if (rounds.phase !== 'live') return;
  const player = world.player;
  const bomb = world.bomb;

  if (bomb.state === 'exploded' || bomb.state === 'defused') return; // already resolved

  // Player dead: with the bomb planted the round rides on the fuse; otherwise
  // Cobalt wins now.
  if (!player.alive && bomb.state !== 'planted') {
    finishRound(world, 'cobalt', 'You were eliminated', hooks);
    return;
  }

  const botsAlive = world.bots.reduce((n, b) => n + (b.alive ? 1 : 0), 0);
  if (botsAlive === 0 && bomb.state !== 'planted') {
    finishRound(world, 'copper', 'Cobalt squad wiped', hooks);
  }
  // With the bomb planted and bots alive, the fuse decides (bots must defuse).
}

// Award the round, update score/money/streak, and open the end phase.
function finishRound(world, winner, reason, hooks) {
  const rounds = world.rounds;
  const player = world.player;
  if (rounds.phase !== 'live') return;
  rounds.phase = 'end';
  rounds.phaseTimer = 4;
  rounds.winner = winner;
  rounds.reason = reason;
  if (winner === 'copper') {
    rounds.copperScore += 1;
    rounds.lossStreak = 0;
    player.money = Math.min(REWARD.maxMoney, player.money + REWARD.win + (rounds.bombPlanted ? REWARD.plant : 0));
    sounds.win();
  } else {
    rounds.cobaltScore += 1;
    rounds.lossStreak = Math.min(2, (rounds.lossStreak ?? 0) + 1);
    player.money = Math.min(REWARD.maxMoney, player.money + REWARD.loss + rounds.lossStreak * REWARD.lossBonus);
    sounds.lose();
  }
  if (rounds.copperScore >= ROUNDS_TO_WIN || rounds.cobaltScore >= ROUNDS_TO_WIN) {
    rounds.matchOver = true;
    rounds.matchWinner = rounds.copperScore >= ROUNDS_TO_WIN ? 'copper' : 'cobalt';
  }
  hooks.onRoundEnd?.(winner, reason);
}

// Seed control for the ?shot= deterministic mode.
export function setSeed(world, seed) {
  world.random = createRandom(seed);
}

// Buy-phase purchase application: called by main.js when the player buys.
export function applyPurchase(world, item) {
  const player = world.player;
  if (item === 'vandal' && player.money >= WEAPONS.vandal.price && world.loadout.rifle !== 'vandal') {
    player.money -= WEAPONS.vandal.price;
    world.loadout.rifle = 'vandal';
    player.gun = 'vandal';
    return true;
  }
  if (item === 'marrow' && world.loadout.rifle !== 'marrow') {
    world.loadout.rifle = 'marrow';
    player.gun = 'marrow';
    return true;
  }
  if (item === 'grenade' && player.money >= WEAPONS.fusepack.price && world.loadout.grenades < 1) {
    player.money -= WEAPONS.fusepack.price;
    world.loadout.grenades += 1;
    player.grenades = world.loadout.grenades;
    return true;
  }
  if (item === 'armor' && player.money >= 650 && player.armor < 50) {
    player.money -= 650;
    player.armor = 50;
    world.armorOwned = true;
    return true;
  }
  return false;
}

// Walk-over pickup of a dropped bomb.
export function tryPickupBomb(world) {
  const player = world.player;
  const bomb = world.bomb;
  if (bomb.state !== 'dropped' || !player.alive) return false;
  const d = Math.hypot(bomb.pos.x - player.pos.x, bomb.pos.z - player.pos.z);
  if (d < 1.2) {
    bomb.state = 'carried';
    bomb.mesh.visible = false;
    return true;
  }
  return false;
}

// Ammo refill helper for the buy menu (buying ammo tops both guns).
export function refillAmmo(world) {
  const player = world.player;
  for (const key of ['vandal', 'marrow']) {
    const weapon = WEAPONS[key];
    const slot = player.loadout[key];
    slot.mag = weapon.magSize;
    slot.reserve = weapon.reserve;
  }
}
