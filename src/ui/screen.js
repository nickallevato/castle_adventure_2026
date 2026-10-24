// The emulated AGA screen: PAL lowres 320x256, 8 bitplanes, 256 registers, a copper list per frame and
// color cycling on a 50 Hz vblank. The room playfield (288x216) sits at the top, centered, with a
// 40-line status strip below that the copper gives its own palette.

import { createPlanes, copyPlanesAt, fillRect, setPixel } from "./amiga/bitplanes.js";
import { blit } from "./amiga/blitter.js";
import { Display } from "./amiga/display.js";
import { CopperBuilder } from "./amiga/copper.js";
import { applyCycles, lerpRGB, scaleRGB, hex, ramp } from "./amiga/palette.js";
import { drawText, textWidth, glyphRows, FONT_ADVANCE } from "./amiga/font.js";
import { planarFromIndices } from "./amiga/bitplanes.js";
import { darkLevels, animateTorch } from "./art/moods.js";
import { PW, PH } from "./art/room-builder.js";

export const SCREEN_W = 320, SCREEN_H = 256, PF_X = 16, PF_Y = 0, STRIP_Y = 216;
const VBLANK_MS = 20;

const STRIP = {
  1: "#161c30", 2: "#262e4a", 3: "#56648e", 4: "#05060c", 5: "#f2ecda", 6: "#e8b834", 7: "#05070e", 16: "#ff6a48",
  17: "#8a96c0", 18: "#3cc0c0",
};
const BAR_RAMPS = {
  good: ramp(["#1e5a22", "#3c9a2e", "#86cc3e", "#dcf07a"], 4),
  mid: ramp(["#6a3a08", "#b07018", "#e8b034", "#fff09a"], 4),
  low: ramp(["#5a0a10", "#a01a1a", "#e04a2a", "#ffa070"], 4),
};
const RASTER = ["#1a2040", "#3a4a80", "#8a9ad8", "#e8eeff", "#8a9ad8", "#3a4a80"].map(hex);

const BANNER = {
  title: ["#fff4b0", "#ffd040", "#ff9a20", "#e04a20", "#a02060", "#e04a20", "#ff9a20", "#ffd040"].map(hex),
  blood: ["#ff6040", "#d02018", "#8a0a10", "#5a0408", "#8a0a10", "#d02018"].map(hex),
  gold: ["#ffffff", "#fff4b0", "#ffd040", "#e8a020", "#ffd040", "#fff4b0"].map(hex),
};

// big text for banners: the 5x8 font scaled 4x, with a 1px dark outline and a drop shadow
function bannerBob(lines) {
  const S = 4;
  const widths = lines.map((l) => (l.length * FONT_ADVANCE - 1) * S);
  const W = Math.max(...widths) + 6, lineH = 8 * S + 6, H = lines.length * lineH + 4;
  const idx = new Int16Array(W * H).fill(-1);
  const fill = new Uint8Array(W * H);
  lines.forEach((line, li) => {
    const ox = Math.round((W - widths[li]) / 2), oy = 2 + li * lineH;
    [...line].forEach((ch, ci) => glyphRows(ch).forEach((row, gy) => [...row].forEach((c, gx) => {
      if (c !== "#") return;
      for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) fill[(oy + gy * S + yy) * W + ox + (ci * FONT_ADVANCE + gx) * S + xx] = 1;
    })));
  });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (fill[y * W + x]) { idx[y * W + x] = 250; continue; }
    let near = false, shadow = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (fill[(y + dy) * W + x + dx]) { near = true; break; }
    for (let k = 1; k <= 3; k++) if (fill[(y - k) * W + x - k]) shadow = true;
    if (near || shadow) idx[y * W + x] = 192;
  }
  return planarFromIndices(W, H, idx, 8);
}

