// Builds a room's 288x216 playfield as 8 bitplanes: a procedural chunky pass (floors, walls, wood,
// beds, water, trims, ambient occlusion, torchlight pools, light shafts, stars) converted to planes
// (c2p), then hand-drawn tile BOBs and wall sconces blitted on top with masks.

import { createPlanes } from "../amiga/bitplanes.js";
import { blit } from "../amiga/blitter.js";
import { planarFromIndices } from "../amiga/bitplanes.js";
import { moodFor, TILE_CHARS, SPRITE_CHARS, CYCLE_SYMBOLS, darkIndex } from "./moods.js";
import { TILES } from "./tiles.js";

export const TILE = 12, COLS = 24, ROWS = 18, PW = COLS * TILE, PH = ROWS * TILE;

// ---------- noise ----------
export function hash(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, scale, s) {
  const gx = x / scale, gy = y / scale;
  const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const B8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
export const bayer = (x, y) => (B8[(y & 7) * 8 + (x & 7)] + 0.5) / 64;

// ---------- tile classes ----------
const WALLS = new Set(["wall", "wall_color1", "wall_color2"]);
const BEDS = new Set(["bed_left", "bed_right", "bed_top", "bed_bottom", "bed_white", "bed_red", "bed_blue", "bed_purple", "bed_yellow"]);
const TRIMS = new Set(["line_h", "line_v", "corner_tl", "corner_tr", "corner_bl", "corner_br"]);
const SOLID = new Set([...WALLS, "wood", "gray", ...BEDS, "stone", "statue", "fountain", "desk"]);
const KNOWN = new Set(["floor", ...WALLS, "gate", "stairs_up", "stairs_down", "bush_small", "bush_big", "stone", "wood", ...TRIMS,
  "railing", "statue", "fountain", "water", "chain", "gray", ...BEDS, "letter_k", "letter_b"]);
const TRIM_LINKS = { line_h: "we", line_v: "ns", corner_tl: "es", corner_tr: "ws", corner_bl: "en", corner_br: "wn" };
const BED_COLORS = { bed_white: [195, 197, 198, 199], bed_red: [204, 205, 206, 207], bed_blue: [216, 217, 218, 219],
  bed_purple: [224, 225, 226, 227], bed_yellow: [208, 209, 210, 211] };

// ---------- BOBs ----------
const bobCache = new Map();
/** Build a planar BOB from pixel-art rows. kind: "tile" | "sprite". */
export function makeBob(rows, kind = "sprite", dark = false, key = null) {
  const ck = key && `${key}:${kind}:${dark}`;
  if (ck && bobCache.has(ck)) return bobCache.get(ck);
  const map = kind === "tile" ? TILE_CHARS : SPRITE_CHARS;
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const idx = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      let v;
      if (ch === undefined || ch === ".") continue;
      if (CYCLE_SYMBOLS[ch]) v = CYCLE_SYMBOLS[ch](x, y, h);
      else if (ch === "-") v = 19;
      else v = map[ch] ?? TILE_CHARS[ch];
      if (v === undefined) continue;
      idx[y * w + x] = dark ? darkIndex(v, kind === "sprite") : v;
    }
  const bob = planarFromIndices(w, h, idx, 8);
  if (ck) bobCache.set(ck, bob);
  return bob;
}

