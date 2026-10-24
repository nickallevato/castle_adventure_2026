import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Minimal canvas stand-ins so the emulated screen can render headless.
class ImageData { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } }
const ctx = { createImageData: (w, h) => new ImageData(w, h), putImageData() {}, drawImage() {} };
globalThis.window ??= { devicePixelRatio: 1 };
globalThis.document ??= { createElement: () => ({ getContext: () => ctx, width: 0, height: 0 }) };

const { GameScreen } = await import("../../src/ui/screen.js");
const { buildRoom } = await import("../../src/ui/art/room-builder.js");
const { createGame } = await import("../../src/engine/index.js");
const rooms = JSON.parse(readFileSync(new URL("../../data/rooms.json", import.meta.url)));

function render(roomId, t) {
  const scr = new GameScreen({ getContext: () => ctx, style: {}, dataset: {} });
  scr.setRoom(buildRoom(roomId, createGame({ rooms, seed: 1 }).tileGrid(roomId)), { instant: true });
  scr.frame(t);
  return Buffer.from(scr.image.data);
}

// A 60 Hz display shows frames 16.7ms apart, but the 50 Hz vblank only ticks every 20ms. Smooth
// (blended) cycles and torch flicker must follow real time, or one frame in six repeats the last.
test("blended cycling moves between frames inside one 50 Hz tick", () => {
  for (const id of [18, 14]) { // the garden fountain, the torchlit throne room
    const a = render(id, 1000), b = render(id, 1010); // both in vblank tick 50
    assert.notDeepEqual(a, b, `room ${id} did not change within a tick`);
  }
});
