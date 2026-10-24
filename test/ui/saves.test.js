import { test } from "node:test";
import assert from "node:assert/strict";
import { createSaveStore, memoryStorage, SLOTS } from "../../src/ui/saves.js";

const sample = () => ({
  status: "playing",
  player: { room: 17, row: 5, col: 8, facing: "east", strength: 73, maxStrength: 100, inventory: ["lamp", "sword"] },
  score: 40, treasuresFound: 2, treasuresTotal: 13,
  items: { lamp: { id: "lamp", name: "Lamp", treasure: false, room: null, row: 0, col: 0 } },
  monsters: { snake: { id: "snake", kind: "snake", name: "Snake", room: 17, row: 13, col: 16, strength: 60, alive: true } },
  visited: [1, 2, 3, 17], dev: { noclip: false, god: false },
});

test("autosave round-trips the full state", () => {
  const s = createSaveStore(memoryStorage());
  assert.equal(s.hasAutosave(), false);
  assert.equal(s.autosave(sample(), { room: 17, title: "North End of Castle Garden" }), true);
  const rec = s.loadAutosave();
  assert.deepEqual(rec.state, sample());
  assert.equal(rec.meta.room, 17);
  assert.equal(s.hasAutosave(), true);
});

test("manual slots round-trip independently and list their metadata", () => {
  const s = createSaveStore(memoryStorage());
  const a = sample(); const b = { ...sample(), score: 99 };
  s.save(1, a, { title: "One", score: 40 });
  s.save(3, b, { title: "Three", score: 99 });
  assert.deepEqual(s.load(1).state, a);
  assert.deepEqual(s.load(3).state, b);
  assert.equal(s.load(2), null);
  const list = s.list();
  assert.equal(list.length, SLOTS);
  assert.equal(list[0].title, "One");
  assert.equal(list[1], null);
  assert.equal(list[2].score, 99);
  s.remove(1);
  assert.equal(s.load(1), null);
  assert.throws(() => s.save(4, a), RangeError);
});

test("storage failures never throw", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("x"); } };
  const s = createSaveStore(broken);
  assert.equal(s.autosave(sample()), false);
  assert.equal(s.loadAutosave(), null);
  assert.deepEqual(s.list(), [null, null, null]);
  s.remove(2);
  const st = memoryStorage(); st.setItem("castle-adventure:auto", "{not json");
  assert.equal(createSaveStore(st).loadAutosave(), null);
});
