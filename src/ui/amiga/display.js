// Display: planes + color registers + copper list -> RGBA pixels, scanline by scanline, the way
// Lisa (the AGA display chip) would. The planes -> chunky index conversion is cached and only redone
// when the planes change (their `version` bumps); palette and copper changes are only a remap.

import { planesToIndices } from "./bitplanes.js";
import { to32 } from "./palette.js";
import { runCopper } from "./copper.js";

export class Display {
  constructor(planes) {
    this.planes = planes;
    this.width = planes.bpr * 8;
    this.height = planes.height;
    this.indices = new Uint8Array(this.width * this.height);
    this.seen = -1;
    this.pal32 = new Uint32Array(256);
  }

  /** Refresh the chunky buffer if the planes changed. Returns true when it did. */
  sync() {
    if (this.seen === this.planes.version) return false;
    planesToIndices(this.planes, this.indices);
    this.seen = this.planes.version;
    return true;
  }

  /**
   * Render into an ImageData at (x0, y0).
   * regs: 256 base register values (already cycled/faded). copper: CopperList or null.
   * opts.transparent: register numbers drawn fully transparent (the world map's void).
   * opts.lines: only render this many lines (default: all).
   */
  render(image, regs, copper, opts = {}) {
    this.sync();
    const out = new Uint32Array(image.data.buffer, image.data.byteOffset, image.data.length >> 2);
    const W = this.width, idx = this.indices, pal = this.pal32;
    const tr = opts.transparent ? new Set(opts.transparent) : null;
    const outW = image.width;
    const x0 = opts.x0 || 0, y0 = opts.y0 || 0;
    const h = Math.min(this.height, opts.lines || this.height, image.height - y0);
    runCopper(copper, regs, h, (line, r, changed) => {
      if (changed === "all") for (let i = 0; i < 256; i++) pal[i] = to32(r[i], tr ? tr.has(i) : false);
      else if (changed) for (const i of changed) pal[i] = to32(r[i], tr ? tr.has(i) : false);
      const s = line * W;
      const d = (line + y0) * outW + x0;
      for (let x = 0; x < W; x++) out[d + x] = pal[idx[s + x]];
    });
    return image;
  }
}