// ---------- the builder ----------
export function buildRoom(roomId, grid, opts = {}) {
  const mood = moodFor(roomId);
  const dark = !!mood.dark;
  const seed = roomId * 7919;
  const T = (r, c) => (r < 0 || r >= ROWS || c < 0 || c >= COLS ? null : normalize(grid[r][c]));
  const cells = [];
  for (let r = 0; r < ROWS; r++) { cells.push([]); for (let c = 0; c < COLS; c++) cells[r].push(T(r, c)); }
  const at = (r, c) => (r < 0 || r >= ROWS || c < 0 || c >= COLS ? null : cells[r][c]);

  // composites: fountain/statue with a trim frame, and trim rectangles enclosing floor (a desk)
  const consumed = new Set();
  const composites = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = cells[r][c];
    if (t === "fountain" || t === "statue") {
      composites.push({ kind: t, r, c });
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (TRIMS.has(at(r + dr, c + dc))) consumed.add((r + dr) * COLS + c + dc);
    }
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (cells[r][c] !== "corner_tl" || consumed.has(r * COLS + c)) continue;
    let c2 = c + 1; while (at(r, c2) === "line_h") c2++;
    let r2 = r + 1; while (at(r2, c) === "line_v") r2++;
    if (at(r, c2) !== "corner_tr" || at(r2, c) !== "corner_bl" || at(r2, c2) !== "corner_br") continue;
    let enclosed = true;
    for (let rr = r + 1; rr < r2; rr++) for (let cc = c + 1; cc < c2; cc++) if (cells[rr][cc] !== "floor") enclosed = false;
    if (!enclosed) continue;
    for (let rr = r; rr <= r2; rr++) for (let cc = c; cc <= c2; cc++) cells[rr][cc] = "desk";
  }

  // inside vs. outside: count, for each floor cell, how many of the 4 directions run into something.
  // Then each connected floor region is inside when most of its cells are boxed in (3+ hits).
  const hitsAt = new Uint8Array(ROWS * COLS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (cells[r][c] !== "floor") continue;
    // low bits: number of directions blocked; bits 4/5: up/down blocked; bits 6/7: left/right
    let hits = 0, mask = 0;
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dr, dc], di) => {
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) {
        if (cells[rr][cc] !== "floor") { hits++; mask |= 16 << di; break; }
        rr += dr; cc += dc;
      }
    });
    hitsAt[r * COLS + c] = hits | mask;
  }
  const inside = new Uint8Array(ROWS * COLS);
  const seen = new Uint8Array(ROWS * COLS);
  for (let i = 0; i < ROWS * COLS; i++) {
    const r0 = (i / COLS) | 0, c0 = i % COLS;
    if (cells[r0][c0] !== "floor") { inside[i] = 1; continue; }
    if (seen[i]) continue;
    const comp = [i], q = [i];
    seen[i] = 1;
    while (q.length) {
      const j = q.pop(), r = (j / COLS) | 0, c = j % COLS;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
        const k = rr * COLS + cc;
        if (seen[k] || cells[rr][cc] !== "floor") continue;
        seen[k] = 1; comp.push(k); q.push(k);
      }
    }
    const boxed = comp.filter((k) => (hitsAt[k] & 15) >= 3 || (hitsAt[k] & 48) === 48 || (hitsAt[k] & 192) === 192).length;
    const isIn = boxed >= comp.length * 0.5 ? 1 : 0;
    for (const k of comp) inside[k] = isIn;
  }
  const isVoid = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS && cells[r][c] === "floor" && !inside[r * COLS + c];
  const group = (t) => (WALLS.has(t) ? "wall" : BEDS.has(t) ? "bed" : t === "desk" ? "wood" : t);

  const buf = new Int16Array(PW * PH);
  const kind = new Uint8Array(PW * PH); // 0 void, 1 floor, 2 wall, 3 other (furniture / water)
  const floorStyle = mood.floorStyle;
  const furniture = [11, 58, 59].includes(roomId) ? "shelves" : roomId === 68 ? "barrels" : "planks";

  // ---- pass 1: base surfaces ----
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = cells[r][c];
    const g = group(t);
    const open = (dr, dc) => {
      const n = at(r + dr, c + dc);
      if (n === null) return false; // off-room: treat walls as continuing
      return group(n) !== g;
    };
    const oN = open(-1, 0), oS = open(1, 0), oW = open(0, -1), oE = open(0, 1);
    for (let ly = 0; ly < TILE; ly++) for (let lx = 0; lx < TILE; lx++) {
      const x = c * TILE + lx, y = r * TILE + ly, i = y * PW + x;
      if (g === "wall") {
        buf[i] = wallPixel(t, x, y, lx, ly, oN, oS, oW, oE, seed); kind[i] = 2;
      } else if (g === "wood" && furniture === "barrels" && t === "wood") {
        const v = barrelPixel(lx, ly, x, y, seed);
        buf[i] = v < 0 ? 16 + Math.max(0, floorShade(floorStyle, x, y, seed) + v) : v; kind[i] = v < 0 ? 1 : 3;
      } else if (g === "wood" && furniture === "shelves" && t === "wood") {
        buf[i] = shelfPixel(x, y, lx, ly, oN, oS, oW, oE, seed); kind[i] = 3;
      } else if (g === "wood" || g === "gray") {
        buf[i] = blockPixel(g, x, y, lx, ly, oN, oS, oW, oE, seed, mood.carpet); kind[i] = 3;
      } else if (g === "bed") {
        buf[i] = bedPixel(t, cells, r, c, x, y, lx, ly, oN, oS, oW, oE); kind[i] = 3;
      } else if (t === "water") {
        buf[i] = 136 + ((x + y * 2 + ((Math.sin(y * 0.7 + x * 0.2) * 2) | 0)) & 7);
        if ((oN && ly === 0) || (oW && lx === 0)) buf[i] = 80 + 4;
        kind[i] = 3;
      } else if (isVoid(r, c)) {
        buf[i] = voidPixel(mood, x, y, seed); kind[i] = 0;
      } else {
        buf[i] = 16 + floorShade(floorStyle, x, y, seed); kind[i] = 1;
        if (floorStyle === "dirt" && vnoise(x, y, 16, seed + 5) > 0.85) { buf[i] = 136 + (((x >> 1) + ((y * 3) & 7)) & 7); kind[i] = 3; }
      }
    }
  }

  // ---- pass 2: trims (rails, frames) ----
  const trimRamp = mood.trim === "wood" ? 48 : 80;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = cells[r][c];
    if (!TRIMS.has(t) || consumed.has(r * COLS + c)) continue;
    const links = TRIM_LINKS[t];
    for (let ly = 0; ly < TILE; ly++) for (let lx = 0; lx < TILE; lx++) {
      const x = c * TILE + lx, y = r * TILE + ly, i = y * PW + x;
      const inH = ly >= 4 && ly <= 7 && ((links.includes("w") && lx <= 7) || (links.includes("e") && lx >= 4));
      const inV = lx >= 4 && lx <= 7 && ((links.includes("n") && ly <= 7) || (links.includes("s") && ly >= 4));
      if (inH || inV) {
        const across = inV && !(inH && (ly === 4 || ly === 7)) ? lx - 4 : ly - 4;
        const shade = [13, 10, 7, 3][across] + (hash(x, y, seed) < 0.2 ? -1 : 0);
        buf[i] = trimRamp + Math.max(0, shade); kind[i] = 3;
      } else if ((inShadow(links, lx, ly)) && kind[i] === 1) {
        buf[i] = Math.max(16, buf[i] - 4);
      }
    }
  }

  // ---- pass 3: composites ----
  for (const comp of composites) {
    const cx = comp.c * TILE + 6, cy = comp.r * TILE + 6;
    for (let y = cy - 19; y <= cy + 20; y++) for (let x = cx - 19; x <= cx + 20; x++) {
      if (x < 0 || y < 0 || x >= PW || y >= PH) continue;
      const i = y * PW + x, dx = x - cx + 0.5, dy = y - cy + 0.5, d = Math.hypot(dx, dy);
      if (comp.kind === "fountain") {
        if (d < 15) { buf[i] = 136 + ((-Math.floor(d / 2.2)) & 7); kind[i] = 3; }
        else if (d < 18) {
          const lightA = Math.cos(Math.atan2(dy, dx) + Math.PI * 0.75);
          const rim = d < 16 ? 4 : d > 17.2 ? 3 : 9;
          buf[i] = 80 + Math.max(1, Math.min(15, Math.round(rim + lightA * 4))); kind[i] = 3;
        } else if (d < 20 && kind[i] === 1) buf[i] = Math.max(16, buf[i] - 5);
      } else {
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        if (m < 17) {
          const step = m > 14 ? 4 : m > 11 ? 8 : 11;
          const lightA = (dx < 0 && Math.abs(dx) >= Math.abs(dy)) || (dy < 0 && Math.abs(dy) > Math.abs(dx)) ? 2 : -1;
          buf[i] = 80 + Math.max(1, Math.min(15, step + lightA + (hash(x, y, seed) < 0.15 ? -1 : 0))); kind[i] = 3;
        } else if (m < 19 && kind[i] === 1 && (dy > 0 || dx > 0)) buf[i] = Math.max(16, buf[i] - 5);
      }
    }
  }

  // ---- pass 4: throne-room carpet ----
  if (mood.carpet) {
    let tc = -1, tr = -1;
    for (let r = 0; r < ROWS && tc < 0; r++) for (let c = 0; c < COLS - 3; c++) if (cells[r][c] === "gray" && cells[r][c + 3] === "gray") { tc = c + 1; tr = r; break; }
    if (tc >= 0) {
      for (let y = (tr + 2) * TILE; y < PH; y++) for (let x = tc * TILE - 2; x < (tc + 2) * TILE + 2; x++) {
        const i = y * PW + x;
        if (kind[i] !== 1) continue;
        const ex = Math.min(x - (tc * TILE - 2), (tc + 2) * TILE + 1 - x);
        let s = ex === 0 ? 2 : ex < 3 ? 13 : ((x + y) % 8 === 0 || (x - y + 800) % 8 === 0) ? 6 : 9;
        if (ex >= 3 && hash(x, y, seed) < 0.2) s -= 1;
        buf[i] = 64 + s; kind[i] = 4;
      }
    }
  }

  // ---- pass 5: ambient occlusion and vignette on floors ----
  const solidAt = (r, c) => { const t = at(r, c); return t !== null && SOLID.has(t); };
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const i = y * PW + x;
    if (kind[i] !== 1 && kind[i] !== 4) continue;
    const r = (y / TILE) | 0, c = (x / TILE) | 0, lx = x % TILE, ly = y % TILE;
    let occ = 0;
    if (solidAt(r - 1, c)) occ = Math.max(occ, (8 - ly) / 8 * 5);
    if (solidAt(r, c - 1)) occ = Math.max(occ, (5 - lx) / 5 * 3.5);
    if (solidAt(r, c + 1)) occ = Math.max(occ, (3 - (11 - lx)) / 3 * 2.5);
    if (solidAt(r + 1, c)) occ = Math.max(occ, (2 - (11 - ly)) / 2 * 1.5);
    if (solidAt(r - 1, c - 1) && !solidAt(r - 1, c) && !solidAt(r, c - 1)) occ = Math.max(occ, ((5 - lx) / 5) * ((6 - ly) / 6) * 4);
    const dn = Math.hypot((x - PW / 2) / (PW / 2), (y - PH / 2) / (PH / 2));
    occ += Math.max(0, dn - 0.55) * 4.5;
    if (occ <= 0) continue;
    const whole = Math.floor(occ), frac = occ - whole;
    const drop = whole + (bayer(x, y) < frac ? 1 : 0);
    const base = kind[i] === 4 ? 64 : 16;
    buf[i] = Math.max(base, buf[i] - drop);
  }

  // ---- pass 6: lights ----
  const sconces = [];
  if (!dark && mood.sconce) placeSconces(cells, inside, mood, seed, sconces);
  for (const s of sconces) lightPool(buf, kind, s.fx, s.fy, s.kind === "candle" ? 30 : 40, seed);
  if (!dark && mood.shafts) lightShafts(buf, kind, cells, inside, mood.shafts, seed);
  if (!dark && mood.dapple) {
    for (let i = 0; i < PW * PH; i++) {
      if (kind[i] !== 1) continue;
      const x = i % PW, y = (i / PW) | 0;
      const v = vnoise(x, y, 9, seed + 77) * 0.7 + vnoise(x, y, 4, seed + 78) * 0.3;
      if (v > 0.66 && bayer(x, y) < (v - 0.66) * 4) buf[i] = 184 + ((hash(x >> 1, y >> 1, seed) * 8) | 0);
    }
  }
  if (!dark && mood.runes && (roomId === 66 || roomId === 67)) runeCircle(buf, kind, PW / 2 + (roomId === 66 ? 18 : 30), PH / 2, roomId === 66 ? 34 : 22);

  // ---- c2p ----
  const planes = createPlanes(PW, PH, 8);
  chunkyToPlanes(buf, planes, dark);

  // ---- BOB tiles on top ----
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = cells[r][c];
    const art = TILES[t];
    if (!art || t === "statue" || t === "fountain") continue;
    blit(planes, makeBob(art, "tile", dark, t), c * TILE, r * TILE);
  }
  for (const comp of composites) {
    const art = comp.kind === "statue" ? TILES.statue : TILES.fountain_jet;
    blit(planes, makeBob(art, "tile", dark, comp.kind === "statue" ? "statue" : "fountain_jet"), comp.c * TILE, comp.r * TILE - (comp.kind === "statue" ? 2 : 0));
  }
  for (const s of sconces) {
    const art = s.kind === "candle" ? TILES.sconce_candle : TILES.sconce_torch;
    blit(planes, makeBob(art, "tile", dark, "sconce_" + s.kind), s.bx, s.by);
  }
  planes.version++;
  return { id: roomId, planes, mood, dark, sconces, inside, cells, width: PW, height: PH };
}

