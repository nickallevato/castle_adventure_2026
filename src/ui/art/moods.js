// Per-area "moods": the 256 AGA color registers, color-cycle ranges, copper effects and procedural
// style for each part of the castle. The register map is documented in src/ui/amiga/palette.js.

import { ramp, hex, lerpRGB, addRGB, mulRGB, scaleRGB, rgb, rOf, gOf, bOf } from "../amiga/palette.js";

// ---- fixed sprite registers 192-255 ----
export const SPRITE_BASE = 192;
const SPRITE_REGS = [
  "#140c1c", // 192 outline
  "#2a2633", "#45414f", "#625e6b", "#857f8c", "#aaa3ad", "#d2ccd0", "#faf6ee", // 193-199 grays
  "#7a4632", "#b5704e", "#e0a27a", "#f6cfa6", // 200-203 skin
  "#5a0f1a", "#9a1f22", "#d8432e", "#ff8a5c", // 204-207 reds
  "#6b4410", "#b07a18", "#e8b834", "#fff0a0", // 208-211 golds
  "#123a1c", "#2b6e2a", "#56a83a", "#a8e070", // 212-215 greens
  "#14204a", "#24489a", "#3f7ad8", "#8fc4ff", // 216-219 blues
  "#3a2214", "#6a4024", "#9a6a3c", "#c89c64", // 220-223 browns
  "#2e1446", "#58248a", "#9050c8", "#d0a0f8", // 224-227 purples
  "#0e3a40", "#1f7a80", "#3cc0c0", "#a8fff0", // 228-231 cyans
  "#6a1a4a", "#b03a7a", "#f070b0", "#ffc0e0", // 232-235 pinks
  "#0f4030", "#1f7a5a", "#3fbf8a", "#9ff0c8", // 236-239 jade
  "#101a3c", "#1e3a7a", "#3466c0", "#78a8f0", // 240-243 player cloak
  "#4a1810", "#8a3418", "#c8642c", "#f0a060", // 244-247 player tunic / leather
  "#ffffff", "#ff4030", "#ffd040", "#40ff80", "#80c0ff", "#ff80ff", "#000000", "#202020", // 248-255 effects
].map(hex);

// ---- character maps for pixel-art strings ----
// Sprites (items, monsters, the player): '.' transparent, '-' soft shadow on the floor.
export const SPRITE_CHARS = {
  K: 192, 1: 193, 2: 194, 3: 195, 4: 196, 5: 197, 6: 198, 7: 199,
  p: 200, P: 201, q: 202, Q: 203, r: 204, R: 205, t: 206, T: 207,
  y: 208, Y: 209, z: 210, Z: 211, g: 212, G: 213, h: 214, H: 215,
  b: 216, B: 217, c: 218, C: 219, n: 220, N: 221, o: 222, O: 223,
  v: 224, V: 225, w: 226, W: 227, x: 228, X: 229, u: 230, U: 231,
  i: 232, I: 233, j: 234, J: 235, e: 236, E: 237, f: 238, F: 239,
  a: 240, A: 241, s: 242, S: 243, d: 244, D: 245, m: 246, M: 247,
};
// Room tiles: ramps sampled at 4 (floor/wall) or 3 levels; uppercase borrows sprite colors.
const fl = (s) => 16 + s, wl = (s) => 32 + s, wd = (s) => 48 + s, aa = (s) => 64 + s, ab = (s) => 80 + s;
export const TILE_CHARS = {
  a: fl(2), b: fl(6), c: fl(10), d: fl(14), e: wl(2), f: wl(6), g: wl(10), h: wl(14), o: wl(15),
  i: wd(3), j: wd(8), k: wd(13), l: aa(3), m: aa(8), n: aa(13), t: ab(3), u: ab(8), v: ab(13), w: ab(15),
  "-": fl(3),
  K: 192, 1: 193, 2: 194, 3: 195, 4: 196, 5: 197, 6: 198, 7: 199, Y: 209, Z: 211, y: 208, R: 205, r: 204,
  G: 213, B: 217, N: 221, O: 223, P: 201,
};
// cycle symbols (both maps): the register within the range depends on the pixel position
export const CYCLE_SYMBOLS = {
  "^": (x, y, h) => 128 + ((h - 1 - y + (x & 1)) & 7), // flames lick upward
  "~": (x, y) => 136 + ((x + y * 2) & 7), // water A ripples
  "=": (x, y) => 144 + ((x * 3 + y) & 7), // water B (spray)
  "%": (x, y) => 152 + ((x * 2 + y * 3) & 7), // magic
  "*": (x, y) => 160 + ((x * 3 + y * 5) & 7), // treasure glint
  ":": (x, y) => 176 + ((x * 5 + y * 3) & 7), // leaves / rainbow / runes
};

