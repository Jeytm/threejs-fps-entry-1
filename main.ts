// The entry point: gathers what the judge reads and hands it over as one
// dossier. The game itself is the plain static tree in game/ (browser ES
// modules, three.js via an import map, nothing to build). This program:
//   1. copies game/ and screenshots/ from beside this file into the output
//      directory (/output in the grader; MAKEFUN_OUTPUT_DIR overrides it so
//      the same thing can be run locally),
//   2. writes dossier.json there with buildDossier from vendor/, which reads
//      the copied tree and produces the scored artifact — screenshots first,
//      then the game's sources in import order — under the competition's
//      caps (the scorer's own numbers: 163840 bytes of text, at most 4
//      screenshots of at most 256 KiB each, at most 993 game entries of at
//      most 48 MiB).
// Play the game locally with `node serve.ts`, which serves game/ on
// http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outputDir, { recursive: true });
cpSync(join(rootDir, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(rootDir, 'screenshots'))) {
  cpSync(join(rootDir, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