function normalize(t) {
  if (!t || t === "floor") return "floor";
  return KNOWN.has(t) ? t : "stone";
}

function inShadow(links, lx, ly) {
  return (ly === 8 && lx >= 4 && ((links.includes("w") && lx <= 8) || (links.includes("e")))) ||
    (lx === 8 && ly >= 4 && ((links.includes("n") && ly <= 8) || links.includes("s")));
}

export function chunkyToPlanes(buf, planes, dark) {
  const W = planes.width, H = planes.height, bpr = planes.bpr;
  for (const p of planes.planes) p.fill(0);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = buf[y * W + x];
      if (dark) v = darkIndex(v);
      if (!v) continue;
      const off = y * bpr + (x >> 3), bit = 0x80 >> (x & 7);
      for (let p = 0; p < 8; p++) if (v & (1 << p)) planes.planes[p][off] |= bit;
    }
  planes.version++;
}

// ---------- surfaces ----------
function floorShade(style, x, y, seed) {
  const n = hash(x, y, seed);
  let s;
  switch (style) {
    case "flag": {
      const rowH = 16, row = Math.floor(y / rowH), off = (row & 1) * 11 + Math.floor(hash(row, 0, seed) * 4);
      const col = Math.floor((x + off) / 22), lx = (x + off) % 22, ly = y % rowH;
      const base = 6 + Math.floor(hash(col, row, seed + 1) * 3);
      if (lx === 0 || ly === 0) return base - 3;
      s = base + Math.round((vnoise(x, y, 6, seed + col * 13 + row) - 0.5) * 2.4);
      if (ly === 1 || lx === 1) s += 1;
      if (ly === rowH - 1 || lx === 21) s -= 1;
      if (hash(col, row, seed + 2) < 0.15 && Math.abs(lx - ly * 1.2 - 4) < 0.6) s = base - 2;
      break;
    }
    case "cobble": {
      const rowH = 7, row = Math.floor(y / rowH), off = Math.floor(hash(row, 3, seed) * 9);
      const cw = 9, col = Math.floor((x + off) / cw), lx = (x + off) % cw, ly = y % rowH;
      const base = 6 + Math.floor(hash(col, row, seed + 3) * 3);
      const corner = (lx === 0 || lx === cw - 1) && (ly === 0 || ly === rowH - 1);
      if (lx === 0 || ly === 0 || corner) return base - 4;
      s = base;
      if (ly === 1 && lx > 1 && lx < cw - 2) s += 2;
      else if (lx === 1 && ly < rowH - 2) s += 1;
      if (ly === rowH - 1 || lx === cw - 1) s -= 2;
      if (n < 0.1) s -= 1;
      break;
    }
    case "parquet": {
      const row = Math.floor(y / 4), off = Math.floor(hash(row, 1, seed) * 24);
      const col = Math.floor((x + off) / 24), lx = (x + off) % 24, ly = y % 4;
      if (ly === 3 || lx === 0) return 3;
      s = 7 + Math.floor(hash(col, row, seed + 4) * 3) - (row & 1);
      if (ly === 0) s += 1;
      if (hash(x >> 2, y, seed + 5) < 0.18) s -= 1;
      break;
    }
    case "carpet": {
      const d1 = (x + y) % 12, d2 = (x - y + 1200) % 12;
      if (d1 === 0 || d2 === 0) s = 9;
      else if (d1 === 6 && d2 === 6) s = 12;
      else s = (x + y) & 1 ? 5 : 6;
      break;
    }
    case "grass": {
      s = 5 + Math.round(vnoise(x, y, 22, seed) * 3.2 + vnoise(x, y, 7, seed + 3) * 1.4);
      if (n < 0.028) s += 3;
      else if (hash(x, y - 1, seed) < 0.028) s += 2;
      else if (n > 0.975) s -= 2;
      break;
    }
    case "dirt": {
      s = 4 + Math.floor(vnoise(x, y, 7, seed) * 6);
      const pc = hash(x >> 2, y >> 2, seed + 9);
      if (pc < 0.07) { const lx = x & 3, ly = y & 3; if (lx < 2 && ly < 2) s = 11 - ly * 2; else if (lx < 3 && ly < 3) s = 2; }
      if (n < 0.08) s -= 2;
      break;
    }
    case "marble": {
      const lx = x % 12, ly = y % 12;
      const light = ((Math.floor(x / 12) + Math.floor(y / 12)) & 1) === 0;
      if (lx === 0 || ly === 0) return 2;
      s = light ? 11 : 5;
      if (Math.abs(vnoise(x, y, 7, seed) - 0.5) < 0.035) s += light ? -3 : 2;
      if (lx === 1 || ly === 1) s += 1;
      break;
    }
    default:
      s = 7;
  }
  return Math.max(0, Math.min(15, s));
}