// ---- dark-mode remapping: normal register -> 0..63 art register ----
export function darkIndex(i, sprite = false) {
  if (i >= 192) return i;
  if (sprite) {
    if (i >= 128 && i < 136) return 210 + (i & 1); // flame -> pale gold
    if (i >= 152 && i < 160) return 226 + (i & 1); // magic -> purples
    if (i >= 160 && i < 168) return (i & 7) === 3 ? 199 : 210; // glint -> gold/white
  }
  if (i === 0 || i < 16) return 0;
  if (i < 32) return 1 + Math.round(((i - 16) * 14) / 15);
  if (i < 48) return 16 + (i - 32);
  if (i < 64) return 32 + ((i - 48) >> 1);
  if (i < 80) return 40 + ((i - 64) >> 1);
  if (i < 96) return 48 + ((i - 80) >> 1);
  if (i < 112) return 1 + ((i - 96) >> 2) * 4 + 2;
  if (i < 128) return 16 + ((i - 112) >> 2) * 4 + 2;
  if (i < 136) return 15;
  if (i < 152) return 56 + (i & 7);
  if (i < 160) return 56 + (i & 7);
  if (i < 168) return 15;
  return 9;
}

// ---- area definitions ----
const WARM_FLAME = ["#fff8d0", "#ffe070", "#ffb030", "#f07818", "#b83a10", "#f08020", "#ffc040", "#fff0a0"];
const CANDLE_FLAME = ["#fffbe8", "#fff0a0", "#ffd060", "#f0a030", "#d07020", "#f0b040", "#ffe080", "#fff8c0"];
const STARS = ["#202040", "#303058", "#5a5a90", "#fffff0", "#a0a0d0", "#404070", "#282850", "#383868"];

