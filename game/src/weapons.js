// Weapon definitions — pure data plus the damage model. Three tools: the
// Vandal-9 rifle (one-buy workhorse), the Marrow pistol (free fallback), and the
// fusepack grenade (area damage on a fuse). Hit zones: head x2.5, torso x1,
// legs x0.75.
export const WEAPONS = {
  vandal: {
    name: 'Vandal-9',
    kind: 'gun',
    price: 2700,
    damage: 33,
    headMult: 2.5,
    legMult: 0.75,
    magSize: 25,
    reserve: 75,
    fireGap: 0.105, // seconds between shots
    reloadTime: 2.1,
    spreadStill: 0.0022,
    spreadMove: 0.03, // full spread at runSpeed
    spreadCrouch: 0.58, // cone multiplier while crouched
    bloomPerShot: 0.0011, // sustained-fire cone growth per shot
    bloomMax: 0.012,
    bloomRecovery: 0.045, // radians of bloom shed per second
    recoilKick: 0.014, // radians of aim climb per shot
    recoilHoriz: 0.0055, // sideways wobble per shot (alternates)
    recoilReturn: 6.5, // aim recovery rate
    preferredRange: [9, 17], // bot engagement band, metres
    range: 90,
    tracer: 0xe8a33d,
    moveSpeed: 1.0,
  },
  marrow: {
    name: 'Marrow',
    kind: 'gun',
    price: 0,
    damage: 22,
    headMult: 2.8,
    legMult: 0.75,
    magSize: 12,
    reserve: 36,
    fireGap: 0.16,
    reloadTime: 1.5,
    spreadStill: 0.0035,
    spreadMove: 0.022,
    spreadCrouch: 0.62,
    bloomPerShot: 0.0016,
    bloomMax: 0.011,
    bloomRecovery: 0.05,
    recoilKick: 0.008,
    recoilHoriz: 0.0028,
    recoilReturn: 8,
    preferredRange: [5, 10],
    range: 60,
    tracer: 0xe8a33d,
    moveSpeed: 1.08,
  },
  fusepack: {
    name: 'Fusepack',
    kind: 'grenade',
    price: 400,
    damage: 105, // at centre, falls off with distance
    radius: 7.5,
    fuseTime: 1.9,
    throwSpeed: 15,
    count: 1,
  },
};

// Damage after zone multiplier, with the one-shot headshot rule for rifles at
// full health. Returns {amount, killed}.
export function applyZoneDamage(weapon, part, health, dist) {
  const mult = part === 'head' ? weapon.headMult : part === 'legs' ? weapon.legMult : 1;
  // Damage eases off with distance so long pokes are fair.
  const falloff = Math.max(0.55, 1 - dist / 140);
  const amount = Math.round(weapon.damage * mult * falloff);
  return { amount, killed: amount >= health };
}

// Total inaccuracy cone for a shot: the weapon's base cone, grown by sustained
// fire (bloom), widened by movement, tightened by crouching. `bloom` is the
// shooter's accumulated bloom, `moveFrac` their speed as 0..1 of run speed.
export function shotSpread(weapon, bloom, moveFrac, crouching) {
  const move = weapon.spreadMove * moveFrac * moveFrac; // quadratic in speed
  const crouch = crouching ? (weapon.spreadCrouch ?? 1) : 1;
  return (weapon.spreadStill + bloom + move) * crouch;
}