function wallPixel(t, x, y, lx, ly, oN, oS, oW, oE, seed) {
  const row = Math.floor(y / 4), off = (row & 1) * 4, bx = Math.floor((x + off) / 8);
  const mortar = (x + off) % 8 === 0 || y % 4 === 0;
  const n = hash(x, y, seed + 11);
  let s;
  if (mortar) s = n < 0.4 ? 2 : 3;
  else {
    s = 7 + Math.floor(hash(bx, row, seed + 12) * 4);
    if (y % 4 === 1) s += 2;
    if (y % 4 === 3) s -= 1;
    if (n < 0.12) s -= 1; else if (n > 0.92) s += 1;
  }
  let face = false;
  if (oS && ly >= 8) {
    face = true;
    s = ly === 11 ? 1 : ly === 8 ? 5 : 4 - ((x + off) % 6 === 0 ? 2 : 0) + (n < 0.2 ? -1 : 0);
  }
  if (!face && oN && ly <= 1) s = ly === 0 ? 14 : 12;
  if (!face && oW && lx === 0) s = Math.max(s, 11);
  if (oE && lx === 11) s = Math.min(s, 3);
  if (t === "wall_color1" || t === "wall_color2") {
    if (!mortar && !face && s >= 6) return 176 + ((((x + y) >> 2) + (t === "wall_color2" ? 4 : 0)) & 7);
  }
  return 32 + Math.max(0, Math.min(15, s));
}

