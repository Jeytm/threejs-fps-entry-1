// First-person view models: the weapon and hands held low-right of the camera,
// built from boxes with the Copper amber accents. One group per gun type; the
// active one is shown, others hidden. Sway, bob and kick are applied in
// updateViewmodel each render frame — purely cosmetic, the simulation never
// reads this.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS } from './weapons.js';

let group = null;
const models = {};
let active = null;
let muzzleFlash = null;
let flashTimer = 0;
// Animation state (render-side only).
let bobT = 0;
let kick = 0;
let reloadT = 0;
let reloadDur = 0;
let swapT = 0;

const darkMat = new THREE.MeshStandardMaterial({ color: '#2b2f34', roughness: 0.5, metalness: 0.55 });
const steelMat = new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.45, metalness: 0.6 });
const amberMat = new THREE.MeshStandardMaterial({ color: PALETTE.amber, roughness: 0.4, metalness: 0.2, emissive: PALETTE.amber, emissiveIntensity: 0.25 });
const gloveMat = new THREE.MeshStandardMaterial({ color: '#6e4426', roughness: 0.85, metalness: 0.05 });
const flashMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.95, depthWrite: false });

function box(w, h, d, x, y, z, mat, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function buildRifle() {
  const g = new THREE.Group();
  box(0.09, 0.11, 0.62, 0, 0, -0.28, darkMat, g); // receiver
  box(0.05, 0.05, 0.34, 0, 0.01, -0.72, steelMat, g); // barrel
  box(0.06, 0.09, 0.1, 0, 0.01, -0.9, darkMat, g); // muzzle brake
  box(0.07, 0.16, 0.09, 0, -0.12, -0.16, darkMat, g); // grip
  box(0.07, 0.1, 0.26, 0, -0.02, 0.16, darkMat, g); // stock
  box(0.08, 0.05, 0.2, 0, 0.08, -0.2, darkMat, g); // sight rail
  box(0.03, 0.07, 0.03, 0, 0.13, -0.24, amberMat, g); // front post
  box(0.09, 0.14, 0.12, 0.0, -0.1, -0.42, darkMat, g); // magazine
  box(0.04, 0.03, 0.14, 0.055, -0.02, -0.5, amberMat, g); // side accent
  // Gloved hand on the foregrip.
  box(0.075, 0.075, 0.11, -0.005, -0.075, -0.5, gloveMat, g);
  return g;
}

function buildPistol() {
  const g = new THREE.Group();
  box(0.075, 0.1, 0.3, 0, 0, -0.14, darkMat, g);
  box(0.05, 0.05, 0.1, 0, 0.01, -0.32, steelMat, g);
  box(0.07, 0.14, 0.08, 0, -0.1, -0.02, darkMat, g);
  box(0.02, 0.02, 0.02, 0, 0.065, -0.26, amberMat, g);
  box(0.07, 0.07, 0.09, 0, -0.08, -0.1, gloveMat, g);
  return g;
}

function buildGrenade() {
  const g = new THREE.Group();
  const body = box(0.13, 0.16, 0.13, 0, -0.02, -0.3, steelMat, g);
  body.rotation.z = 0.3;
  box(0.05, 0.07, 0.05, 0, 0.06, -0.3, amberMat, g);
  box(0.07, 0.07, 0.09, 0, -0.09, -0.18, gloveMat, g);
  return g;
}

export function buildViewmodel(camera) {
  group = new THREE.Group();
  camera.add(group);
  models.vandal = buildRifle();
  models.marrow = buildPistol();
  models.fusepack = buildGrenade();
  for (const key of Object.keys(models)) {
    models[key].visible = false;
    group.add(models[key]);
  }
  // Muzzle flash: a small crossed plane pair at the barrel tip.
  muzzleFlash = new THREE.Group();
  const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
  const p2 = p1.clone();
  p2.rotation.y = Math.PI / 2;
  muzzleFlash.add(p1, p2);
  muzzleFlash.position.set(0, 0.01, -0.98);
  muzzleFlash.visible = false;
  models.vandal.add(muzzleFlash);
  group.position.set(0.26, -0.28, -0.42);
  group.rotation.y = -0.06;
  setActive('marrow');
}

export function setActive(type) {
  if (active === type) return;
  active = type;
  for (const key of Object.keys(models)) models[key].visible = key === type;
  swapT = 0.28; // lower/raise on swap
}

export function onShotFired() {
  kick = 1;
  flashTimer = 0.055;
  if (muzzleFlash) muzzleFlash.visible = true;
}

export function startReloadAnim(duration) {
  reloadT = duration;
  reloadDur = duration;
}

// Per-render-frame cosmetic update. dt here is the render delta.
export function updateViewmodel(dt, moveSpeed, grounded) {
  if (!group) return;
  kick = Math.max(0, kick - dt * 7);
  if (flashTimer > 0) {
    flashTimer -= dt;
    if (flashTimer <= 0 && muzzleFlash) muzzleFlash.visible = false;
  }
  if (reloadT > 0) reloadT = Math.max(0, reloadT - dt);
  if (swapT > 0) swapT = Math.max(0, swapT - dt);

  // Walk bob, faded by air time and stillness.
  const speed01 = Math.min(1, moveSpeed / 5.2);
  if (grounded) bobT += dt * 10.5 * speed01;
  const bob = Math.sin(bobT) * 0.012 * speed01;
  const bobX = Math.cos(bobT * 0.5) * 0.008 * speed01;

  // Reload dip: rotate down and back mid-reload.
  let reloadDip = 0;
  let reloadRoll = 0;
  if (reloadDur > 0 && reloadT > 0) {
    const phase = 1 - reloadT / reloadDur; // 0..1
    const mid = Math.sin(phase * Math.PI);
    reloadDip = mid * 0.5;
    reloadRoll = mid * 0.45;
  }

  // Swap raise: start lowered, come up.
  const swapLift = swapT > 0 ? (swapT / 0.28) * -0.3 : 0;

  group.position.set(
    0.26 + bobX - kick * 0.02,
    -0.28 + bob - kick * 0.015 + swapLift,
    -0.42 + kick * 0.06,
  );
  group.rotation.x = kick * 0.08 + reloadDip;
  group.rotation.z = -reloadRoll;
  group.rotation.y = -0.06;
}
