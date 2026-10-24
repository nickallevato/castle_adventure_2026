// AGA color registers: 256 registers, 24-bit RGB (0xRRGGBB, 8 bits per channel).
// Color cycling (DeluxePaint CRNG-style, optional smooth blend) and register fades live here.
//
// REGISTER MAP (normal rooms; see src/ui/art/moods.js for the values per area)
//   0        COLOR00: background / void / sky, driven per scanline by the copper (gradients)
//   1-7      sky ramp (dithered horizon glow, mist)
//   8-15     stars                                   cycle: twinkle
//   16-31    floor ramp, 16 shades dark -> light (shadows hue-shift cool, lights warm)
//   32-47    wall ramp, 16 shades
//   48-63    wood ramp, 16 shades
//   64-79    accent A ramp (foliage, carpet, tapestry, fabric), 16 shades
//   80-95    accent B ramp (trim, carved stone, gold, marble), 16 shades
//   96-111   torchlight on floor: 4 shade bands x 4 distance rings (palette-animated flicker per
//            vblank, each ring slightly delayed so the flicker rolls outward)
//   112-127  torchlight on walls: 4 shade bands x 4 rings
//   128-135  flames (torches, candles, the lamp)            cycle: fast flicker
//   136-143  water A (pools, fountain basin, moats)         cycle: ripples
//   144-151  water B (fountain jet, spray, drips)           cycle: faster
//   152-159  magic (crystal ball, wand, runes, fairies, vampire)  cycle: shimmer
//   160-167  treasure glint (mostly gold, one white flash)  cycle
//   168-175  light shafts and dust motes                    cycle: slow drift
//   176-183  leaves rustling (garden) / rainbow walls (secret room) / runes (tower)  cycle
//   184-191  sun dapples through leaves                     cycle (blend)
//   192-255  sprites and BOBs: outline, grays, skin, reds, golds, greens, blues, browns, purples,
//            cyans, pinks (fixed in every area; the player and monsters always read the same)
//
// DARK ROOMS (cellars, maze, dungeon) use the upper planes as a light mask instead:
//   0-63     room art at ambient darkness (planes 0-5)
//   64-127   the same art at the lamp halo's edge (plane 6 set)
//   128-191  the same art fully lit by the lamp (plane 7 set)
//   192-255  sprites (planes 6+7 both set; the halo masks never produce this)
//   The halo is a pair of dithered masks blitted into planes 6/7 around the player every frame, and
//   its flicker is palette animation of the 64-127 / 128-191 levels.
//
// STATUS STRIP (lines 216-255): the copper splits the palette at line 216 and reloads 0-31 with the
// strip's own colors; 8-15 hold the strength bar's cycling gradient.

export const NUM_REGS = 256;

export const rOf = (c) => (c >> 16) & 255;
export const gOf = (c) => (c >> 8) & 255;
export const bOf = (c) => c & 255;
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const rgb = (r, g, b) => (clamp8(r) << 16) | (clamp8(g) << 8) | clamp8(b);

/** Expand a register to [r, g, b]. */
export function expand(c) { return [rOf(c), gOf(c), bOf(c)]; }

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** Register value -> 32-bit RGBA word in ImageData byte order (alpha 0 when transparent). */
export function to32(c, transparent = false) {
  const r = rOf(c), g = gOf(c), b = bOf(c), a = transparent ? 0 : 255;
  return LITTLE_ENDIAN ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

export function lerpRGB(a, b, t) {
  return rgb(rOf(a) + (rOf(b) - rOf(a)) * t, gOf(a) + (gOf(b) - gOf(a)) * t, bOf(a) + (bOf(b) - bOf(a)) * t);
}

/** Multiply brightness (k may exceed 1), clamped. */
export function scaleRGB(c, k) { return rgb(rOf(c) * k, gOf(c) * k, bOf(c) * k); }

/** Additive light: c + light * k. */
export function addRGB(c, light, k = 1) {
  return rgb(rOf(c) + rOf(light) * k, gOf(c) + gOf(light) * k, bOf(c) + bOf(light) * k);
}

/** Multiply two colors channel-wise (light tinting a surface), then scale. */
export function mulRGB(c, light, k = 1) {
  return rgb((rOf(c) * rOf(light) * k) / 255, (gOf(c) * gOf(light) * k) / 255, (bOf(c) * bOf(light) * k) / 255);
}

/** "#rrggbb", "#rgb" or a number -> 0xRRGGBB. */
export function hex(v) {
  if (typeof v === "number") return v & 0xffffff;
  const s = v.replace("#", "");
  return parseInt(s.length === 3 ? [...s].map((ch) => ch + ch).join("") : s, 16) & 0xffffff;
}

/** Rotate registers lo..hi in place by `steps`; dir +1 moves each color up a register per step. */
export function rotateRange(regs, lo, hi, steps = 1, dir = 1) {
  const n = hi - lo + 1;
  if (n < 2) return regs;
  const s = (((steps * dir) % n) + n) % n;
  if (!s) return regs;
  const tmp = regs.slice(lo, hi + 1);
  for (let i = 0; i < n; i++) regs[lo + ((i + s) % n)] = tmp[i];
  return regs;
}

/**
 * Apply color cycles { lo, hi, rate, dir, blend } to a copy of `base` at vblank `tick` (50 Hz).
 * rate = steps per second. Stepped cycling moves whole registers on vblank boundaries; blend mixes
 * neighbors by the fractional step for a smooth flow (canvascycle-style).
 */
export function applyCycles(base, cycles, tick, out = base.slice()) {
  for (let i = 0; i < base.length; i++) out[i] = base[i];
  for (const cy of cycles || []) {
    const n = cy.hi - cy.lo + 1;
    if (n < 2 || !cy.rate) continue;
    const pos = (tick * cy.rate) / 50 + (cy.phase || 0);
    const whole = Math.floor(pos);
    const dir = cy.dir || 1;
    if (!cy.blend) {
      rotateRange(out, cy.lo, cy.hi, whole, dir);
    } else {
      const frac = pos - whole;
      const src = base.slice(cy.lo, cy.hi + 1);
      for (let i = 0; i < n; i++) {
        const a = src[(((i - whole * dir) % n) + n) % n];
        const b = src[(((i - (whole + 1) * dir) % n) + n) % n];
        out[cy.lo + i] = lerpRGB(a, b, frac);
      }
    }
  }
  return out;
}

/** Fade every register from -> to by t (0..1), smooth 8-bit steps. */
export function fadeRegs(from, to, t, out = new Array(from.length)) {
  const k = Math.max(0, Math.min(1, t));
  for (let i = 0; i < from.length; i++) out[i] = lerpRGB(from[i], to[i], k);
  return out;
}

/** An n-step ramp through evenly spaced key colors. */
export function ramp(keys, n) {
  const ks = keys.map(hex);
  if (n === 1) return [ks[0]];
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = (i / (n - 1)) * (ks.length - 1);
    const k = Math.min(ks.length - 2, Math.floor(p));
    out.push(lerpRGB(ks[k], ks[k + 1], p - k));
  }
  return out;
}
