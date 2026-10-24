import { test } from "node:test";
import assert from "node:assert/strict";
import { placed, move, verb, texts, said, player } from "./helpers/setup.mjs";
import { MONSTER_STEP_MS } from "../../src/engine/index.js";

const ogre = (g) => g.getState().monsters.ogre1; // starts in room 4 at (8,12)

test("monsters walk toward you, one step per monster tick, diagonals included", () => {
  const g = placed(4, 3, 5);
  assert.deepEqual(g.tick(MONSTER_STEP_MS - 1), []);
  assert.deepEqual([ogre(g).row, ogre(g).col], [8, 12]);
  g.tick(1);
  assert.deepEqual([ogre(g).row, ogre(g).col], [7, 11]);
  g.tick(MONSTER_STEP_MS * 3);
  assert.deepEqual([ogre(g).row, ogre(g).col], [4, 8]);
  // other rooms' monsters stay put
  assert.deepEqual([g.getState().monsters.demon1.row, g.getState().monsters.demon1.col], [6, 12]);
});

test("monsters can't walk through items, walls or each other", () => {
  const g = placed(4, 8, 2, ["crown"]);
  move(g, "east");
  verb(g, "drop", { item: "crown" }); // crown at (8,4)
  g.dev.teleport(4, 8, 3);
  // ogre walks west along row 8 until the crown stops it
  g.tick(MONSTER_STEP_MS * 20);
  assert.deepEqual([ogre(g).row, ogre(g).col], [8, 5]);
});

test("without a weapon you can't fight", () => {
  const g = placed(4, 8, 11);
  assert.equal(said(move(g, "east")), "You have no Weapon!");
  assert.equal(ogre(g).strength, 80);
});

test("with the sword you strike and kill; the body stays and scores 100", () => {
  const g = placed(4, 8, 11, ["sword"]);
  g.dev.setGod(true);
  const seen = new Set();
  for (let i = 0; i < 200 && ogre(g).alive; i++) {
    const ev = move(g, "east");
    for (const t of texts(ev)) seen.add(t);
    const hit = ev.find((e) => e.type === "hit");
    assert.ok(hit, "every swing reports a hit event");
    assert.equal(hit.by, "player");
    assert.equal(hit.target, "ogre1");
  }
  assert.ok(seen.has("You struck the OGRE!"));
  assert.ok(seen.has("You Killed the OGRE!"));
  const o = ogre(g);
  assert.equal(o.alive, false);
  assert.ok(o.strength < 0);
  assert.deepEqual([o.room, o.row, o.col], [4, 8, 12]);
  assert.equal(g.getState().score, 100);
  // the body blocks the way and does nothing
  assert.deepEqual(move(g, "east"), []);
  assert.deepEqual([player(g).row, player(g).col], [8, 11]);
  assert.equal(g.describe(4, 8, 12), "Dead Ogre");
  assert.equal(said(verb(g, "look", { target: "ogre" })), "The OGRE looks Dead!");
  g.tick(MONSTER_STEP_MS * 5);
  assert.deepEqual([ogre(g).row, ogre(g).col], [8, 12]);
});

test("a monster next to you attacks on its tick; hits say so and cost strength", () => {
  const g = placed(4, 8, 11, [], { seed: 3 });
  const seen = new Set();
  let damage = 0;
  for (let i = 0; i < 30 && g.getState().status === "playing"; i++) {
    g.dev.setStrength(100);
    const ev = g.tick(MONSTER_STEP_MS);
    for (const t of texts(ev)) seen.add(t);
    for (const e of ev.filter((x) => x.type === "hit")) {
      assert.equal(e.by, "ogre1");
      assert.equal(e.target, "player");
      assert.ok(e.damage >= -5 && e.damage <= 19);
      damage += e.damage;
    }
  }
  assert.ok(seen.has("The OGRE Struck you!"));
  assert.ok(damage > 0);
});

test("the helmet helps", () => {
  const g = placed(4, 8, 11, ["helmet"], { seed: 3 });
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    g.dev.setStrength(100);
    for (const t of texts(g.tick(MONSTER_STEP_MS))) seen.add(t);
  }
  assert.ok(seen.has("The OGRE Struck you!"));
  assert.ok(seen.has("The Helmet helped."));
});

test("god mode: monsters do no damage", () => {
  const g = placed(4, 8, 11);
  g.dev.setGod(true);
  for (let i = 0; i < 30; i++) g.tick(MONSTER_STEP_MS);
  assert.equal(player(g).strength, 100);
});

test("dying to a monster ends the game", () => {
  const g = placed(4, 8, 11, [], { seed: 2 });
  g.dev.setStrength(0);
  let ev = [];
  for (let i = 0; i < 100 && g.getState().status === "playing"; i++) ev = g.tick(MONSTER_STEP_MS);
  const s = g.getState();
  assert.equal(s.status, "dead");
  assert.ok(s.player.strength < 0);
  assert.ok(ev.some((e) => e.type === "died"));
  const t = texts(ev);
  assert.ok(t.includes("The OGRE has Killed you!"));
  assert.ok(t.includes("You're have failed to Escape!"));
  assert.ok(t.includes("Your Score: 0"));
  assert.ok(t.includes("(1550 is perfect)"));
  assert.ok(ev.some((e) => e.type === "gameOver" && e.status === "dead"));
});

test("vampire, fairy and doors can't be fought", () => {
  const g = placed(28, 9, 22, ["sword"]);
  assert.equal(said(move(g, "east")), "The Vampire is blocking your way. He can't be hurt.");
  assert.equal(g.getState().monsters.vampire.strength, 1);
  g.tick(MONSTER_STEP_MS * 5);
  assert.deepEqual([g.getState().monsters.vampire.row, g.getState().monsters.vampire.col], [9, 23]);
});

test("monster names in messages are their last word, as the original printed them", () => {
  const g = placed(73, 13, 16, ["sword"]);
  g.dev.setGod(true);
  const all = [];
  for (let i = 0; i < 300 && g.getState().monsters.spider_big.alive; i++) all.push(...texts(move(g, "east")));
  assert.ok(all.includes("You Killed the SPIDER!"));
});
