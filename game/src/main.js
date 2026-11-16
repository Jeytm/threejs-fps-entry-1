// Boot and the one loop. A fixed 60 Hz simulation (stepWorld) feeds a render at
// the display's rate; the accumulator keeps sim and render decoupled. HUD DOM is
// rebuilt once, then updated from sim state each frame. ?shot=menu|live|end with
// &seed=N stages a deterministic frame, renders it twice, freezes, and sets
// window.__shotReady for the capture harness.
import { createWorld, startMatch, stepWorld, applyPurchase, tryPickupBomb, setSeed } from './game.js';
import * as hud from './hud.js';
import { buildEffects, updateEffects, buildGrenades, updateGrenadeFx } from './combat.js';
import { buildViewmodel, updateViewmodel, setActive, onShotFired } from './viewmodel.js';
import { createInput, bindShopButtons } from './input.js';
import { WEAPONS } from './weapons.js';
import { eyeY, groundSpeed } from './player.js';
import { initAudio, sounds } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

const canvas = document.createElement('canvas');
canvas.id = 'game-canvas';
document.getElementById('game').appendChild(canvas);

const world = createWorld(canvas);
if (shot) setSeed(world, seed);
window.__world = world; // debug/testing hook (shot harness, smoke tests)
window.__stepWorld = stepWorld; // smoke-test hook: run one fixed sim step
buildEffects(world.scene);
buildGrenades(world.scene);
buildViewmodel(world.camera);
hud.buildHud();