function blockPixel(g, x, y, lx, ly, oN, oS, oW, oE, seed, velvet) {
  const base = g === "wood" ? 48 : 80;
  const n = hash(x, y, seed + 21);
  let s;
  if (g === "wood") {
    s = 8 + (y % 4 === 0 ? -3 : 0) + (hash(x >> 3, y >> 2, seed) < 0.3 ? -1 : 0) + (n > 0.9 ? 1 : 0);
  } else {
    s = 10 + (n < 0.12 ? -1 : 0);
    if (lx >= 2 && lx <= 9 && ly >= 2 && ly <= 8) {
      s = 8 + (n < 0.15 ? -1 : 0);
      if (lx === 2 || ly === 2) s = 4;
      else if (lx === 9 || ly === 8) s = 13;
      else if (velvet) return 64 + 7 + ((lx + ly) % 4 === 0 ? 3 : 0) + (ly === 3 ? 2 : 0);
    }
  }
  if (oS && ly >= 9) return ly === 11 ? 192 : base + (ly === 9 ? 6 : 4) - ((x % 5 === 0) ? 1 : 0);
  if (oN && ly === 0) s = 13;
  if (oW && lx === 0) s = Math.max(s, 12);
  if (oE && lx === 11) s = 3;
  if (oN && oW && lx === 0 && ly === 0) s = 15;
  return base + Math.max(0, Math.min(15, s));
}