const A = {
  hall: {
    floorStyle: "flag", trim: "stone", sconce: "torch", shafts: 2,
    sky: ["#1a0f2a", "#05040a"],
    floor: ["#120e24", "#2a1f3c", "#4e3646", "#7a5446", "#a8784e", "#d4a868"],
    wall: ["#0a0a1a", "#1c1a34", "#34304e", "#544a66", "#7c6c7c", "#b09a8c"],
    wood: ["#1a0c08", "#3c1e10", "#6a3a1c", "#9a5c2c", "#c88a48"],
    accA: ["#200814", "#4a1020", "#8a2028", "#c8483a", "#f08c5a"],
    accB: ["#1a1828", "#3a3448", "#6a6070", "#a49a9c", "#e0d4c4"],
    torch: "#ff9a3a", shaft: "#8a9ae0", shaftK: 0.3,
    ambient: [1.06, 0.82],
  },
  court: {
    floorStyle: "cobble", trim: "stone", sconce: "torch", stars: true, outdoor: true,
    sky: ["#2a1440", "#c0503a"],
    floor: ["#16122a", "#2e2640", "#4c3e52", "#72605e", "#9c8470", "#c8ac8c"],
    wall: ["#0c0a1c", "#201c36", "#3a3452", "#5c5270", "#887a8c", "#b8a8a8"],
    wood: ["#1a0c08", "#3c1e10", "#6a3a1c", "#9a5c2c", "#c88a48"],
    accA: ["#081408", "#14301a", "#24502a", "#3c7840", "#68a060"],
    accB: ["#1a1828", "#3a3448", "#6a6070", "#a49a9c", "#e0d4c4"],
    torch: "#ff8a30", ambient: [0.9, 1.05],
  },
  throne: {
    floorStyle: "flag", trim: "gold", sconce: "torch", shafts: 2, carpet: true,
    sky: ["#2a0610", "#080104"],
    floor: ["#12060c", "#260c16", "#3c1620", "#58242a", "#7c3c34", "#a86048"],
    wall: ["#12040c", "#2a0a18", "#481828", "#6c3038", "#985248", "#c88060"],
    wood: ["#1a0806", "#3c140c", "#6a2a14", "#9a4a24", "#c87a40"],
    accA: ["#2a0408", "#5a0a12", "#9a1a1a", "#d83a28", "#ff7a48"],
    accB: ["#3a2008", "#7a4a10", "#c08a20", "#f0c848", "#fff4b0"],
    torch: "#ffa040", shaft: "#ffc890", shaftK: 0.28, ambient: [1.05, 0.85],
  },
  garden: {
    floorStyle: "grass", trim: "stone", sconce: null, outdoor: true, dapple: true, leaves: true,
    sky: ["#0a2214", "#02080a"],
    floor: ["#061008", "#0c2412", "#163c18", "#24561c", "#3c7424", "#76a030"],
    wall: ["#1a1410", "#3a2c20", "#5c4630", "#86684a", "#b49268", "#e0c494"],
    wood: ["#1a0c08", "#3c1e10", "#6a3a1c", "#9a5c2c", "#c88a48"],
    accA: ["#04140a", "#0c2e12", "#18501a", "#2c7a20", "#58a82a", "#a0d850"],
    accB: ["#1c2028", "#3a4048", "#646a70", "#9aa0a0", "#d8dcd0"],
    water: ["#0a2a5a", "#1450a0", "#2a80d0", "#60b8f0", "#c0f0ff"],
    leafCols: ["#1c5a16", "#2c7a20", "#58a82a", "#a0d850", "#e0ff90", "#a0d850", "#58a82a", "#2c7a20"],
    dappleCol: "#fff0a0", ambient: [1.1, 0.9],
  },
  upper: {
    floorStyle: "parquet", trim: "wood", sconce: "torch", shafts: 2,
    sky: ["#0c1024", "#020308"],
    floor: ["#120a08", "#2a1610", "#462818", "#643c22", "#8a582e", "#b4824a"],
    wall: ["#0a0c1a", "#181e34", "#2c3450", "#46506c", "#6a748c", "#a0a8b8"],
    wood: ["#140804", "#2e160a", "#4e2a12", "#764422", "#a06838", "#c8945a"],
    accA: ["#100a2a", "#24164a", "#3e2a74", "#5e4aa0", "#9080d0"],
    accB: ["#1a1828", "#3a3448", "#6a6070", "#a49a9c", "#e0d4c4"],
    torch: "#ff9a40", shaft: "#90a8ff", shaftK: 0.3, ambient: [1.05, 0.85],
  },
  bed: {
    floorStyle: "carpet", trim: "wood", sconce: "candle",
    sky: ["#100818", "#020104"],
    floor: ["#06081a", "#101634", "#1c2654", "#2c3c78", "#4a5ca0", "#7a8cc8"],
    wall: ["#1a0e10", "#3a2020", "#5e3a34", "#86584a", "#b07e64", "#d8aa88"],
    wood: ["#140804", "#2e160a", "#4e2a12", "#764422", "#a06838", "#c8945a"],
    accA: ["#1a0a2a", "#3a1450", "#5a2a7a", "#8a4aa8", "#c080d8"],
    accB: ["#3a2008", "#7a4a10", "#c08a20", "#f0c848", "#fff4b0"],
    torch: "#ffb060", flame: CANDLE_FLAME, ambient: [1.0, 0.85],
  },
  dusk: {
    floorStyle: "cobble", trim: "stone", sconce: "torch", stars: true, outdoor: true, horizon: true,
    sky: ["#03041a", "#120e3a", "#4a2050", "#b8502e"],
    floor: ["#080a18", "#141a30", "#222c48", "#36445e", "#506078", "#7a8aa0"],
    wall: ["#04040c", "#0e1224", "#1c2440", "#2e3a5a", "#4a587a", "#7484a4"],
    wood: ["#140804", "#2e160a", "#4e2a12", "#764422", "#a06838"],
    accA: ["#081408", "#14301a", "#24502a", "#3c7840", "#68a060"],
    accB: ["#101420", "#283040", "#485468", "#788498", "#b8c0d0"],
    torch: "#ff8a28", ambient: [0.88, 1.08],
  },
  library: {
    floorStyle: "parquet", trim: "wood", sconce: "candle", shafts: 1,
    sky: ["#140a06", "#020100"],
    floor: ["#0e0806", "#22140c", "#3a2414", "#56381e", "#76502c", "#9a6c3c"],
    wall: ["#0a0608", "#1c1014", "#34201e", "#50342a", "#704c3a", "#9a7050"],
    wood: ["#140804", "#2e160a", "#4e2a12", "#764422", "#a06838", "#c8945a"],
    accA: ["#081408", "#14301a", "#24502a", "#3c7840", "#68a060"],
    accB: ["#3a2008", "#7a4a10", "#c08a20", "#f0c848", "#fff4b0"],
    torch: "#ffb060", flame: CANDLE_FLAME, shaft: "#ffd8a0", shaftK: 0.3, ambient: [1.0, 0.8],
  },
  tower: {
    floorStyle: "flag", trim: "stone", sconce: "torch", runes: true,
    sky: ["#1a0828", "#040108"],
    floor: ["#0c0614", "#1c0e2c", "#301848", "#4a2a64", "#6a4484", "#9a6cac"],
    wall: ["#06040c", "#120c20", "#22183a", "#382a56", "#544074", "#7c6498"],
    wood: ["#140804", "#2e160a", "#4e2a12", "#764422", "#a06838"],
    accA: ["#1a0430", "#3a0a68", "#6a1ad0", "#b060ff", "#f0c0ff"],
    accB: ["#101420", "#283040", "#485468", "#788498", "#b8c0d0"],
    torch: "#ff9a60", magic: ["#2a0a5a", "#6a1ad0", "#b060ff", "#f0c0ff", "#80e0ff", "#b060ff", "#6a1ad0", "#3a0a8a"],
    leafCols: ["#20084a", "#3a10a0", "#7030f0", "#b080ff", "#f0e0ff", "#b080ff", "#7030f0", "#3a10a0"],
    ambient: [1.0, 0.85],
  },
  dungeon: {
    floorStyle: "dirt", trim: "stone", dark: true,
    sky: ["#000000", "#000000"],
    floor: ["#141a18", "#26302a", "#3a463a", "#56604a", "#7a7e5e", "#a8a078"],
    wall: ["#0a1418", "#162630", "#243c44", "#365458", "#506e6c", "#7a948a"],
    wood: ["#1a0e08", "#3a2010", "#603a1c", "#8a5a2c", "#b4844a"],
    accA: ["#0a1a0a", "#1a3a14", "#2e5a1e", "#4a7a2a", "#78a040"],
    accB: ["#101418", "#283038", "#48525a", "#768088", "#b0b8b8"],
    water: ["#06202a", "#0c3a48", "#1a5a68", "#3a8a90", "#9ad8d0"],
    lamp: "#ffd8a0",
  },
  secret: {
    floorStyle: "marble", trim: "gold", sconce: "candle", rainbow: true,
    sky: ["#1a0a28", "#020004"],
    floor: ["#100c18", "#221a30", "#3a2e4a", "#5a4a68", "#86749a", "#c0b0d0"],
    wall: ["#0a0610", "#1a1028", "#302048", "#4a3468", "#6a4c8c", "#9a78b8"],
    wood: ["#140804", "#2e160a", "#4e2a12", "#764422", "#a06838"],
    accA: ["#1a0430", "#3a0a68", "#6a1ad0", "#b060ff", "#f0c0ff"],
    accB: ["#3a2008", "#7a4a10", "#c08a20", "#f0c848", "#fff4b0"],
    torch: "#ffb060", flame: CANDLE_FLAME,
    leafCols: ["#ff3040", "#ff9020", "#ffe030", "#40d040", "#30a0ff", "#6040ff", "#c030ff", "#ff30a0"],
    ambient: [1.0, 0.9],
  },
};

