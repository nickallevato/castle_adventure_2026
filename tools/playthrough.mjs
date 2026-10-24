// Plays the scripted walkthrough from the engine tests and prints how it went.
// Usage: node tools/playthrough.mjs [seed] [-v]
import { playThrough } from "../test/engine/helpers/walkthrough.mjs";

const seed = Number(process.argv.find((a, i) => i > 1 && /^\d+$/.test(a)) ?? 7);
const started = Date.now();
const { state, player } = playThrough({ seed, log: process.argv.includes("-v") });
console.log(`seed ${seed}: ${state.status}, score ${state.score}, treasures ${state.treasuresFound}/` +
  `${state.treasuresTotal}, ${player.actions} actions, strength ${state.player.strength}, ` +
  `${Date.now() - started} ms`);