// bookshelves seen from above: a wooden frame packed with book tops in many colors
const BOOK_RAMPS = [[204, 205, 206], [212, 213, 214], [216, 217, 218], [220, 221, 222], [208, 209, 210], [224, 225, 226], [236, 237, 238]];
function shelfPixel(x, y, lx, ly, oN, oS, oW, oE, seed) {
  if (oS && ly >= 10) return ly === 11 ? 192 : 48 + 5;
  if ((oN && ly <= 1) || (oW && lx === 0) || (oE && lx === 11)) return 48 + (ly === 0 || lx === 0 ? 12 : 6);
  if (ly === 5) return 48 + 4; // a shelf board between two rows of books
  const bookW = 2 + (hash(x >> 1, y > 5 ? 1 : 0, seed + 71) < 0.3 ? 1 : 0);
  const col = Math.floor(x / bookW), rowKey = Math.floor(y / 6);
  const ramp = BOOK_RAMPS[Math.floor(hash(col, rowKey, seed + 72) * BOOK_RAMPS.length)];
  if (hash(col, rowKey, seed + 73) < 0.08) return 48 + 2; // a gap
  const edge = x % bookW;
  return edge === 0 ? ramp[2] : edge === bookW - 1 ? ramp[0] : ramp[1];
}

// wine barrels seen from above: round lids with iron hoops; negative = floor shadow amount
function barrelPixel(lx, ly, x, y, seed) {
  const d = Math.hypot(lx - 5.5, ly - 5.5);
  if (d > 6.2) return d < 7.2 && (lx > 5 || ly > 5) ? -4 : -1;
  const a = Math.atan2(ly - 5.5, lx - 5.5);
  const light = Math.cos(a + Math.PI * 0.75);
  if (d > 5.2) return 80 + Math.max(1, Math.min(15, Math.round(7 + light * 5)));
  if (d > 4.4) return 48 + Math.max(1, Math.min(15, Math.round(6 + light * 4)));
  const plank = (lx + (hash(x, y >> 3, seed) < 0.1 ? 1 : 0)) % 3 === 0;
  return 48 + Math.max(1, Math.min(15, Math.round(9 - d * 0.6 + light * 2 - (plank ? 3 : 0))));
}