const AREA = {};
const assign = (name, ids) => ids.forEach((id) => (AREA[id] = name));
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
assign("hall", range(2, 13));
assign("court", [1]);
assign("throne", [14, 15, 16]);
assign("garden", [17, 18, 33]);
assign("upper", [...range(19, 24), ...range(27, 32)]);
assign("bed", range(34, 41));
assign("dusk", [25, 26, ...range(42, 51), 60, 61, 64, 65]);
assign("library", range(52, 59));
assign("tower", [62, 63, 66, 67]);
assign("dungeon", range(68, 82));
assign("secret", [83]);

export function areaOf(roomId) { return AREA[roomId] || "hall"; }

// torchlight rings, center -> edge (spatial falloff; the flicker is palette animation per vblank)
const TORCH_RINGS = [1.0, 0.68, 0.42, 0.22];

function lit(base, light, k) {
  // light falling on a surface: brighten by the light's color, plus a little additive glow
  const f = (c, l) => c * (1 + 1.1 * k * (l / 255)) + l * 0.16 * k;
  return rgb(f(rOf(base), rOf(light)), f(gOf(base), gOf(light)), f(bOf(base), bOf(light)));
}

/**
 * Torch flicker: rewrite the pool registers 96-127 for this vblank. Each ring gets its own
 * slightly delayed noise, so the flicker rolls outward from the flame.
 */
