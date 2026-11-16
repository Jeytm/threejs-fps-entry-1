// Fixed-point vector helpers: a pool that hands out object slots so hot loops never
// allocate. Slot i is safe until slot i+1 is taken, so a call site reads what it took
// before taking another slot.
const pool = [];
let next = 0;

export function scratch(x = 0, y = 0, z = 0) {
  if (next === pool.length) pool.push({ x, y, z });
  else {
    const slot = pool[next];
    slot.x = x;
    slot.y = y;
    slot.z = z;
  }
  next += 1;
  return pool[next - 1];
}

export function release(count) {
  next -= count;
}

export function scratchDepth() {
  return next;
}

export function resetScratch() {
  next = 0;
}
