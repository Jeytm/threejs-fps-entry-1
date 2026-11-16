// Synthesized audio, no assets: the WebAudio graph is built once on the first user
// gesture and every sound is an oscillator/noise burst scheduled as it plays. Sounds
// are fire-and-forget; this module owns nothing the simulation reads.
let ctx = null;
let master = null;
let noiseBuffer = null;

export function initAudio() {
  if (ctx) return;
  const Ctx = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctx) return;
  ctx = new Ctx();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const length = ctx.sampleRate * 0.4;
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

// A short filtered noise burst: shots, impacts.
function burst(duration, gain, filterHz, filterQ = 0.8) {
  if (!ctx) return;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterHz;
  filter.Q.value = filterQ;
  const env = ctx.createGain();
  const t = ctx.currentTime;
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + duration);
  source.connect(filter).connect(env).connect(master);
  source.start(t);
  source.stop(t + duration);
}

// A pitched blip: clicks, beeps.
function blip(freq, duration, gain, type = 'square', slideTo = 0) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  const env = ctx.createGain();
  const t = ctx.currentTime;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + duration);
}

export const sounds = {
  shot() {
    burst(0.11, 0.55, 900, 0.5);
    burst(0.05, 0.35, 2600, 0.7);
    blip(140, 0.09, 0.3, 'sawtooth', 60);
  },
  enemyShot() {
    burst(0.1, 0.32, 700, 0.5);
    blip(110, 0.08, 0.18, 'sawtooth', 55);
  },
  hit() {
    blip(1100, 0.05, 0.2, 'square');
  },
  headshot() {
    blip(1500, 0.05, 0.24, 'square');
    blip(2000, 0.07, 0.18, 'square');
  },
  hurt() {
    burst(0.18, 0.4, 300, 0.6);
    blip(90, 0.15, 0.25, 'sawtooth', 50);
  },
  reload() {
    blip(500, 0.04, 0.16, 'square');
    setTimeout(() => blip(380, 0.05, 0.16, 'square'), 1900);
  },
  empty() {
    blip(220, 0.05, 0.18, 'square');
  },
  kill() {
    blip(880, 0.06, 0.2, 'square');
    setTimeout(() => blip(660, 0.08, 0.18, 'square'), 70);
  },
  buy() {
    blip(700, 0.05, 0.18, 'triangle');
    setTimeout(() => blip(1050, 0.06, 0.18, 'triangle'), 60);
  },
  plant() {
    blip(520, 0.07, 0.2, 'triangle', 300);
  },
  beep() {
    blip(1300, 0.05, 0.16, 'square');
  },
  explosion() {
    burst(0.7, 0.85, 160, 0.4);
    burst(0.3, 0.5, 700, 0.5);
  },
  defuseTick() {
    blip(700, 0.04, 0.14, 'triangle');
  },
  win() {
    blip(660, 0.12, 0.2, 'triangle');
    setTimeout(() => blip(880, 0.14, 0.2, 'triangle'), 130);
    setTimeout(() => blip(1320, 0.18, 0.2, 'triangle'), 280);
  },
  lose() {
    blip(440, 0.14, 0.2, 'triangle');
    setTimeout(() => blip(330, 0.16, 0.2, 'triangle'), 150);
    setTimeout(() => blip(220, 0.22, 0.2, 'triangle'), 320);
  },
  roundStart() {
    blip(520, 0.08, 0.16, 'triangle');
    setTimeout(() => blip(780, 0.1, 0.16, 'triangle'), 120);
  },
};