export function animateTorch(regs, mood, tick) {
  if (!mood.torchBase) return regs;
  const { floor, wall, torch } = mood.torchBase;
  const n = (t) => Math.sin(t * 0.37) * 0.45 + Math.sin(t * 0.91 + 2.1) * 0.35 + Math.sin(t * 2.3 + 0.7) * 0.2;
  for (let ring = 0; ring < 4; ring++) {
    const g = TORCH_RINGS[ring] * (1 + 0.22 * n(tick - ring * 2.5));
    for (let band = 0; band < 4; band++) {
      regs[96 + band * 4 + ring] = lit(floor[band * 4 + 2], torch, g);
      regs[112 + band * 4 + ring] = lit(wall[band * 4 + 2], torch, g * 0.85);
    }
  }
  return regs;
}

function buildNormal(d) {
  const R = new Array(256).fill(0);
  const sky = ramp(d.sky, 8);
  R[0] = sky[0];
  for (let i = 1; i < 8; i++) R[i] = sky[i];
  STARS.forEach((c, i) => (R[8 + i] = hex(c)));
  const put = (lo, arr) => arr.forEach((c, i) => (R[lo + i] = c));
  const floor = ramp(d.floor, 16), wall = ramp(d.wall, 16);
  put(16, floor); put(32, wall); put(48, ramp(d.wood, 16)); put(64, ramp(d.accA, 16)); put(80, ramp(d.accB, 16));
  const torch = hex(d.torch || "#ff9a3a");
  for (let band = 0; band < 4; band++)
    for (let ring = 0; ring < 4; ring++) {
      R[96 + band * 4 + ring] = lit(floor[band * 4 + 2], torch, TORCH_RINGS[ring]);
      R[112 + band * 4 + ring] = lit(wall[band * 4 + 2], torch, TORCH_RINGS[ring] * 0.85);
    }
  d.torchBase = { floor, wall, torch };
  put(128, (d.flame || WARM_FLAME).map(hex));
  const water = ramp(d.water || ["#0a1a3a", "#1a3a6a", "#3a6aa0", "#7ab0e0", "#c0e8ff"], 5);
  put(136, [water[0], water[1], water[2], water[3], water[4], water[3], water[2], water[1]]);
  put(144, [water[2], water[3], water[4], hex("#ffffff"), water[4], water[3], water[2], water[1]]);
  put(152, (d.magic || ["#3a0a6a", "#7a2ad0", "#c070ff", "#ffd0ff", "#a0f0ff", "#c070ff", "#7a2ad0", "#4a1a90"]).map(hex));
  const gold = SPRITE_REGS[10 + 8 + 1]; // 210-ish gold
  put(160, [SPRITE_REGS[17], SPRITE_REGS[17], SPRITE_REGS[18], hex("#ffffff"), SPRITE_REGS[19], SPRITE_REGS[18], SPRITE_REGS[17], SPRITE_REGS[17]]);
  void gold;
  const shaft = hex(d.shaft || "#a0a0c0"), sk = d.shaftK || 0.35;
  const mid = floor[9];
  const prof = [0.55, 0.7, 0.85, 1.0, 1.25, 0.95, 0.75, 0.6];
  put(168, prof.map((p) => addRGB(mid, shaft, sk * p)));
  put(176, (d.leafCols || ["#1c5a16", "#2c7a20", "#58a82a", "#a0d850", "#e0ff90", "#a0d850", "#58a82a", "#2c7a20"]).map(hex));
  const dap = hex(d.dappleCol || "#fff0a0");
  const prof2 = [0.25, 0.4, 0.55, 0.65, 0.55, 0.4, 0.3, 0.2];
  put(184, prof2.map((p) => addRGB(floor[9], dap, p * 0.5)));
  put(192, SPRITE_REGS);
  return R;
}

