// Shared collision geometry: one list of axis-aligned boxes that bullets trace
// against, movers slide along, and grenades bounce off. The map builds it once;
// everything else reads it.
export const colliders = [];

// Box: [minX, minY, minZ, maxX, maxY, maxZ].
export function addCollider(minX, minY, minZ, maxX, maxY, maxZ) {
  colliders.push([minX, minY, minZ, maxX, maxY, maxZ]);
}

export function clearColliders() {
  colliders.length = 0;
}

// Does the swept point at (x,y,z) with the given radius/height overlap any box?
// Used for spawns, waypoints and grenade rests.
export function pointBlocked(x, y, z, radius, height) {
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    if (
      x + radius > c[0] && x - radius < c[3] &&
      z + radius > c[2] && z - radius < c[5] &&
      y + height > c[1] && y < c[4]
    ) return true;
  }
  return false;
}

// Ground height under a point: the highest box top at or below `fromY` within the
// footprint. Returns 0 (floor) when nothing is under it.
export function groundHeight(x, z, radius, fromY) {
  let best = 0;
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    if (x + radius <= c[0] || x - radius >= c[3] || z + radius <= c[2] || z - radius >= c[5]) continue;
    if (c[4] <= fromY + 0.001 && c[4] > best) best = c[4];
  }
  return best;
}

// Nearest free position for a mover pushed out of walls, axis-separated, same order
// the player uses: x, then z, then y. Low obstacles (ramp steps, crates' edges)
// are stepped onto automatically when the lift is under STEP_UP and the head
// clears — bots and players climb stairs without jumping.
const STEP_UP = 0.55;

function stepUp(pos, radius, height, rising) {
  if (rising) return false; // mid-jump: don't snap onto ledges
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    if (pos.x + radius <= c[0] || pos.x - radius >= c[3]) continue;
    if (pos.z + radius <= c[2] || pos.z - radius >= c[5]) continue;
    const lift = c[4] - pos.y;
    if (lift <= 0 || lift > STEP_UP) continue;
    // Headroom above the box top?
    let blockedAbove = false;
    for (let j = 0; j < colliders.length; j += 1) {
      const o = colliders[j];
      if (o[4] <= c[4] + 0.01) continue;
      if (pos.x + radius > o[0] && pos.x - radius < o[3] &&
          pos.z + radius > o[2] && pos.z - radius < o[5] &&
          pos.y + height > o[1]) { blockedAbove = true; break; }
    }
    if (!blockedAbove) {
      pos.y = c[4];
      return true;
    }
  }
  return false;
}

export function moveAABB(pos, delta, radius, height, steps) {
  let hitX = false;
  let hitZ = false;
  let hitGround = false;
  const dt = 1 / steps;
  for (let s = 0; s < steps; s += 1) {
    // X
    pos.x += delta.x * dt;
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (pos.y + height <= c[1] || pos.y >= c[4]) continue;
      if (pos.z + radius <= c[2] || pos.z - radius >= c[5]) continue;
      if (pos.x + radius > c[0] && pos.x - radius < c[3]) {
        // A low box is a step, not a wall: lift onto it and keep moving.
        if (stepUp(pos, radius, height, delta.y > 0.01)) continue;
        pos.x = delta.x > 0 ? c[0] - radius - 0.001 : c[3] + radius + 0.001;
        hitX = true;
      }
    }
    // Z
    pos.z += delta.z * dt;
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (pos.y + height <= c[1] || pos.y >= c[4]) continue;
      if (pos.x + radius <= c[0] || pos.x - radius >= c[3]) continue;
      if (pos.z + radius > c[2] && pos.z - radius < c[5]) {
        if (stepUp(pos, radius, height, delta.y > 0.01)) continue;
        pos.z = delta.z > 0 ? c[2] - radius - 0.001 : c[5] + radius + 0.001;
        hitZ = true;
      }
    }
    // Y (falling or stepping down; rising is only for jumps, handled by callers)
    pos.y += delta.y * dt;
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (pos.x + radius <= c[0] || pos.x - radius >= c[3]) continue;
      if (pos.z + radius <= c[2] || pos.z - radius >= c[5]) continue;
      if (pos.y < c[4] && pos.y + height > c[1]) {
        if (delta.y <= 0) {
          pos.y = c[4];
          hitGround = true;
        } else {
          pos.y = c[1] - height - 0.001;
        }
      } else if (delta.y <= 0 && pos.y === c[4] && pos.y + height > c[1]) {
        // Resting exactly on the top face with no downward motion: still ground.
        // Without this, grounded flickers on elevated floors (deck, steps).
        hitGround = true;
      }
    }
    if (pos.y < 0) {
      pos.y = 0;
      hitGround = true;
    }
  }
  return hitX || hitZ || hitGround;
}

// Hitscan against every collider. Returns the hit t along the ray (or -1), plus the
// face normal written into `normal` (a scratch vector owned by the caller).
export function rayBox(origin, dir, maxT, normal) {
  let bestT = maxT;
  let found = -1;
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    let tmin = 0;
    let tmax = bestT;
    let axis = -1;
    let sign = 0;
    // Slab test per axis.
    for (let a = 0; a < 3; a += 1) {
      const o = a === 0 ? origin.x : a === 1 ? origin.y : origin.z;
      const d = a === 0 ? dir.x : a === 1 ? dir.y : dir.z;
      const lo = c[a];
      const hi = c[a + 3];
      if (d === 0) {
        if (o < lo || o > hi) { tmin = Infinity; break; }
        continue;
      }
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      let s = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) { tmin = Infinity; break; }
    }
    if (tmin !== Infinity && tmin < bestT && tmin >= 0) {
      bestT = tmin;
      found = i;
      if (normal) {
        normal.x = axis === 0 ? sign : 0;
        normal.y = axis === 1 ? sign : 0;
        normal.z = axis === 2 ? sign : 0;
      }
    }
  }
  return found >= 0 ? bestT : -1;
}
