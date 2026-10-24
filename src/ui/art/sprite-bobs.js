// Planar BOBs for the player, monsters and items, built once from the pixel-art strings.
import { makeBob } from "./room-builder.js";
import { mirrorBob } from "../amiga/blitter.js";
import { PLAYER, MONSTERS, ITEMS } from "./sprites.js";

const cache = new Map();
const memo = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };

function facingOf(f) {
  const s = String(f || "south").toLowerCase();
  if (s.startsWith("n") || s === "up") return "north";
  if (s.startsWith("e") || s === "right") return "east";
  if (s.startsWith("w") || s === "left") return "west";
  return "south";
}

export function playerBob(facing, frame = 0, dark = false) {
  const f = facingOf(facing);
  return memo(`p:${f}:${frame & 1}:${dark}`, () => {
    if (f === "east") return mirrorBob(playerBob("west", frame, dark));
    return makeBob(PLAYER[f][frame & 1], "sprite", dark);
  });
}

// a second frame for single-frame monsters: bob up a pixel and swap the feet
function derive(rows) {
  const up = rows.slice(1).concat([rows[rows.length - 1]]);
  up[rows.length - 2] = rows[rows.length - 2].split("").reverse().join("");
  return up;
}

export function monsterBob(kind, frame = 0, dark = false) {
  const frames = MONSTERS[kind] || MONSTERS.ogre;
  return memo(`m:${kind}:${frame & 1}:${dark}`, () => {
    let rows = frames[frame & 1];
    if (!rows) rows = kind === "door" ? frames[0] : derive(frames[0]);
    return makeBob(rows, "sprite", dark);
  });
}

export function itemBob(id, dark = false) {
  return memo(`i:${id}:${dark}`, () => makeBob(ITEMS[id] || ITEMS.goldbar, "sprite", dark));
}