function bedPixel(t, cells, r, c, x, y, lx, ly, oN, oS, oW, oE) {
  // find the blanket color from the nearest colored middle tile
  let col = BED_COLORS[t];
  if (!col) {
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const n = cells[r + dr]?.[c + dc];
      if (BED_COLORS[n]) { col = BED_COLORS[n]; break; }
    }
    col ||= BED_COLORS.bed_white;
  }
  const wood = (s) => 48 + s;
  if ((oW && lx <= 1) || (oE && lx >= 10)) return wood(lx <= 1 ? (lx === 0 ? 4 : 11) : lx === 11 ? 3 : 7);
  if (oS && ly >= 10) return ly === 11 ? 192 : wood(5);
  if (t === "bed_top" && ly <= 3) return wood(ly === 0 ? 13 : ly === 3 ? 4 : 9);
  if (t === "bed_bottom" && ly >= 8) return wood(ly === 8 ? 12 : 7);
  if (t === "bed_left" && lx <= 3) return wood(lx === 0 ? 12 : 8);
  if (t === "bed_right" && lx >= 8) return wood(lx === 11 ? 4 : 8);
  // pillow
  if (t === "bed_top" && ly <= 8) return ly === 8 ? 195 : (lx + ly) % 5 === 0 ? 198 : 199;
  if (t === "bed_left" && lx <= 8) return lx === 8 ? 195 : (lx + ly) % 5 === 0 ? 198 : 199;
  // quilt
  const d1 = (x + y) % 6, d2 = (x - y + 600) % 6;
  if (d1 === 0 || d2 === 0) return col[1];
  if (d1 === 3 && d2 === 3) return col[3];
  return oN && ly === 0 ? col[3] : col[2];
}

function voidPixel(mood, x, y, seed) {
  if (mood.stars) {
    const h = hash(x, y, seed + 31);
    if (h < 0.012) return 8 + ((hash(x, y, seed + 32) * 8) | 0);
    const v = vnoise(x, y, 26, seed + 33);
    if (v > 0.6 && bayer(x, y) < (v - 0.6) * 2.2) return 1 + Math.min(6, Math.floor((y / PH) * 5 + 1));
  }
  return 0;
}

// ---------- lights ----------
function placeSconces(cells, inside, mood, seed, out) {
  const cand = [];
  for (let r = 0; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) {
    if (!WALLS.has(cells[r][c])) continue;
    // south-facing face with floor below, and wall on both sides (a straight run)
    if (cells[r + 1][c] === "floor" && inside[(r + 1) * COLS + c] && WALLS.has(cells[r][c - 1]) && WALLS.has(cells[r][c + 1]))
      cand.push({ r, c, side: "s" });
  }
  for (let r = 2; r < ROWS - 2; r++) for (let c = 0; c < COLS; c++) {
    if (!WALLS.has(cells[r][c])) continue;
    if (c + 1 < COLS && cells[r][c + 1] === "floor" && inside[r * COLS + c + 1] && WALLS.has(cells[r - 1][c]) && WALLS.has(cells[r + 1][c]))
      cand.push({ r, c, side: "e" });
    if (c > 0 && cells[r][c - 1] === "floor" && inside[r * COLS + c - 1] && WALLS.has(cells[r - 1][c]) && WALLS.has(cells[r + 1][c]))
      cand.push({ r, c, side: "w" });
  }
  // deterministic shuffle, then keep candidates that are far apart
  cand.sort((a, b) => hash(a.r, a.c, seed + 41) - hash(b.r, b.c, seed + 41));
  const max = Math.min(5, Math.max(2, Math.round(cand.length / 6)));
  for (const s of cand) {
    if (out.length >= max) break;
    if (out.some((o) => Math.hypot(o.r - s.r, o.c - s.c) < 7)) continue;
    const kind = mood.sconce;
    let bx, by, fx, fy;
    if (s.side === "s") { bx = s.c * TILE + 3; by = s.r * TILE + 4; fx = s.c * TILE + 6; fy = s.r * TILE + 14; }
    else if (s.side === "e") { bx = s.c * TILE + 7; by = s.r * TILE + 2; fx = s.c * TILE + 16; fy = s.r * TILE + 5; }
    else { bx = s.c * TILE; by = s.r * TILE + 2; fx = s.c * TILE - 4; fy = s.r * TILE + 5; }
    out.push({ ...s, kind, bx, by, fx, fy });
  }
}

