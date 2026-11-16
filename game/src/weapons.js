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
    recoilKick: 0.014, // radians of aim climb per shot
    recoilReturn: 6.5, // aim recovery rate
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
    recoilKick: 0.008,
    recoilReturn: 8,
    range: 60,
    tracer: 0xe8a33d,
    moveSpeed: 1.08,
  },
  fusepack: {
    name: 'Fusepack',
    kind: 'grenade',
    price: 500,
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
