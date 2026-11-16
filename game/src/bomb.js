// The bomb: one device, carried by the Copper attack side, planted at a site,
// then ticking on a 35 s fuse that defenders (Cobalt bots) try to defuse. Owns
// the 3D device mesh and the beeping that accelerates as detonation nears.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { MAP } from './map.js';
import { sounds } from './audio.js';

export const BOMB_FUSE = 35;
export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 5;

export function createBomb(scene) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#2e3338', roughness: 0.45, metalness: 0.55 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.3), bodyMat);
  body.position.y = 0.08;
  body.castShadow = true;
  g.add(body);
  const lightMat = new THREE.MeshStandardMaterial({ color: '#882222', emissive: '#ff3826', emissiveIntensity: 1.6 });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.09), lightMat);
  lamp.position.set(0, 0.19, 0);
  g.add(lamp);
  g.visible = false;
  scene.add(g);
  return {
    mesh: g,
    lampMat: lightMat,
    scene,
    state: 'carried', // carried | planted | defused | exploded
    pos: { x: 0, y: 0, z: 0 },
    site: null,
    timer: 0,
    beepTimer: 0,
    // Carried by whom (player index or bot ref).
    carrier: null,
  };
}

export function resetBomb(bomb) {
  bomb.state = 'carried';
  bomb.mesh.visible = false;
  bomb.site = null;
  bomb.timer = 0;
  bomb.beepTimer = 0;
  bomb.carrier = null;
}

export function plantBomb(bomb, x, z, planter) {
  bomb.state = 'planted';
  bomb.pos.x = x;
  bomb.pos.y = 0;
  bomb.pos.z = z;
  bomb.timer = BOMB_FUSE;
  bomb.beepTimer = 0;
  bomb.carrier = planter;
  bomb.mesh.position.set(x, 0, z);
  bomb.mesh.visible = true;
  sounds.plant();
}

export function defuseBomb(bomb) {
  bomb.state = 'defused';
  bomb.mesh.visible = false;
}

export function detonateBomb(bomb) {
  bomb.state = 'exploded';
  bomb.mesh.visible = false;
}

// Which site (if any) is the position standing in?
export function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = MAP.plantSites[key];
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz < s.r * s.r) return key;
  }
  return null;
}

// Fixed-tick update: fuse countdown, accelerating beeps, lamp pulse.
export function stepBomb(bomb, dt, events) {
  if (bomb.state !== 'planted') return;
  bomb.timer -= dt;
  if (bomb.timer <= 0) {
    detonateBomb(bomb);
    events.onBombExploded?.();
    return;
  }
  // Beep faster as time runs out; the lamp blinks with the beep.
  const urgency = bomb.timer < 10 ? 0.24 : bomb.timer < 20 ? 0.5 : 0.85;
  bomb.beepTimer -= dt;
  if (bomb.beepTimer <= 0) {
    bomb.beepTimer = urgency;
    sounds.beep();
    bomb.lampMat.emissiveIntensity = 3;
  }
  bomb.lampMat.emissiveIntensity = Math.max(0.8, bomb.lampMat.emissiveIntensity - dt * 6);
}
