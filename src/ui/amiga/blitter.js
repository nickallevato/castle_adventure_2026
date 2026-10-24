// A small software "blitter" for planar bitmaps. Like the Amiga blitter it works a plane at a time on
// whole bytes, with channel A = mask, B = source plane, C = destination plane, D = result, combined by
// a minterm. The default minterm 0xCA is the classic cookie-cut: D = (A & B) | (~A & C), so pixels
// outside the BOB's mask keep the background.

import { createPlanes } from "./bitplanes.js";

export const MINTERM_COOKIE = 0xca;

function minterm(m, A, B, C) {
  if (m === 0xca) return (A & B) | (~A & C);
  let D = 0;
  for (let i = 0; i < 8; i++) {
    if (!(m & (1 << i))) continue;
    D |= (i & 4 ? A : ~A) & (i & 2 ? B : ~B) & (i & 1 ? C : ~C);
  }
  return D & 0xff;
}

/**
 * Blit a planar BOB into dst at (x, y), any x (the source is shifted across bytes like BLTCON0 ASH).
 * src: { width, height, depth, bpr, planes, mask? }  (no mask = solid rectangle)
 * opts.minterm: default 0xCA
 * opts.planes: destination planes to touch (default all)
 * opts.fill:   per destination plane constant 0/1 to use as B instead of source data
 *              (stamping a mask in one color, e.g. font glyphs or a light mask)
 */
export function blit(dst, src, x, y, opts = {}) {
  const m = opts.minterm ?? MINTERM_COOKIE;
  const shift = ((x % 8) + 8) % 8;
  const xb = Math.floor(x / 8);
  const planes = opts.planes || [...Array(dst.depth).keys()];
  const fill = opts.fill;
  const sbpr = src.bpr;
  for (let row = 0; row < src.height; row++) {
    const dy = y + row;
    if (dy < 0 || dy >= dst.height) continue;
    const srow = row * sbpr;
    const drow = dy * dst.bpr;
    let prevA = 0;
    const prevB = new Array(dst.depth).fill(0);
    for (let k = 0; k <= sbpr; k++) {
      const curA = k < sbpr ? (src.mask ? src.mask[srow + k] : lastByteMask(src, k)) : 0;
      const A = (((prevA << 8) | curA) >> shift) & 0xff;
      prevA = curA;
      const dx = xb + k;
      const inside = dx >= 0 && dx < dst.bpr;
      for (const p of planes) {
        let curB;
        if (fill) curB = fill[p] ? 0xff : 0;
        else curB = k < sbpr && p < src.depth ? src.planes[p][srow + k] : 0;
        if (fill && k === sbpr) curB = 0;
        const B = (((prevB[p] << 8) | curB) >> shift) & 0xff;
        prevB[p] = curB;
        if (!inside || !A) continue;
        const C = dst.planes[p][drow + dx];
        dst.planes[p][drow + dx] = minterm(m, A, B, C);
      }
    }
  }
  dst.version = (dst.version || 0) + 1;
}

// Without an explicit mask the BOB is a solid rectangle: ones for every pixel within its width.
function lastByteMask(src, k) {
  const rem = src.width - k * 8;
  return rem >= 8 ? 0xff : (0xff << (8 - rem)) & 0xff;
}

/** Build a planar BOB from rows of characters and a char -> color map ('.' or unmapped = transparent). */
export function bobFromRows(rows, charmap, depth = 8) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const bm = createPlanes(w, h, depth);
  bm.mask = new Uint8Array(bm.bpr * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      const c = ch === undefined ? undefined : charmap[ch];
      if (c === undefined || c === null || c < 0) continue;
      const off = y * bm.bpr + (x >> 3), bit = 0x80 >> (x & 7);
      bm.mask[off] |= bit;
      for (let p = 0; p < depth; p++) if (c & (1 << p)) bm.planes[p][off] |= bit;
    }
  return bm;
}

/** Mirror a BOB horizontally (for left/right facing). */
export function mirrorBob(b) {
  const out = createPlanes(b.width, b.height, b.depth);
  out.mask = new Uint8Array(out.bpr * b.height);
  const get = (arr, x, y) => (arr[y * b.bpr + (x >> 3)] >> (7 - (x & 7))) & 1;
  const put = (arr, x, y) => (arr[y * out.bpr + (x >> 3)] |= 0x80 >> (x & 7));
  for (let y = 0; y < b.height; y++)
    for (let x = 0; x < b.width; x++) {
      const mx = b.width - 1 - x;
      if (b.mask && get(b.mask, x, y)) put(out.mask, mx, y);
      for (let p = 0; p < b.depth; p++) if (get(b.planes[p], x, y)) put(out.planes[p], mx, y);
    }
  return out;
}
