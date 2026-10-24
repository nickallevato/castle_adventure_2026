// Planar bitmaps, laid out like Amiga chip RAM: DEPTH (8 on AGA) separate 1-bit planes, each `bpr` bytes per row
// (width / 8, rounded up to whole bytes), MSB = leftmost pixel. A pixel's color index is
// plane0 | plane1 << 1 | ... | plane(d-1) << (d-1).

export function createPlanes(width, height, depth = 8) {
  const bpr = Math.ceil(width / 8);
  const planes = [];
  for (let p = 0; p < depth; p++) planes.push(new Uint8Array(bpr * height));
  return { width, height, depth, bpr, planes, version: 0 };
}

export function getPixel(bm, x, y) {
  if (x < 0 || y < 0 || x >= bm.width || y >= bm.height) return 0;
  const off = y * bm.bpr + (x >> 3), bit = 0x80 >> (x & 7);
  let c = 0;
  for (let p = 0; p < bm.depth; p++) if (bm.planes[p][off] & bit) c |= 1 << p;
  return c;
}

export function setPixel(bm, x, y, color) {
  if (x < 0 || y < 0 || x >= bm.width || y >= bm.height) return;
  const off = y * bm.bpr + (x >> 3), bit = 0x80 >> (x & 7);
  for (let p = 0; p < bm.depth; p++) {
    if (color & (1 << p)) bm.planes[p][off] |= bit;
    else bm.planes[p][off] &= ~bit;
  }
  bm.version++;
}

/** Set the bits of one plane only (used for light-mask tricks); value 0/1. */
export function setPlaneBit(bm, p, x, y, value) {
  if (x < 0 || y < 0 || x >= bm.width || y >= bm.height) return;
  const off = y * bm.bpr + (x >> 3), bit = 0x80 >> (x & 7);
  if (value) bm.planes[p][off] |= bit; else bm.planes[p][off] &= ~bit;
  bm.version++;
}

export function clearPlanes(bm, color = 0) {
  for (let p = 0; p < bm.depth; p++) bm.planes[p].fill(color & (1 << p) ? 0xff : 0);
  bm.version++;
}

export function fillRect(bm, x, y, w, h, color) {
  for (let yy = Math.max(0, y); yy < Math.min(bm.height, y + h); yy++)
    for (let xx = Math.max(0, x); xx < Math.min(bm.width, x + w); xx++) setPixel(bm, xx, yy, color);
}

/** Copy whole planes from src to dst (same geometry). */
export function copyPlanes(dst, src) {
  for (let p = 0; p < dst.depth; p++) dst.planes[p].set(src.planes[p]);
  dst.version++;
}

/** Copy src into dst at a byte-aligned x (multiple of 8) and any y; geometry may differ. */
export function copyPlanesAt(dst, src, x, y) {
  const xb = x >> 3;
  const n = Math.min(src.bpr, dst.bpr - xb);
  for (let p = 0; p < Math.min(dst.depth, src.depth); p++) {
    for (let row = 0; row < src.height; row++) {
      const dy = y + row;
      if (dy < 0 || dy >= dst.height) continue;
      dst.planes[p].set(src.planes[p].subarray(row * src.bpr, row * src.bpr + n), dy * dst.bpr + xb);
    }
  }
  dst.version++;
}

/** Build a planar image (+ 1-bit mask) from an index buffer; idx < 0 means transparent. */
export function planarFromIndices(width, height, indices, depth = 8) {
  const bm = createPlanes(width, height, depth);
  const mask = new Uint8Array(bm.bpr * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = indices[y * width + x];
      if (c < 0) continue;
      const off = y * bm.bpr + (x >> 3), bit = 0x80 >> (x & 7);
      mask[off] |= bit;
      for (let p = 0; p < depth; p++) if (c & (1 << p)) bm.planes[p][off] |= bit;
    }
  bm.mask = mask;
  return bm;
}

/**
 * Convert planes to a chunky index buffer (Uint8Array width*height) using per-byte lookup tables:
 * for every plane and byte value, the 8 output pixels as two 32-bit words.
 */
const LUT = (() => {
  const t = [];
  const le = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  for (let p = 0; p < 8; p++) {
    const a = new Uint32Array(512);
    for (let b = 0; b < 256; b++) {
      for (let half = 0; half < 2; half++) {
        let w = 0;
        for (let i = 0; i < 4; i++) {
          const bit = (b >> (7 - (half * 4 + i))) & 1;
          const lane = le ? i : 3 - i;
          w |= (bit << p) << (lane * 8);
        }
        a[b * 2 + half] = w >>> 0;
      }
    }
    t.push(a);
  }
  return t;
})();

export function planesToIndices(bm, out = new Uint8Array(bm.bpr * 8 * bm.height)) {
  // out is (bpr*8) wide; callers with width % 8 == 0 get exactly width*height.
  const words = new Uint32Array(out.buffer, out.byteOffset, out.length >> 2);
  words.fill(0);
  const n = bm.bpr * bm.height;
  for (let p = 0; p < bm.depth; p++) {
    const plane = bm.planes[p], lut = LUT[p];
    for (let i = 0; i < n; i++) {
      const b = plane[i];
      if (!b) continue;
      words[i * 2] |= lut[b * 2];
      words[i * 2 + 1] |= lut[b * 2 + 1];
    }
  }
  return out;
}