function lightPool(buf, kind, cx, cy, R, seed) {
  void seed;
  for (let y = Math.max(0, cy - R); y < Math.min(PH, cy + R); y++)
    for (let x = Math.max(0, cx - R); x < Math.min(PW, cx + R); x++) {
      const i = y * PW + x;
      const k = kind[i];
      if (k !== 1 && k !== 2 && k !== 4) continue;
      const d = Math.hypot(x - cx, (y - cy) * 1.2) / R;
      if (d >= 1) continue;
      const v = buf[i];
      const isWall = v >= 32 && v < 48;
      const isFloor = (v >= 16 && v < 32) || (v >= 64 && v < 80);
      if (!isWall && !isFloor) continue;
      const shade = v & 15;
      const b = bayer(x, y);
      const p = Math.min(1, (1 - d) * 4);
      if (b < p) {
        // concentric rings, ordered-dithered into each other (the registers flicker per vblank)
        const ring = Math.max(0, Math.min(3, Math.floor(d * 4.2 + (b - 0.5) * 0.95)));
        const band = Math.min(3, (shade + 1) >> 2);
        buf[i] = (isWall ? 112 : 96) + band * 4 + ring;
      } else if (isFloor) {
        buf[i] = (v & ~15) | Math.min(15, shade + 1);
      }
    }
}

function lightShafts(buf, kind, cells, inside, n, seed) {
  // windows along the north wall: find wall cells with interior floor under them
  const tops = [];
  for (let c = 2; c < COLS - 4; c++) for (let r = 0; r < ROWS - 3; r++) {
    if (WALLS.has(cells[r][c]) && cells[r + 1][c] === "floor" && inside[(r + 1) * COLS + c]) { tops.push({ r, c }); break; }
  }
  if (!tops.length) return;
  tops.sort((a, b) => hash(a.c, a.r, seed + 61) - hash(b.c, b.r, seed + 61));
  const chosen = [];
  for (const t of tops) { if (chosen.length >= n) break; if (chosen.every((o) => Math.abs(o.c - t.c) >= 7)) chosen.push(t); }
  for (const t of chosen) {
    const x0 = t.c * TILE + 2, y0 = (t.r + 1) * TILE, slope = 0.55, width = 16, len = 120;
    for (let y = y0; y < Math.min(PH, y0 + len); y++) {
      const along = y - y0;
      const xs = x0 + along * slope;
      for (let x = Math.floor(xs); x < xs + width; x++) {
        if (x < 0 || x >= PW) continue;
        const i = y * PW + x;
        if (kind[i] !== 1 && kind[i] !== 4) continue;
        const v = buf[i];
        if (v < 16 || v >= 80) continue;
        const across = (x - xs) / width;
        const fade = Math.min(1, along / 10) * (1 - along / len) * (1 - Math.abs(across - 0.5) * 1.6);
        if (bayer(x, y) < fade * 0.62) buf[i] = 168 + (Math.floor(along / 6 + across * 2) & 7);
      }
    }
  }
}

function runeCircle(buf, kind, cx, cy, R) {
  for (let y = cy - R - 2; y <= cy + R + 2; y++) for (let x = cx - R - 2; x <= cx + R + 2; x++) {
    if (x < 0 || y < 0 || x >= PW || y >= PH) continue;
    const i = y * PW + x;
    if (kind[i] !== 1) continue;
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const ring = Math.abs(d - R) < 0.8 || Math.abs(d - R * 0.72) < 0.7;
    const spoke = d < R * 0.72 && Math.abs(Math.sin(a * 2.5) * d) < 0.7;
    const glyph = d > R * 0.74 && d < R * 0.96 && Math.floor(((a + Math.PI) / (Math.PI * 2)) * 16) % 2 === 0 && hash(x >> 1, y >> 1, 9) < 0.45;
    if (ring || spoke || glyph) buf[i] = 176 + ((Math.floor(((a + Math.PI) / (Math.PI * 2)) * 16)) & 7);
  }
}

export { SOLID, WALLS };
