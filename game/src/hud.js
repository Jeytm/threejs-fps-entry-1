// HUD: a DOM overlay driven by the simulation. Health, armour, ammo, money,
// round timer, score, bomb status, hit markers, damage vignette and the
// round-end / buy overlays all live here as styled DOM — the 3D canvas stays
// clean and the HUD inherits palette colours from index.html CSS.
import { PALETTE } from './palette.js';

let els = null;

const HEART = [
  '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 21s-7.5-4.6-10-9.2C.5 8 2.6 4.5 6.2 4.5c2 0 3.6 1 4.8 2.6h2c1.2-1.6 2.8-2.6 4.8-2.6 3.6 0 5.7 3.5 4.2 7.3C19.5 16.4 12 21 12 21z"/></svg>',
];

export function buildHud() {
  const root = document.getElementById('hud');
  root.innerHTML = `
    <div id="vignette"></div>
    <div id="hitmarker"></div>
    <div id="crosshair"><span class="ch ch-t"></span><span class="ch ch-b"></span><span class="ch ch-l"></span><span class="ch ch-r"></span></div>
    <div id="topbar">
      <div id="score-copper" class="score copper">0</div>
      <div id="round-timer">1:30</div>
      <div id="score-cobalt" class="score cobalt">0</div>
    </div>
    <div id="round-label">ROUND 1</div>
    <div id="bomb-banner">BOMB PLANTED</div>
    <div id="objective-banner"></div>
    <div id="progress-wrap"><div id="progress-label"></div><div id="progress-bar"><div id="progress-fill"></div></div></div>
    <div id="bottombar">
      <div id="health-box">
        <span class="hud-icon">${HEART[0]}</span>
        <span id="health-num">100</span>
        <span id="armor-num"></span>
      </div>
      <div id="money-num">$800</div>
      <div id="ammo-box">
        <span id="ammo-mag">12</span>
        <span id="ammo-reserve">/ 36</span>
        <span id="ammo-name">Marrow</span>
      </div>
    </div>
    <div id="grenade-note"></div>
    <div id="killfeed"></div>
    <div id="overlay">
      <div id="overlay-card">
        <h1 id="overlay-title">CINDERFALL</h1>
        <p id="overlay-sub">Foundry yard — plant or hold</p>
        <div id="overlay-body"></div>
        <p id="overlay-go">Click to deploy</p>
      </div>
    </div>
  `;
  els = {
    root,
    vignette: document.getElementById('vignette'),
    hitmarker: document.getElementById('hitmarker'),
    crosshair: document.getElementById('crosshair'),
    scoreCopper: document.getElementById('score-copper'),
    scoreCobalt: document.getElementById('score-cobalt'),
    roundTimer: document.getElementById('round-timer'),
    roundLabel: document.getElementById('round-label'),
    bombBanner: document.getElementById('bomb-banner'),
    objectiveBanner: document.getElementById('objective-banner'),
    progressWrap: document.getElementById('progress-wrap'),
    progressLabel: document.getElementById('progress-label'),
    progressFill: document.getElementById('progress-fill'),
    healthNum: document.getElementById('health-num'),
    armorNum: document.getElementById('armor-num'),
    moneyNum: document.getElementById('money-num'),
    ammoMag: document.getElementById('ammo-mag'),
    ammoReserve: document.getElementById('ammo-reserve'),
    ammoName: document.getElementById('ammo-name'),
    grenadeNote: document.getElementById('grenade-note'),
    killfeed: document.getElementById('killfeed'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlaySub: document.getElementById('overlay-sub'),
    overlayBody: document.getElementById('overlay-body'),
    overlayGo: document.getElementById('overlay-go'),
  };
}

let vignetteLevel = 0;
let hitmarkerTimer = 0;
let crosshairSpread = 1;

export function setHealth(hp, armor) {
  els.healthNum.textContent = String(Math.max(0, Math.round(hp)));
  els.healthNum.style.color = hp < 35 ? '#ff6a5a' : '';
  els.armorNum.textContent = armor > 0 ? `+${Math.round(armor)}` : '';
}

export function setMoney(v) {
  els.moneyNum.textContent = `$${Math.round(v)}`;
}

export function setAmmo(mag, reserve, name) {
  els.ammoMag.textContent = String(mag);
  els.ammoReserve.textContent = `/ ${reserve}`;
  els.ammoName.textContent = name;
  els.ammoMag.style.color = mag === 0 ? '#ff6a5a' : '';
}

export function setGrenades(n) {
  els.grenadeNote.textContent = n > 0 ? `fusepack ×${n}` : '';
}

export function setScore(copper, cobalt) {
  els.scoreCopper.textContent = String(copper);
  els.scoreCobalt.textContent = String(cobalt);
}

export function setRoundLabel(text) {
  els.roundLabel.textContent = text;
}

export function setTimer(text, urgent) {
  els.roundTimer.textContent = text;
  els.roundTimer.style.color = urgent ? '#ff6a5a' : '';
}

export function setBombBanner(visible, defusing = false) {
  els.bombBanner.style.display = visible ? 'block' : 'none';
  els.bombBanner.textContent = defusing ? 'DEFUSING…' : 'BOMB PLANTED';
}

export function setObjective(text) {
  els.objectiveBanner.textContent = text;
  els.objectiveBanner.style.opacity = text ? '1' : '0';
}

export function showProgress(label, t) {
  els.progressWrap.style.display = 'block';
  els.progressLabel.textContent = label;
  els.progressFill.style.width = `${Math.round(t * 100)}%`;
}

export function hideProgress() {
  els.progressWrap.style.display = 'none';
}

export function hitMarker(headshot) {
  hitmarkerTimer = 0.16;
  els.hitmarker.style.color = headshot ? '#ff5a4a' : PALETTE.ink;
  els.hitmarker.style.opacity = '1';
  els.hitmarker.style.transform = 'translate(-50%, -50%) scale(1.1)';
}

export function addKillfeed(text) {
  const row = document.createElement('div');
  row.className = 'killfeed-row';
  row.innerHTML = text; // caller markup (HS tag); content is sim-authored
  els.killfeed.appendChild(row);
  while (els.killfeed.children.length > 4) els.killfeed.firstChild.remove();
  setTimeout(() => row.remove(), 4200);
}

export function damageFlash(strength) {
  vignetteLevel = Math.min(1, vignetteLevel + strength);
}

export function setCrosshairSpread(px) {
  crosshairSpread = px;
}

// Per-render-frame fadeouts (cosmetic timers live here, not in the sim).
export function updateHud(dt) {
  if (vignetteLevel > 0) {
    vignetteLevel = Math.max(0, vignetteLevel - dt * 1.6);
    els.vignette.style.opacity = String(vignetteLevel * 0.85);
  }
  if (hitmarkerTimer > 0) {
    hitmarkerTimer -= dt;
    const t = Math.max(0, hitmarkerTimer / 0.16);
    els.hitmarker.style.opacity = String(t);
    els.hitmarker.style.transform = `translate(-50%, -50%) scale(${0.8 + t * 0.3})`;
  }
  const spread = Math.round(crosshairSpread);
  els.crosshair.style.setProperty('--gap', `${spread}px`);
}

// Overlay: full-screen card. Modes: 'menu' | 'buy' | 'end' | 'match'.
export function showOverlay(mode, data) {
  els.overlay.style.display = 'flex';
  if (mode === 'menu') {
    els.overlayTitle.textContent = 'CINDERFALL';
    els.overlaySub.textContent = 'Foundry yard — attack or hold';
    els.overlayBody.innerHTML = menuBody();
    els.overlayGo.textContent = 'Click to deploy';
  } else if (mode === 'buy') {
    els.overlayTitle.textContent = `ROUND ${data.round}`;
    els.overlaySub.textContent = 'Buy phase — spend before the horn';
    els.overlayBody.innerHTML = data.html;
    els.overlayGo.textContent = 'Click to close';
  } else if (mode === 'end') {
    els.overlayTitle.textContent = data.won ? 'ROUND WON' : 'ROUND LOST';
    els.overlayTitle.style.color = data.won ? PALETTE.amber : '#ff6a5a';
    els.overlaySub.textContent = data.reason;
    els.overlayBody.innerHTML = `<div class="end-score"><span class="copper">${data.copper}</span> — <span class="cobalt">${data.cobalt}</span></div>`;
    els.overlayGo.textContent = 'Next round…';
  } else if (mode === 'match') {
    els.overlayTitle.textContent = data.won ? 'MATCH WON' : 'MATCH LOST';
    els.overlayTitle.style.color = data.won ? PALETTE.amber : '#ff6a5a';
    els.overlaySub.textContent = 'Foundry settled';
    els.overlayBody.innerHTML = `<div class="end-score"><span class="copper">${data.copper}</span> — <span class="cobalt">${data.cobalt}</span></div>
      <p class="end-note">${data.kills} kills · ${data.deaths} deaths</p>
      <p class="end-note">Click to play again</p>`;
    els.overlayGo.textContent = '';
  }
}

function menuBody() {
  return `
    <div class="menu-cols">
      <div class="menu-col">
        <h3>Mission</h3>
        <p>You run Copper. Carry the bomb to site A or B, plant it, and hold for the fuse — or wipe the Cobalt squad.</p>
        <p>Cobalt wins if you die, the clock runs out, or they defuse.</p>
      </div>
      <div class="menu-col">
        <h3>Controls</h3>
        <p>WASD move · Shift walk-hold · Ctrl crouch · Space jump<br>
        Mouse fire · R reload · 1 rifle · 2 pistol · 3 fusepack (throw) · E plant/defuse · B shop (buy phase) · Tab scoreboard</p>
      </div>
      <div class="menu-col">
        <h3>Gunplay</h3>
        <p>Headshots pay ×2.5. Moving fire sprays wide — stop, then squeeze. Crouch to tighten the cone. Recoil climbs; it settles when you breathe.</p>
      </div>
    </div>
  `;
}

export function hideOverlay() {
  els.overlay.style.display = 'none';
}

export function overlayVisible() {
  return els.overlay.style.display === 'flex';
}

export function setOverlayGo(text) {
  els.overlayGo.textContent = text;
}
