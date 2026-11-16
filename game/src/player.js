// Player: input-driven movement in the shared collision world, camera look with
// recoil, and the health/economy state the HUD reads. Physics runs in step() at
// the fixed tick; the render side only reads state. Ammo pools live per gun in
// loadout so swapping doesn't share one magazine.
import { moveAABB, colliders } from './geometry.js';
import { WEAPONS } from './weapons.js';

export const RADIUS = 0.34;
export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.12;
export const EYE_STAND = 1.6;
export const EYE_CROUCH = 1.02;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.5;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.3;
const CROUCH_RATE = 6;

export function createPlayer(spawn) {
  return {
    pos: { x: spawn.x, y: 0, z: spawn.z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    height: STAND_HEIGHT,
    crouching: false,
    grounded: true,
    alive: true,
    health: 100,
    armor: 0,
    money: 800,
    name: 'You',
    isPlayer: true,
    team: 'copper',
    radius: RADIUS,
    // Recoil: aim offset that decays back to zero.
    recoilYaw: 0,
    recoilPitch: 0,
    // Guns: which is held, and each gun's own magazine/reserve.
    gun: 'marrow',
    lastGun: 'marrow',
    loadout: {
      vandal: { mag: 0, reserve: 0 },
      marrow: { mag: WEAPONS.marrow.magSize, reserve: WEAPONS.marrow.reserve },
    },
    grenades: 0,
    reloading: 0,
    reloadWeapon: null,
    reloadSlot: null,
    fireCd: 0,
    planting: 0,
    defusing: 0,
    kills: 0,
    deaths: 0,
    landImpulse: 0,
  };
}

// The ammo slot of the currently held gun.
export function gunSlot(p) {
  return p.loadout[p.gun];
}

// Eye height follows the body height.
export function eyeY(p) {
  const t = (p.height - CROUCH_HEIGHT) / (STAND_HEIGHT - CROUCH_HEIGHT);
  return EYE_CROUCH + (EYE_STAND - EYE_CROUCH) * t;
}

export function look(p, dx, dy) {
  p.yaw -= dx * 0.0023;
  p.pitch -= dy * 0.0023;
  const limit = Math.PI / 2 - 0.01;
  if (p.pitch > limit) p.pitch = limit;
  if (p.pitch < -limit) p.pitch = -limit;
}

// Where the gun points: look angles plus recoil offset. Writes into `dir`.
export function aimDir(p, dir) {
  const yaw = p.yaw + p.recoilYaw;
  const pitch = p.pitch + p.recoilPitch;
  const cp = Math.cos(pitch);
  dir.x = -Math.sin(yaw) * cp;
  dir.y = Math.sin(pitch);
  dir.z = -Math.cos(yaw) * cp;
}

export function step(p, input, dt, speedMult) {
  if (!p.alive) {
    // Dead: settle to the ground, no input.
    p.vel.y -= GRAVITY * dt;
    p.pos.y += p.vel.y * dt;
    if (p.pos.y < 0) { p.pos.y = 0; p.vel.y = 0; }
    return;
  }

  // Crouch: interpolate body height.
  const targetHeight = input.crouch ? CROUCH_HEIGHT : STAND_HEIGHT;
  if (targetHeight > p.height) {
    const next = Math.min(targetHeight, p.height + CROUCH_RATE * dt);
    if (!headBlocked(p.pos, next)) p.height = next;
  } else {
    p.height = Math.max(CROUCH_HEIGHT, p.height - CROUCH_RATE * dt);
  }
  p.crouching = p.height < STAND_HEIGHT - 0.05;

  // Wish direction from input, rotated by yaw.
  const f = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  const s = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let wishX = 0;
  let wishZ = 0;
  if (f !== 0 || s !== 0) {
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    wishX = -sin * f + cos * s;
    wishZ = -cos * f - sin * s;
    const len = Math.hypot(wishX, wishZ);
    wishX /= len;
    wishZ /= len;
  }

  let maxSpeed = (input.crouch ? CROUCH_SPEED : WALK_SPEED) * speedMult;
  if (input.walkHold) maxSpeed *= 0.55;
  const accel = p.grounded ? GROUND_ACCEL : AIR_ACCEL;

  if (p.grounded) {
    // Friction first, then accelerate toward wish speed.
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (speed > 0) {
      const drop = speed * FRICTION * dt;
      const scale = Math.max(0, speed - drop) / speed;
      p.vel.x *= scale;
      p.vel.z *= scale;
    }
    if (wishX !== 0 || wishZ !== 0) {
      const current = p.vel.x * wishX + p.vel.z * wishZ;
      const add = Math.min(maxSpeed - current, accel * dt);
      if (add > 0) {
        p.vel.x += wishX * add;
        p.vel.z += wishZ * add;
      }
    }
    if (input.jump) {
      p.vel.y = JUMP_SPEED;
      p.grounded = false;
    }
  } else {
    if (wishX !== 0 || wishZ !== 0) {
      const current = p.vel.x * wishX + p.vel.z * wishZ;
      const add = Math.min(maxSpeed * 1.1 - current, accel * dt);
      if (add > 0) {
        p.vel.x += wishX * add;
        p.vel.z += wishZ * add;
      }
    }
    p.vel.y -= GRAVITY * dt;
  }

  // Move with collision.
  const wasGrounded = p.grounded;
  const fallSpeed = p.vel.y;
  const delta = { x: p.vel.x * dt, y: p.vel.y * dt, z: p.vel.z * dt };
  const blocked = moveAABB(p.pos, delta, RADIUS, p.height, 2);
  if (p.pos.y <= 0.001) {
    if (!wasGrounded) p.landImpulse = Math.min(1, -fallSpeed / JUMP_SPEED);
    p.pos.y = 0;
    p.vel.y = 0;
    p.grounded = true;
  } else if (blocked) {
    p.vel.y = 0;
    p.grounded = true;
  } else {
    p.grounded = false;
  }
  // Keep the player inside the yard even if a collider fails.
  p.pos.x = Math.max(-19.6, Math.min(19.6, p.pos.x));
  p.pos.z = Math.max(-16.6, Math.min(16.6, p.pos.z));

  // Recoil recovery and timers.
  const decay = Math.exp(-7 * dt);
  p.recoilYaw *= decay;
  p.recoilPitch *= decay;
  if (p.fireCd > 0) p.fireCd -= dt;
  if (p.reloading > 0) {
    p.reloading -= dt;
    if (p.reloading <= 0 && p.reloadSlot) {
      const weapon = p.reloadWeapon;
      const need = weapon.magSize - p.reloadSlot.mag;
      const take = Math.min(need, p.reloadSlot.reserve);
      p.reloadSlot.mag += take;
      p.reloadSlot.reserve -= take;
      p.reloadSlot = null;
      p.reloadWeapon = null;
    }
  }
  p.landImpulse *= Math.exp(-6 * dt);
}

function headBlocked(pos, height) {
  // Any collider overlapping the would-be head space?
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    if (
      pos.x + RADIUS > c[0] && pos.x - RADIUS < c[3] &&
      pos.z + RADIUS > c[2] && pos.z - RADIUS < c[5] &&
      pos.y + height > c[1] && pos.y + 0.3 < c[4]
    ) return true;
  }
  return false;
}

export function startReload(p, weapon) {
  if (p.reloading > 0 || weapon.kind !== 'gun') return;
  const slot = p.loadout[p.gun];
  if (slot.mag >= weapon.magSize || slot.reserve <= 0) return;
  p.reloading = weapon.reloadTime;
  p.reloadWeapon = weapon;
  p.reloadSlot = slot;
}

export function groundSpeed(p) {
  return Math.hypot(p.vel.x, p.vel.z);
}
