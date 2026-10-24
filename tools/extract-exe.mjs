// Extracts game data from the original CASTLE.EXE (IBM BASIC Compiler output).
//
//   data/exe-strings.json  every string literal in the program, in program order
//   data/items.json        the 22 items from the program's DATA statements
//   data/monsters.json     the 10 monsters from the DATA statements, plus the 4 door cells
//
// How the EXE stores things (worked out by disassembling it):
// - String literals live in the data segment as a 2-byte length, a 2-byte pointer to the
//   characters, then the characters. The pointer is the data-segment offset of the text, so a
//   literal is any record whose pointer equals its own file offset + 4 - DS_FILE_BASE.
// - The DATA statements are kept as plain text lines, e.g. `17,"LAMP",6,14,19,65,"HARP",14,8,16`.
//   Items are (room, name, glyph code, row, col); monsters are (room, name, glyph code, row, col,
//   strength). Rows and columns are 1-based screen positions; we store them 0-based.
//   An item whose room is 100 + R is hidden in room R. Its "row" and "col" are then not
//   positions but the CP437 codes of the furniture you must stand next to when you GET it.
//
// Usage: node tools/extract-exe.mjs [original/CASTLE.EXE] [data]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [src = "original/CASTLE.EXE", outDir = "data"] = process.argv.slice(2);
const exe = readFileSync(src);
const DS_FILE_BASE = 0xd930;

// Full CP437, so glyph codes below 0x20 (smileys, card suits) decode too.
const CP437 =
  "\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼" +
  " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂" +
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const cp437 = (bytes) => Array.from(bytes, (b) => CP437[b]).join("");

// --- string literals -------------------------------------------------------------------------
const strings = [];
for (let i = 0; i + 4 <= exe.length; ) {
  const len = exe.readUInt16LE(i);
  const ptr = exe.readUInt16LE(i + 2);
  if (len > 0 && len < 300 && ptr + DS_FILE_BASE === i + 4 && i + 4 + len <= exe.length) {
    strings.push({ offset: i + 4, text: cp437(exe.subarray(i + 4, i + 4 + len)) });
    i += 4 + len;
  } else i++;
}

// --- DATA statements -------------------------------------------------------------------------
const dataText = exe.toString("latin1");
const start = dataText.indexOf('17,"LAMP"');
const end = dataText.indexOf('"FAIRY"', start) + 40;
const fields = [];
for (const line of dataText.slice(start, end).split("\0")) {
  const body = line.replace(/^[^\d"]*/, "");
  for (const m of body.matchAll(/"([^"]*)"|(-?\d+)/g)) fields.push(m[1] ?? Number(m[2]));
  if (body.includes('"FAIRY"')) break;
}

const ITEM_IDS = {
  LAMP: ["lamp", "Lamp"], HARP: ["harp", "Harp"], NECKLACE: ["necklace", "Necklace"],
  BOOK: ["book", "Book"], "MAGIC WAND": ["magic_wand", "Magic Wand"], SWORD: ["sword", "Sword"],
  KEY: ["key", "Key"], "EYE GLASSES": ["glasses", "Eye Glasses"],
  "CRYSTAL BALL": ["crystal_ball", "Crystal Ball"], HELMET: ["helmet", "Helmet"],
  "WINE FLASK": ["wine_flask", "Wine Flask"], "HOLY CROSS": ["holy_cross", "Holy Cross"],
  DIAMOND: ["diamond", "Diamond"], "SILVER BARS": ["silver_bars", "Silver Bars"],
  RUBYS: ["ruby", "Rubys"], "JADE FIGURINE": ["jade_figurine", "Jade Figurine"],
  SCEPTER: ["scepter", "Scepter"], HOURGLASS: ["hourglass", "Hourglass"],
  "LARGE GEM": ["large_gem", "Large Gem"], GOLDBAR: ["goldbar", "Goldbar"],
  "FANCY GOBLET": ["goblet", "Fancy Goblet"], CROWN: ["crown", "Crown"],
};
// The original's score routine counts items 13-22 plus HARP, NECKLACE and HOLY CROSS (13 total).
const TREASURES = new Set(["harp", "necklace", "holy_cross", "diamond", "silver_bars", "ruby",
  "jade_figurine", "scepter", "hourglass", "large_gem", "goldbar", "goblet", "crown"]);

const items = [];
let k = 0;
for (let n = 0; n < 22; n++) {
  const [room, dataName, code, row, col] = fields.slice(k, k + 5);
  k += 5;
  const [id, name] = ITEM_IDS[dataName];
  const words = dataName.split(" ");
  const item = { id, name, dataName, noun: words[words.length - 1], glyph: CP437[code],
    treasure: TREASURES.has(id) };
  if (room >= 100) Object.assign(item, { room: null, row: null, col: null, hiddenIn: room - 100,
    hiddenNear: [...new Set([CP437[row], CP437[col]])] });
  else Object.assign(item, { room, row: row - 1, col: col - 1 });
  items.push(item);
}

const MONSTER_IDS = [
  ["ogre1", "ogre", "Ugly Ogre"], ["ogre2", "ogre", "Ugly Ogre"],
  ["demon1", "demon", "Angry Demon"], ["demon2", "demon", "Angry Demon"],
  ["spider_big", "spider_big", "Big Spider"], ["spider_small", "spider_small", "Small Spider"],
  ["bat", "bat", "Bat"], ["snake", "snake", "Snake"],
  ["vampire", "vampire", "Vampire"], ["fairy", "fairy", "Fairy"],
];
const monsters = [];
for (let n = 0; n < 10; n++) {
  const [room, dataName, code, row, col, strength] = fields.slice(k, k + 6);
  k += 6;
  const [id, kind, name] = MONSTER_IDS[n];
  const words = dataName.split(" ");
  monsters.push({ id, kind, name, dataName, noun: words[words.length - 1], glyph: CP437[code],
    // Monsters 1-8 hunt the player; the vampire and the fairy only block a doorway.
    fights: n < 8, room: room || null, row: room ? row - 1 : null, col: room ? col - 1 : null,
    strength });
}
// The two locked doors are drawn by the program itself (CHR$(8) at fixed spots), not in DATA.
for (const [id, room, row, col] of [["door1", 68, 14, 8], ["door2", 68, 14, 9],
  ["door3", 82, 8, 13], ["door4", 82, 9, 13]])
  monsters.push({ id, kind: "door", name: "Door", dataName: "DOOR", noun: "DOOR", glyph: "◘",
    fights: false, room, row, col, strength: 0 });

mkdirSync(outDir, { recursive: true });
const write = (file, value) => writeFileSync(join(outDir, file), JSON.stringify(value, null, 1) + "\n");
write("exe-strings.json", strings);
write("items.json", items);
write("monsters.json", monsters);
console.log(`wrote ${strings.length} strings, ${items.length} items, ${monsters.length} monsters to ${outDir}/`);
