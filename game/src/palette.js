// The look plan, in one place. A dusk-industrial palette: cool slate light, warm rust
// surfaces, one amber accent for the Copper side and one cobalt accent for the enemy.
// Every material and light in the game picks from these names; the same names are the
// CSS custom properties in index.html, so the HUD and the world share one palette.
export const PALETTE = {
  sky: '#232c36', // fog and clear colour: deep dusk blue
  ground: '#3b4147', // worn asphalt
  wall: '#4d545c', // concrete panels
  metal: '#5a626b', // unpainted steel
  rust: '#8a4a2e', // painted container rust
  amber: '#e8a33d', // Copper accent: lights, HUD, friendly tracers
  cobalt: '#4f8fb5', // Cobalt accent: enemy visors, markers
  ink: '#e8e4da', // bright neutral: highlights, key light
};

// A material spec per name, so the world builds them once and shares them.
export const FINISH = {
  ground: { roughness: 0.96, metalness: 0.02 },
  wall: { roughness: 0.92, metalness: 0.03 },
  metal: { roughness: 0.55, metalness: 0.45 },
  rust: { roughness: 0.82, metalness: 0.12 },
  amber: { roughness: 0.45, metalness: 0.2 },
  cobalt: { roughness: 0.45, metalness: 0.2 },
  ink: { roughness: 0.6, metalness: 0.25 },
};