// Sim-side event hooks: translate sim happenings into HUD/audio/viewmodel calls.
const hooks = {
  onLive() {
    hud.setObjective('Take site A or B — plant, or wipe Cobalt');
    setTimeout(() => hud.setObjective(''), 4200);
    if (shop.open) closeShop();
  },
  onShot(weapon) {
    onShotFired();
    void weapon;
  },
  onPlayerHit(result) {
    hud.hitMarker(result.part === 'head');
    if (result.part === 'head') sounds.headshot();
    else sounds.hit();
  },
  onPlayerHitTarget(part, dmg, killed) {
    void part;
    void dmg;
    if (killed) sounds.kill();
  },
  onPlayerDamaged(dmg) {
    hud.damageFlash(Math.min(0.65, dmg / 60));
    sounds.hurt();
  },
  onPlayerKill() {},
  onBotShoot() {},
  onKill(killer, victim, part, byPlayer) {
    const head = part === 'head' ? ' <span class="kf-head">HS</span>' : '';
    hud.addKillfeed(`<b>${killer}</b> ▸ ${victim}${head}`);
  },
  onGunChange(gunKey) {
    setActive(gunKey);
  },
  onGrenadeThrown() {
    setActive(world.player.gun);
  },
  onProgress(label, t) {
    if (label) hud.showProgress(label, t);
    else hud.hideProgress();
  },
  onPlanted() {
    hud.setBombBanner(true);
    hud.setObjective('Hold the bomb — stop the defuse');
  },
  onDefused() {
    hud.setBombBanner(false);
  },
  onBombExploded() {
    hud.setBombBanner(false);
  },
  onBombDropped() {
    hud.setObjective('Bomb dropped — walk over it to pick up');
  },
  onRoundEnd(winner, reason) {
    hud.hideProgress();
    hud.setBombBanner(false);
    hud.showOverlay('end', {
      won: winner === 'copper',
      reason,
      copper: world.rounds.copperScore,
      cobalt: world.rounds.cobaltScore,
    });
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onNewRound() {
    hud.hideOverlay();
    showBuy();
  },
  onMatchEnd() {
    hud.showOverlay('match', {
      won: world.rounds.matchWinner === 'copper',
      copper: world.rounds.copperScore,
      cobalt: world.rounds.cobaltScore,
      kills: world.player.kills,
      deaths: world.player.deaths,
    });
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onShopKey() {
    openShop();
  },
};

// Shop: DOM buttons inside the overlay.
const shop = {
  open: false,
};
function openShop() {
  shop.open = true;
  renderShop();
}
function closeShop() {
  shop.open = false;
  hud.hideOverlay();
}
function renderShop() {
  const player = world.player;
  const vandal = WEAPONS.vandal;
  const hasVandal = world.loadout.rifle === 'vandal';
  const hasGrenade = world.loadout.grenades >= 1;
  const rows = [
    ['vandal', vandal.name, vandal.price, hasVandal, player.money >= vandal.price],
    ['grenade', WEAPONS.fusepack.name, WEAPONS.fusepack.price, hasGrenade, player.money >= WEAPONS.fusepack.price && !hasGrenade],
    ['armor', 'Plating', 650, player.armor >= 50, player.money >= 650 && player.armor < 50],
  ];
  const html = `
    <div class="shop">
      <div class="shop-col">
        ${rows.map(([key, name, price, owned, afford]) => `
          <button class="buy-row ${owned ? 'own' : afford ? '' : 'cant'}" data-item="${key}" ${owned || !afford ? 'disabled' : ''}>
            <span class="buy-name">${name}</span>
            <span class="buy-price">${owned ? 'owned' : `$${price}`}</span>
          </button>`).join('')}
      </div>
      <div class="shop-info">
        <h3>Vandal-9</h3>
        <p>DMG ${vandal.damage} · HS ×${vandal.headMult} · MAG ${vandal.magSize}</p>
        <p>A round every ${vandal.fireGap.toFixed(2)}s. Standing still, the cone is hairline; running, it sprays — stop, crouch, then fire.</p>
        <p>The Marrow pistol is free and always yours. The Fusepack lobs and cooks for ${WEAPONS.fusepack.fuseTime.toFixed(1)}s.</p>
        <p class="shop-money">$${Math.round(player.money)}</p>
      </div>
    </div>`;
  hud.showOverlay('buy', { round: world.roundNumber, html });
}
bindShopButtons((item) => {
  if (item === 'close') { closeShop(); return; }
  if (applyPurchase(world, item)) sounds.buy();
  renderShop();
});

// Input.
const input = createInput(canvas, {
  onUnlock() {
    // Pause: show overlay only when a round is actually running and not ended.
    const rounds = world.rounds;
    if (!shot && rounds.phase !== 'end' && rounds.phase !== 'match' && !shop.open) {
      hud.showOverlay('menu', {});
    }
  },
  onLock() {
    initAudio();
    if (!shop.open) hud.hideOverlay();
  },
});

// Click-to-play on the overlay itself.
document.getElementById('overlay').addEventListener('click', () => {
  if (shop.open) return; // shop buttons handle their own clicks
  if (world.rounds.phase === 'match') {
    startMatch(world);
    hud.hideOverlay();
    showBuy();
  } else if (world.rounds.phase === 'buy') {
    if (shop.open) { closeShop(); return; }
    openShop();
  } else {
    canvas.requestPointerLock();
  }
});

function showBuy() {
  shop.open = true;
  renderShop();
}

// HUD refresh, once per rendered frame. Cheap DOM writes only when values
// change (hud.js writes unconditionally but the strings are tiny).
let lastAmmoKey = '';
function refreshHud() {
  const player = world.player;
  const rounds = world.rounds;
  hud.setHealth(player.health, player.armor);
  hud.setMoney(player.money);
  const weapon = WEAPONS[player.gun];
  if (weapon.kind === 'gun') {
    const slot = player.loadout[player.gun];
    const key = `${player.gun}:${slot.mag}:${slot.reserve}`;
    if (key !== lastAmmoKey) {
      lastAmmoKey = key;
      hud.setAmmo(slot.mag, slot.reserve, weapon.name);
    }
  } else {
    const key = `fusepack:${player.grenades}`;
    if (key !== lastAmmoKey) {
      lastAmmoKey = key;
      hud.setAmmo(player.grenades, 0, 'Fusepack');
    }
  }
  hud.setGrenades(player.grenades);
  hud.setScore(rounds.copperScore, rounds.cobaltScore);
  const t = Math.max(0, rounds.phaseTimer);
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60);
  hud.setTimer(`${mm}:${String(ss).padStart(2, '0')}`, rounds.phase === 'live' && t < 15);
  hud.setRoundLabel(`ROUND ${rounds.number} — ${rounds.phase === 'buy' ? 'BUY' : rounds.phase === 'live' ? 'LIVE' : rounds.phase.toUpperCase()}`);
  const spread = weapon.kind === 'gun'
    ? weapon.spreadStill * 2600 + (weapon.spreadMove * Math.min(1, groundSpeed(player) / 5.4) ** 2) * 2600
    : 5;
  hud.setCrosshairSpread(Math.max(3, spread));
}

// Camera follows the player's eye, with recoil + land dip baked into pitch.
function syncCamera() {
  const player = world.player;
  const eye = player.pos.y + eyeY(player);
  world.camera.position.set(player.pos.x, eye, player.pos.z);
  const dip = player.landImpulse * 0.06;
  world.camera.rotation.set(player.pitch + player.recoilPitch - dip, player.yaw + player.recoilYaw, 0, 'YXZ');
}

// --- Fixed-step loop -----------------------------------------------------------
let accumulator = 0;
let lastTime = performance.now();
let frozen = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (frozen) {
    world.renderer.render(world.scene, world.camera);
    return;
  }
  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    stepWorld(world, input, FIXED_STEP, hooks);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (accumulator > FIXED_STEP * 5) accumulator = 0;

  // Render-side cosmetics.
  syncCamera();
  updateEffects(dt);
  updateGrenadeFx(dt);
  updateViewmodel(dt, groundSpeed(world.player), world.player.grounded);
  hud.updateHud(dt);
  refreshHud();
  tryPickupBomb(world); // walk-over pickup (sim-adjacent, idempotent)
  world.renderer.render(world.scene, world.camera);
}

