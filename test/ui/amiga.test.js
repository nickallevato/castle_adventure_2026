import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlanes, getPixel, setPixel, planesToIndices, planarFromIndices } from "../../src/ui/amiga/bitplanes.js";
import { blit, bobFromRows, mirrorBob } from "../../src/ui/amiga/blitter.js";
import { expand, to32, lerpRGB, rotateRange, applyCycles, fadeRegs, hex } from "../../src/ui/amiga/palette.js";
import { CopperList, CopperBuilder, regsAtLine, runCopper } from "../../src/ui/amiga/copper.js";
import { Display } from "../../src/ui/amiga/display.js";
import { drawText } from "../../src/ui/amiga/font.js";

test("planar pixel get/set: 8 planes, 40-byte rows, MSB leftmost, one bit per plane", () => {
  const bm = createPlanes(320, 256);
  assert.equal(bm.depth, 8);
  assert.equal(bm.bpr, 40);
  assert.equal(bm.planes.length, 8);
  assert.equal(bm.planes[0].length, 40 * 256);
  setPixel(bm, 0, 0, 0b10010101);
  assert.equal(bm.planes[0][0], 0x80);
  assert.equal(bm.planes[1][0], 0);
  assert.equal(bm.planes[2][0], 0x80);
  assert.equal(bm.planes[4][0], 0x80);
  assert.equal(bm.planes[7][0], 0x80);
  assert.equal(bm.planes[6][0], 0);
  setPixel(bm, 9, 1, 255);
  for (let p = 0; p < 8; p++) assert.equal(bm.planes[p][40 + 1], 0x40);
  assert.equal(getPixel(bm, 0, 0), 0b10010101);
  assert.equal(getPixel(bm, 9, 1), 255);
  assert.equal(getPixel(bm, 8, 1), 0);
  setPixel(bm, 9, 1, 130);
  assert.equal(getPixel(bm, 9, 1), 130);
});

test("planes -> chunky conversion matches getPixel everywhere", () => {
  const bm = createPlanes(32, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 32; x++) setPixel(bm, x, y, (x * 37 + y * 91) & 255);
  const idx = planesToIndices(bm);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 32; x++) assert.equal(idx[y * 32 + x], getPixel(bm, x, y));
});

test("masked blit (minterm 0xCA) cookie-cuts at unaligned x and keeps the background", () => {
  const dst = createPlanes(32, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 32; x++) setPixel(dst, x, y, 9);
  const bob = bobFromRows(["3.3", ".7.", "..."], { 3: 3, 7: 200 });
  blit(dst, bob, 13, 1);
  assert.equal(getPixel(dst, 13, 1), 3);
  assert.equal(getPixel(dst, 14, 1), 9, "transparent pixel keeps background");
  assert.equal(getPixel(dst, 15, 1), 3);
  assert.equal(getPixel(dst, 14, 2), 200);
  assert.equal(getPixel(dst, 13, 2), 9);
  assert.equal(getPixel(dst, 13, 3), 9, "fully transparent row");
  assert.equal(getPixel(dst, 12, 1), 9);
  assert.equal(getPixel(dst, 16, 1), 9);
  // clipping at the left edge
  blit(dst, bob, -2, 0);
  assert.equal(getPixel(dst, 0, 0), 3);
  assert.equal(getPixel(dst, 1, 0), 9);
  const m = mirrorBob(bobFromRows(["12."], { 1: 1, 2: 2 }));
  assert.deepEqual([0, 1, 2].map((x) => planesToIndices(m)[x]), [0, 2, 1]);
});

test("planarFromIndices treats negative indices as transparent", () => {
  const b = planarFromIndices(3, 1, [5, -1, 255]);
  assert.equal(b.mask[0], 0b10100000);
  assert.equal(getPixel(b, 2, 0), 255);
});