// halo masks for dark rooms: [core, edge] 1-bit BOBs at a few radii (for flicker)
function haloMask(rIn, rOut, soft) {
  const size = Math.ceil(rOut * 2) + 2;
  const bpr = Math.ceil(size / 8);
  const mask = new Uint8Array(bpr * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - c, (y + 0.5 - c) * 1.08);
    const B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(y & 3) * 4 + (x & 3)] / 16;
    const inner = rIn === 0 ? 1 : Math.max(0, Math.min(1, (d - (rIn - soft)) / (soft * 2)));
    const outer = Math.max(0, Math.min(1, ((rOut + soft) - d) / (soft * 2)));
    if (B < Math.min(inner, outer)) mask[y * bpr + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return { width: size, height: size, depth: 1, bpr, planes: [mask], mask, half: c };
}
const HALOS = [0, 1, 2].map((k) => ({ core: haloMask(0, 34 + k * 2, 5), edge: haloMask(34 + k * 2, 56 + k * 3, 6) }));

export class GameScreen {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.planes = createPlanes(SCREEN_W, SCREEN_H, 8);
    this.display = new Display(this.planes);
    this.off = document.createElement("canvas");
    this.off.width = SCREEN_W; this.off.height = SCREEN_H;
    this.octx = this.off.getContext("2d");
    this.image = this.octx.createImageData(SCREEN_W, SCREEN_H);
    this.room = null;
    this.next = null;
    this.fadeK = 0;
    this.fadeDir = 1;
    this.status = null;
    this.statusDirty = true;
    this.scale = 1;
    this.lastTick = -1;
    this.flicker = { g1: 0.5, g2: 1, halo: 0 };
  }

  resize(cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    const k = Math.max(1, Math.floor(Math.min((cssW * dpr) / SCREEN_W, (cssH * dpr) / SCREEN_H)));
    this.scale = k;
    if (this.canvas.width !== SCREEN_W * k) { this.canvas.width = SCREEN_W * k; this.canvas.height = SCREEN_H * k; }
    this.canvas.style.width = (SCREEN_W * k) / dpr + "px";
    this.canvas.style.height = (SCREEN_H * k) / dpr + "px";
    return k;
  }

  /** Change room: fade the registers out, swap, fade in (the classic Amiga fade). */
  setRoom(built, { instant = false } = {}) {
    if (!this.room || instant) { this.room = built; this.fadeK = instant ? 1 : 0; this.fadeDir = 1; return; }
    if (this.room === built) return;
    this.next = built;
    this.fadeDir = -1;
  }

  setStatus(s) {
    const key = JSON.stringify(s);
    if (key === this.statusKey) return;
    this.statusKey = key;
    this.status = s;
    this.statusDirty = true;
  }

  /** Map a client point to playfield tile coordinates (or null). */
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * SCREEN_W, sy = ((clientY - rect.top) / rect.height) * SCREEN_H;
    const px = sx - PF_X, py = sy - PF_Y;
    if (px < 0 || py < 0 || px >= PW || py >= PH) return null;
    return { col: Math.floor(px / 12), row: Math.floor(py / 12), px, py };
  }

  /**
   * Draw one frame. ents: [{ bob, x, y, z }] in playfield pixels; texts: [{ text, x, y, color }].
   * light: { x, y } center of the lamp halo in dark rooms (the player).
   */
  frame(now, ents = [], texts = [], light = null, paused = false) {
    const tick = Math.floor(now / VBLANK_MS);
    this.canvas.dataset.vblank = tick;
    const vbl = tick !== this.lastTick ? Math.max(1, tick - this.lastTick) : 0;
    if (this.lastTick < 0) this.lastTick = tick;
    if (vbl) {
      this.lastTick = tick;
      // fades step on vblank: out in ~6 frames, in over ~12
      if (this.fadeDir < 0) { this.fadeK -= vbl / 6; if (this.fadeK <= 0) { this.fadeK = 0; this.room = this.next || this.room; this.next = null; this.fadeDir = 1; } }
      else if (this.fadeK < 1) this.fadeK = Math.min(1, this.fadeK + vbl / 12);
      if (this.room?.dark) this.stepFlicker(tick);
    }
    const room = this.room;
    if (!room) return;
    const P = this.planes;
    copyPlanesAt(P, room.planes, PF_X, PF_Y);
    // side borders of the playfield rows are void (COLOR00)
    if (room.dark && light) {
      const h = HALOS[this.flicker.halo];
      const lx = Math.round(PF_X + light.x), ly = Math.round(PF_Y + light.y);
      blit(P, h.edge, lx - Math.round(h.edge.half), ly - Math.round(h.edge.half), { planes: [6], fill: { 6: 1 } });
      blit(P, h.core, lx - Math.round(h.core.half), ly - Math.round(h.core.half), { planes: [6, 7], fill: { 6: 0, 7: 1 } });
      // keep the halo inside the playfield
      clearBelow(P, STRIP_Y);
    }
    ents.sort((a, b) => (a.z ?? a.y) - (b.z ?? b.y));
    for (const e of ents) blit(P, e.bob, Math.round(PF_X + e.x), Math.round(PF_Y + e.y));
    for (const t of texts) drawText(P, t.text, Math.round(PF_X + t.x), Math.round(PF_Y + t.y), t.color, 192);
    if (this.banner) {
      if (this.banner.bob === undefined) this.banner.bob = bannerBob(this.banner.lines);
      const bb = this.banner.bob;
      this.banner.y0 = Math.round((PH - bb.height) / 2) - 8;
      blit(P, bb, Math.round(PF_X + (PW - bb.width) / 2), this.banner.y0);
    }
    clearSides(P);
    if (this.statusDirty) this.drawStatus();

    // registers
    // cycles and flicker follow real time in vblank units, so 60/120/144 Hz displays sample them
    // evenly instead of repeating a frame whenever the 50 Hz tick hasn't advanced
    const vt = now / VBLANK_MS;
    const mood = room.mood;
    let regs;
    if (room.dark) {
      const base = applyCycles(mood.base64, mood.cycles, vt);
      regs = darkLevels(base, mood.lamp, [0.11, this.flicker.g1, this.flicker.g2]);
    } else {
      regs = animateTorch(applyCycles(mood.regs, mood.cycles, vt), mood, vt);
    }
    const k = this.fadeK;
    if (k < 1) for (let i = 0; i < 256; i++) regs[i] = lerpRGB(0, regs[i], k);
    const copper = this.buildCopper(mood, regs, k, vt, room.dark);
    this.display.render(this.image, regs, copper);
    this.octx.putImageData(this.image, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.off, 0, 0, this.canvas.width, this.canvas.height);
  }

  stepFlicker(tick) {
    // lamp flicker: smooth-ish noise on the halo gains, and an occasional change of halo size
    const n = (t) => Math.sin(t * 0.31) * 0.5 + Math.sin(t * 0.73 + 1.3) * 0.3 + Math.sin(t * 1.9 + 0.2) * 0.2;
    this.flicker.g1 = 0.5 + n(tick) * 0.05;
    this.flicker.g2 = 1.0 + n(tick + 40) * 0.05;
    if (tick % 5 === 0) this.flicker.halo = Math.abs(Math.floor(n(tick * 0.7) * 3 + 1.5)) % 3;
  }

  buildCopper(mood, regs, k, tick, dark) {
    const b = new CopperBuilder();
    const sky = mood.skyCols;
    // COLOR00: the sky / void gradient, a MOVE every 2 lines
    for (let y = 0; y < STRIP_Y; y += 2) {
      const p = (y / STRIP_Y) * (sky.length - 1), i = Math.min(sky.length - 2, Math.floor(p));
      b.move(y, 0, lerpRGB(0, lerpRGB(sky[i], sky[i + 1], p - i), k));
    }
    // ambient light falloff: rescale the floor and wall ramps every 12 lines
    if (mood.ambient && !dark) {
      const [t0, t1] = mood.ambient;
      for (let y = 0; y < STRIP_Y; y += 12) {
        const f = t0 + (t1 - t0) * (y / STRIP_Y);
        for (let r = 16; r < 48; r++) b.move(y, r, scaleRGB(regs[r], f));
      }
    }
    // banner text (title, death, escape): a copper gradient on register 250, rolling with time
    if (this.banner?.bob) {
      const y0 = this.banner.y0, h = this.banner.bob.height;
      const cols = BANNER[this.banner.palette] || BANNER.title;
      for (let y = y0; y < y0 + h; y++) {
        const p = ((y - y0) / 3 + tick / 4) % cols.length;
        const i = Math.floor(p);
        b.move(y, 250, lerpRGB(cols[i], cols[(i + 1) % cols.length], p - i));
      }
      b.move(y0 + h, 250, 0xff4030);
    }
    // status strip: palette split at line 216, a raster bar, then a dark gradient
    for (let i = 0; i < RASTER.length; i++) b.move(STRIP_Y + i, 0, RASTER[i]);
    for (let y = STRIP_Y + RASTER.length; y < SCREEN_H; y += 2) b.move(y, 0, lerpRGB(0x0c1224, 0x04060c, (y - STRIP_Y) / 40));
    for (const [r, v] of Object.entries(STRIP)) b.move(STRIP_Y, Number(r), hex(v));
    const s = this.status;
    const pct = s ? s.strength / Math.max(1, s.maxStrength) : 1;
    const bar = pct > 0.5 ? BAR_RAMPS.good : pct > 0.25 ? BAR_RAMPS.mid : BAR_RAMPS.low;
    const ring = [bar[0], bar[1], bar[2], bar[3], bar[3], bar[2], bar[1], bar[0]];
    const off = Math.floor((tick * (pct > 0.25 ? 10 : 22)) / 50);
    for (let i = 0; i < 8; i++) b.move(STRIP_Y, 8 + i, ring[(i + off) % 8]);
    // treasure glint in the strip
    b.move(STRIP_Y, 19, [0xe8b834, 0xe8b834, 0xfff0a0, 0xffffff, 0xe8b834, 0xb07a18][Math.floor(tick / 6) % 6]);
    return b.build();
  }

  drawStatus() {
    this.statusDirty = false;
    const P = this.planes, s = this.status || {};
    for (const pl of P.planes) pl.fill(0, STRIP_Y * P.bpr);
    const y0 = STRIP_Y + 6;
    fillRect(P, 4, y0, 312, 32, 2);
    fillRect(P, 4, y0, 312, 1, 3); fillRect(P, 4, y0, 1, 32, 3);
    fillRect(P, 4, y0 + 31, 312, 1, 1); fillRect(P, 315, y0, 1, 32, 1);
    drawText(P, (s.name || "").slice(0, 30), 11, y0 + 5, 5, 4);
    drawText(P, "STR", 11, y0 + 19, 6, 4);
    const bx = 33, by = y0 + 18, bw = 112, bh = 9;
    fillRect(P, bx - 1, by - 1, bw + 2, bh + 2, 7);
    const pct = Math.max(0, Math.min(1, (s.strength ?? 0) / Math.max(1, s.maxStrength ?? 100)));
    const fillW = Math.round(bw * pct);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) setPixel(P, bx + x, by + y, x < fillW ? 8 + (((x + y) >> 1) & 7) : 1);
    drawText(P, String(s.strength ?? 0), bx + bw + 6, y0 + 19, 17, 4);
    const sc = "SCORE", tr = "TREASURE";
    drawText(P, sc, 190, y0 + 5, 6, 4);
    const sv = String(s.score ?? 0);
    drawText(P, sv, 309 - textWidth(sv), y0 + 5, 5, 4);
    drawText(P, tr, 190, y0 + 19, 6, 4);
    const tv = `${s.found ?? 0}/${s.total ?? 0}`;
    drawText(P, tv, 309 - textWidth(tv), y0 + 19, 5, 4);
    // little glinting gem next to the treasure count
    const gx = 248, gy = y0 + 18;
    const gem = ["..K..", ".KjK.", "KjJjK", ".KjK.", "..K.."];
    gem.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ".") setPixel(P, gx + x, gy + y, ch === "K" ? 4 : ch === "J" ? 19 : 6); }));
    if (s.flash) drawText(P, s.flash.slice(0, 50), 11, y0 + 40, 16, 4);
  }
}

// The playfield copy only covers its own columns, so anything drawn past its edges (the lamp halo
// at the west/east wall, a sprite gliding off) would otherwise stay in the side borders for good.
function clearSides(P) {
  const l = PF_X >> 3, r = (PF_X + PW) >> 3;
  for (const p of P.planes)
    for (let y = 0; y < STRIP_Y; y++) { p.fill(0, y * P.bpr, y * P.bpr + l); p.fill(0, y * P.bpr + r, (y + 1) * P.bpr); }
}

function clearBelow(P, y) {
  for (const p of [P.planes[6], P.planes[7]]) p.fill(0, y * P.bpr);
}