// --- Deterministic shot mode ------------------------------------------------------
function settle(steps) {
  for (let i = 0; i < steps; i += 1) stepWorld(world, stubInput(), FIXED_STEP, hooks);
}

function stubInput() {
  return {
    forward: false, back: false, left: false, right: false,
    jump: false, crouch: false, walkHold: false, firing: false,
    locked: false, dx: 0, dy: 0,
    takeLook() { return [0, 0]; },
    swap: 0, reload: false, use: false, shop: false,
  };
}

function aimAt(point) {
  const player = world.player;
  const dx = point.x - player.pos.x;
  const dy = point.y - (player.pos.y + eyeY(player));
  const dz = point.z - player.pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    world.renderer.render(world.scene, world.camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  startMatch(world);
  // Buy the rifle for the live/end shots so the full kit is visible.
  world.player.money = 5000;
  applyPurchase(world, 'vandal');
  applyPurchase(world, 'grenade');
  if (name === 'menu') {
    hud.showOverlay('menu', {});
    settle(1);
  } else if (name === 'live') {
    // Skip the buy phase, place the player mid-yard facing a bot, let the bots
    // settle into their holds.
    world.rounds.phase = 'live';
    world.rounds.phaseTimer = 90;
    const player = world.player;
    player.pos.x = -4; player.pos.z = -5.5;
    aimAt({ x: 9, y: 1.4, z: 2 });
    settle(120);
    hud.hideOverlay();
  } else if (name === 'end') {
    world.rounds.phase = 'live';
    world.rounds.phaseTimer = 90;
    // Plant the bomb and set the banner for the end-of-round tableau.
    world.bomb.state = 'planted';
    world.bomb.pos.x = 12.5; world.bomb.pos.y = 0; world.bomb.pos.z = -5;
    world.bomb.mesh.position.set(12.5, 0, -5);
    world.bomb.mesh.visible = true;
    world.bomb.timer = 12;
    const player = world.player;
    player.pos.x = 10.5; player.pos.z = -3.5;
    aimAt({ x: 14, y: 1.5, z: -6 });
    hud.setBombBanner(true);
    settle(30);
    hud.hideOverlay();
  }
  refreshHud();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  world.camera.aspect = window.innerWidth / window.innerHeight;
  world.camera.updateProjectionMatrix();
  world.renderer.setSize(window.innerWidth, window.innerHeight);
});

world.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
world.renderer.setSize(window.innerWidth, window.innerHeight);

syncCamera();
if (shot) {
  runShot(shot);
} else {
  startMatch(world);
  showBuy();
  requestAnimationFrame(frame);
}
