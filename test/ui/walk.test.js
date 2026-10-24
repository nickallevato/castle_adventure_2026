import { test } from "node:test";
import assert from "node:assert/strict";
import { WALK_MS, createWalker, nextStep, walkPos } from "../../src/ui/walk.js";

const TILE = 12;

// Hold a direction for `frames` display frames at `hz`, returning the rounded x per frame.
function holdRight(frames, hz) {
  const v = createWalker(0, 0);
  let tx = 0, lastStep = null;
  const xs = [];
  for (let f = 0; f < frames; f++) {
    const t = 1000 + (f * 1000) / hz;
    const due = nextStep(lastStep, t, true);
    if (due !== null) { lastStep = due; v.start(tx, 0, due); tx += TILE; }
    xs.push(Math.round(walkPos(v, tx, 0, t).x));
  }
  return xs;
}

test("holding a direction walks at a constant speed with no pause between tiles (60 Hz)", () => {
  const xs = holdRight(40, 60);
  const deltas = xs.slice(2).map((x, i) => x - xs[i + 1]);
  assert.ok(deltas.every((d) => d === deltas[0]), `uneven steps per frame: ${deltas.join(" ")}`);
  assert.ok(deltas[0] > 0);
});

test("a tile takes WALK_MS, so moves stay at or under 10 a second", () => {
  assert.ok(WALK_MS >= 100);
  const xs = holdRight(61, 60); // one second
  assert.ok(xs[60] <= 10 * TILE + TILE, `walked ${xs[60]}px in a second`);
});

test("starting from rest steps at once; after a pause the next step starts on the key press", () => {
  assert.equal(nextStep(null, 500, true), 500);
  assert.equal(nextStep(500, 560, true), null);
  assert.equal(nextStep(500, 600, true), 600);       // continuing: phase-locked to the last step
  assert.equal(nextStep(500, 2000, true), 2000);     // long gap: restart from now
  assert.equal(nextStep(500, 700, false), null);     // nothing held
});
