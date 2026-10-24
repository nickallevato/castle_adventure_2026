// Walking between tiles. Steps are phase-locked while a direction is held, and the sprite glides
// linearly, so a held key walks at one even speed: 12px per 100ms is exactly 2 lowres pixels per
// 60 Hz frame (1 per frame at 120 Hz), with no ease-out or pause at each tile.

export const WALK_MS = 100;
// A tap is one step: holding a key from rest only starts walking after this delay, like keyboard
// auto-repeat. Taps commonly last 80-150ms, so without it a tap was randomly one or two steps.
export const REPEAT_DELAY_MS = 250;

/**
 * When the next step should happen, or null if not yet. lastStep is the time of the previous step
 * (null if none). A fresh key press always steps at once, so quick taps and turns are never dropped
 * or delayed. While a key is held the step lands exactly WALK_MS after the last one, even if this
 * frame is a little late; after a pause the step happens now. pressedAt is when the key was pressed
 * from rest (no other direction held): held steps wait until REPEAT_DELAY_MS after it.
 */
export function nextStep(lastStep, t, held, fresh = false, pressedAt = null) {
  if (!held) return null;
  if (fresh) return t;
  if (pressedAt != null && t - pressedAt < REPEAT_DELAY_MS) return null;
  if (lastStep == null || t - lastStep >= 2 * WALK_MS) return t;
  if (t - lastStep >= WALK_MS) return lastStep + WALK_MS;
  return null;
}

export function createWalker(x, y) {
  return {
    x, y, fx: x, fy: y, t0: null, step: 0,
    /** Begin gliding from (fx, fy) at time t0 toward whatever target walkPos is given. */
    start(fx, fy, t0) { this.fx = fx; this.fy = fy; this.t0 = t0; this.step++; },
    walking(t) { return this.t0 != null && t - this.t0 < WALK_MS; },
    /** Begin the next glide from wherever the sprite is now (mid-glide after a quick tap or turn). */
    startFrom(tx, ty, t0) { if (this.walking(t0)) walkPos(this, tx, ty, t0); else { this.x = tx; this.y = ty; } this.start(this.x, this.y, t0); },
  };
}

/** Position at time t, gliding toward the target (tx, ty). Updates and returns the walker. */
export function walkPos(v, tx, ty, t) {
  const k = v.t0 == null ? 1 : Math.max(0, Math.min(1, (t - v.t0) / WALK_MS));
  v.x = v.fx + (tx - v.fx) * k;
  v.y = v.fy + (ty - v.fy) * k;
  return v;
}