test("AGA registers are 24-bit RGB and fade smoothly in 8-bit steps", () => {
  assert.deepEqual(expand(0xff8800), [255, 136, 0]);
  assert.deepEqual(expand(0x123456), [0x12, 0x34, 0x56]);
  assert.equal(hex("#abc"), 0xaabbcc);
  assert.equal(lerpRGB(0x000000, 0xffffff, 0.5), 0x808080);
  assert.equal(lerpRGB(0x000000, 0x0000ff, 0.25), 0x000040);
  assert.equal(to32(0xffffff) >>> 0, 0xffffffff);
  const w = new Uint8Array(new Uint32Array([to32(0x102030)]).buffer);
  assert.deepEqual([...w], [0x10, 0x20, 0x30, 255]);
  assert.deepEqual(fadeRegs([0x000000], [0xff00ff], 1), [0xff00ff]);
  assert.deepEqual(fadeRegs([0x000000], [0xff00ff], 0.5), [0x800080]);
});

test("a color cycle step rotates registers lo..hi in the given direction", () => {
  const regs = [0, 1, 2, 3, 4, 5];
  rotateRange(regs, 1, 4, 1, 1);
  assert.deepEqual(regs, [0, 4, 1, 2, 3, 5]);
  rotateRange(regs, 1, 4, 1, -1);
  assert.deepEqual(regs, [0, 1, 2, 3, 4, 5]);
  // 10 steps per second on a 50 Hz vblank: one step after 5 ticks
  const base = [0x000000, 0x111111, 0x222222, 0x333333];
  assert.deepEqual(applyCycles(base, [{ lo: 1, hi: 3, rate: 10 }], 4), base);
  assert.deepEqual(applyCycles(base, [{ lo: 1, hi: 3, rate: 10 }], 5), [0x000000, 0x333333, 0x111111, 0x222222]);
  const half = applyCycles(base, [{ lo: 1, hi: 3, rate: 10, blend: true }], 2.5);
  assert.equal(half[2], lerpRGB(0x222222, 0x111111, 0.5));
});

test("copper MOVEs take effect at their WAIT line, for any of the 256 registers", () => {
  const base = new Array(256).fill(0);
  const cl = new CopperList().move(0, 0x100000).wait(10).move(0, 0x200000).move(200, 0xabcdef).wait(20).move(0, 0x300000).end();
  assert.equal(regsAtLine(cl, base, 0)[0], 0x100000);
  assert.equal(regsAtLine(cl, base, 9)[0], 0x100000);
  assert.equal(regsAtLine(cl, base, 9)[200], 0);
  assert.equal(regsAtLine(cl, base, 10)[0], 0x200000);
  assert.equal(regsAtLine(cl, base, 10)[200], 0xabcdef);
  assert.equal(regsAtLine(cl, base, 25)[0], 0x300000);
  const b = new CopperBuilder().move(30, 1, 0xff0000).move(5, 1, 0x00ff00).build();
  assert.equal(regsAtLine(b, base, 4)[1], 0);
  assert.equal(regsAtLine(b, base, 5)[1], 0x00ff00);
  assert.equal(regsAtLine(b, base, 30)[1], 0xff0000);
  const changed = [];
  runCopper(b, base, 40, (l, r, c) => { if (c) changed.push([l, c]); });
  assert.deepEqual(changed, [[0, "all"], [5, [1]], [30, [1]]]);
});

test("display converts 8 planes through 256 registers and the copper per scanline", () => {
  const bm = createPlanes(16, 2);
  setPixel(bm, 0, 0, 201); setPixel(bm, 0, 1, 201);
  const d = new Display(bm);
  const img = { width: 16, height: 2, data: new Uint8ClampedArray(16 * 2 * 4) };
  const regs = new Array(256).fill(0); regs[201] = 0xff0000;
  d.render(img, regs, new CopperList().wait(1).move(201, 0x0000ff).end());
  assert.deepEqual([...img.data.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...img.data.slice(64, 68)], [0, 0, 255, 255]);
  drawText(bm, "A", 2, 0, 3);
  d.render(img, regs, null);
  assert.ok(d.indices.some((v) => v === 3));
});