// dark rooms: base art colors 0-63, three light levels derived from them every frame
function buildDarkBase(d) {
  const B = new Array(64).fill(0);
  const put = (lo, arr) => arr.forEach((c, i) => (B[lo + i] = c));
  put(1, ramp(d.floor, 15)); put(16, ramp(d.wall, 16)); put(32, ramp(d.wood, 8)); put(40, ramp(d.accA, 8)); put(48, ramp(d.accB, 8));
  const w = ramp(d.water, 5);
  put(56, [w[0], w[1], w[2], w[3], w[4], w[3], w[2], w[1]]);
  return B;
}

/** Light the dark-room art: 0-63 ambient, 64-127 halo edge, 128-191 lamp-lit; gains flicker per frame. */
export function darkLevels(base64, lamp, gains = [0.11, 0.5, 1.0], out = new Array(256).fill(0)) {
  const L = hex(lamp);
  for (let i = 0; i < 64; i++) {
    const c = base64[i];
    out[i] = rgb(rOf(c) * gains[0] * 0.8, gOf(c) * gains[0], bOf(c) * gains[0] * 1.35 + 2);
    out[64 + i] = mulRGB(c, L, gains[1] * 1.05);
    out[128 + i] = mulRGB(c, L, gains[2] * 1.12);
  }
  out[0] = out[64] = out[128] = 0;
  for (let i = 0; i < 64; i++) out[192 + i] = SPRITE_REGS[i];
  return out;
}

function buildCycles(d) {
  if (d.dark) return [{ lo: 56, hi: 63, rate: 4, dir: 1, blend: true }];
  const c = [];
  c.push({ lo: 8, hi: 15, rate: 3, dir: 1 }); // stars
  c.push({ lo: 128, hi: 135, rate: 18, dir: 1 }); // flames
  c.push({ lo: 136, hi: 143, rate: 6, dir: 1, blend: true }); // water A
  c.push({ lo: 144, hi: 151, rate: 12, dir: -1 }); // water B
  c.push({ lo: 152, hi: 159, rate: 8, dir: 1, blend: true }); // magic
  c.push({ lo: 160, hi: 167, rate: 5, dir: 1 }); // glint
  c.push({ lo: 168, hi: 175, rate: 2.5, dir: 1, blend: true }); // shafts / dust
  c.push({ lo: 176, hi: 183, rate: d.rainbow ? 6 : 3, dir: d.rainbow ? -1 : 1, blend: true }); // leaves / rainbow / runes
  c.push({ lo: 184, hi: 191, rate: 2, dir: 1, blend: true }); // dapples
  return c;
}

const cache = new Map();
/** Mood for a room: { name, dark, regs[256], cycles, sky, ambient, floorStyle, ... }. */
export function moodFor(roomId) {
  const name = areaOf(roomId);
  if (cache.has(name)) return cache.get(name);
  const d = A[name];
  const mood = { name, ...d, cycles: buildCycles(d) };
  void addRGB; void mulRGB;
  if (d.dark) {
    mood.base64 = buildDarkBase(d);
    mood.regs = darkLevels(mood.base64, d.lamp);
    mood.mapRegs = darkLevels(mood.base64, d.lamp, [0.75, 0.85, 1.0]);
  } else {
    mood.regs = buildNormal(d);
    mood.torchBase = d.torchBase;
  }
  mood.skyCols = ramp(d.sky, 8);
  cache.set(name, mood);
  return mood;
}

export const AREAS = A;
export { SPRITE_REGS, scaleRGB };
