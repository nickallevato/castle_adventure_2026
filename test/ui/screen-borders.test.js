import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Minimal canvas stand-ins so the emulated screen can render headless.
class ImageData { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } }
const ctx = { createImageData: (w, h) => new ImageData(w, h), putImageData() {}, drawImage() {} };
globalThis.window ??= { devicePixelRatio: 1 };
globalThis.document ??= { createElement: () => ({ getContext: () => ctx, width: 0, height: 0 }) };

const { GameScreen, PF_X, STRIP_Y, SCREEN_W } = await import("../../src/ui/screen.js");
const { buildRoom, PW } = await import("../../src/ui/art/room-builder.js");
const { getPixel } = await import("../../src/ui/amiga/bitplanes.js");
const { createGame } = await import("../../src/engine/index.js");
const rooms = JSON.parse(readFileSync(new URL("../../data/rooms.json", import.meta.url)));
const game = createGame({ rooms, seed: 1 });
const room = (id) => buildRoom(id, game.tileGrid(id));

function borderPixels(P) {
  let n = 0;
  for (let y = 0; y < STRIP_Y; y++)
    for (let x = 0; x < SCREEN_W; x++) if ((x < PF_X || x >= PF_X + PW) && getPixel(P, x, y)) n++;
  return n;
}

// The playfield is copied in fresh each frame, but the side borders are not: a lamp halo (or a
// sprite) drawn past the playfield edge used to stay there, glowing on every screen after.
test("nothing drawn past the playfield edge is left in the side borders", () => {
  const dark = room(70), lit = room(1);
  assert.ok(dark.dark && !lit.dark);
  const scr = new GameScreen({ getContext: () => ctx, style: {}, dataset: {} });
  scr.setRoom(dark, { instant: true });
  scr.frame(1000, [], [], { x: 0, y: 100 });            // player at the west edge
  scr.frame(1020, [], [], { x: PW - 12, y: 100 });      // and the east edge
  assert.equal(borderPixels(scr.planes), 0, "halo left in the border");
  scr.setRoom(lit, { instant: true });
  scr.frame(1040);
  assert.equal(borderPixels(scr.planes), 0, "border not clear in the next room");
});
