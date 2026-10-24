// Extracts room data from the original CASTLE.RAN into data/rooms.json.
//
// CASTLE.RAN layout: 83 room records, 575 bytes each, back to back, in CP437.
//   432 bytes  map, 18 rows x 24 columns
//   120 bytes  description, wrapped at 24 columns by the original
//    23 bytes  exits, e.g. "N7S2E5W4" or "S43W45U49D25"
// What follows the last room is the high-score record and is ignored.
//
// Usage: node tools/extract-rooms.mjs [original/CASTLE.RAN] [data/rooms.json]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ROOM_COUNT = 83;
const RECORD = 575;
const ROWS = 18;
const COLS = 24;

// The CP437 bytes above 0x7F that appear in the file.
const CP437 = {
  0xb0: "░", 0xb1: "▒", 0xb2: "▓", 0xb3: "│", 0xb4: "┤", 0xbf: "┐", 0xc0: "└",
  0xc3: "├", 0xc4: "─", 0xcd: "═", 0xd9: "┘", 0xda: "┌", 0xdb: "█", 0xe0: "α",
  0xe2: "Γ", 0xf7: "≈",
};

function decode(bytes) {
  let out = "";
  for (const b of bytes) {
    if (b === 0) out += " ";
    else if (b < 0x80) out += String.fromCharCode(b);
    else if (CP437[b]) out += CP437[b];
    else throw new Error(`unmapped CP437 byte 0x${b.toString(16)}`);
  }
  return out;
}

const DIRS = { N: "north", S: "south", E: "east", W: "west", U: "up", D: "down" };

function parseExits(text) {
  const exits = {};
  for (const [, d, n] of text.matchAll(/([NSEWUD])(\d+)/g)) exits[DIRS[d]] = Number(n);
  return exits;
}

const [src = "original/CASTLE.RAN", dest = "data/rooms.json"] = process.argv.slice(2);
const buf = readFileSync(src);

const rooms = [];
for (let i = 0; i < ROOM_COUNT; i++) {
  const rec = decode(buf.subarray(i * RECORD, (i + 1) * RECORD));
  const map = [];
  for (let r = 0; r < ROWS; r++) map.push(rec.slice(r * COLS, (r + 1) * COLS));
  const description = rec.slice(ROWS * COLS, ROWS * COLS + 120).replace(/\s+/g, " ").trim();
  const exits = parseExits(rec.slice(552, 575));
  rooms.push({ id: i + 1, map, description, exits });
}

mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(rooms, null, 1) + "\n");
console.log(`wrote ${rooms.length} rooms to ${dest}`);
