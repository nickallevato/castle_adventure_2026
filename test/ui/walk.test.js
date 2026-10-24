import { test } from "node:test";
import assert from "node:assert/strict";
import { REPEAT_DELAY_MS, WALK_MS, createWalker, nextStep, walkPos } from "../../src/ui/walk.js";

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

test("a fresh press steps at once, even mid-step, so quick taps and turns are never dropped", () => {
  assert.equal(nextStep(500, 560, true, true), 560);
  assert.equal(nextStep(500, 560, true), null); // a held key still waits for the beat
});

test("a step taken mid-glide continues from where the sprite is, with no jump back", () => {
  const v = createWalker(0, 0);
  v.startFrom(0, 0, 1000);                       // glide 0 -> 12
  const mid = walkPos(v, TILE, 0, 1050).x;       // halfway
  v.startFrom(TILE, 0, 1050);                    // tap again: glide on toward 24
  assert.equal(walkPos(v, 2 * TILE, 0, 1050).x, mid);
  assert.equal(walkPos(v, 2 * TILE, 0, 1050 + WALK_MS).x, 2 * TILE);
});

test("a tap is exactly one step: holding from rest only repeats after REPEAT_DELAY_MS", () => {
  // simulate 60 Hz frames for a key held `ms` long, pressed from rest at t=1000
  const steps = (ms) => {
    let lastStep = nextStep(null, 1000, true, true, 1000), n = 1;
    for (let t = 1000 + 1000 / 60; t < 1000 + ms; t += 1000 / 60) {
      const due = nextStep(lastStep, t, true, false, 1000);
      if (due !== null) { lastStep = due; n++; }
    }
    return n;
  };
  for (const ms of [50, 100, 150, 200, REPEAT_DELAY_MS - 1]) assert.equal(steps(ms), 1, `${ms}ms tap`);
  assert.ok(steps(1000) >= 8, "holding still walks");
});
