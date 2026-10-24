import { test } from "node:test";
import assert from "node:assert/strict";
import { newGame, placed, move, verb, typed, texts, said, player, pos, ROOMS } from "./helpers/setup.mjs";
import { createGame, MAX_STRENGTH } from "../../src/engine/index.js";

const SPEC_ITEMS = ["book", "crystal_ball", "glasses", "helmet", "key", "lamp", "magic_wand", "sword",
  "wine_flask", "crown", "diamond", "goblet", "goldbar", "harp", "holy_cross", "hourglass",
  "jade_figurine", "large_gem", "necklace", "ruby", "scepter", "silver_bars"];
const SPEC_KINDS = ["demon", "ogre", "spider_big", "spider_small", "snake", "bat", "vampire", "fairy", "door"];

test("a new game starts playing in the courtyard", () => {
  const s = newGame().getState();
  assert.equal(s.status, "playing");
  assert.deepEqual([s.player.room, s.player.row, s.player.col], [1, 14, 14]);
  assert.equal(s.player.strength, MAX_STRENGTH);
  assert.equal(s.player.maxStrength, 100);
  assert.deepEqual(s.player.inventory, []);
  assert.deepEqual(s.visited, [1]);
  assert.equal(s.score, 0);
  assert.equal(s.treasuresFound, 0);
  assert.equal(s.treasuresTotal, 13);
  assert.deepEqual(s.dev, { noclip: false, god: false });
});

test("items and monsters use the spec's ids and kinds", () => {
  const s = newGame().getState();
  assert.deepEqual(Object.keys(s.items).sort(), [...SPEC_ITEMS].sort());
  for (const it of Object.values(s.items)) {
    assert.equal(typeof it.name, "string");
    assert.equal(typeof it.treasure, "boolean");
    assert.ok("room" in it && "row" in it && "col" in it);
  }
  assert.equal(Object.values(s.items).filter((i) => i.treasure).length, 13);
  const kinds = new Set(Object.values(s.monsters).map((m) => m.kind));
  for (const k of kinds) assert.ok(SPEC_KINDS.includes(k), k);
  for (const k of SPEC_KINDS) assert.ok(kinds.has(k), k);
  for (const m of Object.values(s.monsters)) assert.ok(["id", "kind", "name", "room", "row", "col", "strength", "alive"]
    .every((f) => f in m));
});

test("starting positions come from the original's DATA statements", () => {
  const s = newGame().getState();
  assert.deepEqual([s.items.lamp.room, s.items.lamp.row, s.items.lamp.col], [17, 13, 18]);
  assert.deepEqual([s.items.sword.room, s.items.sword.row, s.items.sword.col], [12, 4, 10]);
  assert.deepEqual([s.items.scepter.room, s.items.scepter.row, s.items.scepter.col], [83, 9, 11]);
  assert.equal(s.items.key.room, null);
  assert.equal(s.items.key.hidden, true);
  assert.equal(s.items.key.hiddenIn, 56);
  const m = s.monsters;
  assert.deepEqual([m.ogre1.room, m.ogre1.strength], [4, 80]);
  assert.deepEqual([m.demon1.room, m.demon1.strength], [14, 120]);
  assert.deepEqual([m.bat.room, m.bat.strength], [68, 10]);
  assert.deepEqual([m.vampire.room, m.vampire.row, m.vampire.col], [28, 9, 23]);
  assert.equal(m.fairy.room, null);
});

test("moving onto floor, into walls, and diagonally", () => {
  const g = newGame();
  move(g, "north");
  assert.deepEqual(pos(g), [1, 13, 14]);
  assert.equal(player(g).facing, "north");
  move(g, "northeast");
  assert.deepEqual(pos(g), [1, 12, 15]);
  assert.equal(player(g).facing, "east");
  g.dev.teleport(1, 1, 1);
  move(g, "west"); // the courtyard wall
  assert.deepEqual(pos(g), [1, 1, 1]);
  move(g, "northwest");
  assert.deepEqual(pos(g), [1, 1, 1]);
  assert.throws(() => move(g, "sideways"));
});

test("walking off an edge through an opening takes that exit", () => {
  const g = placed(1, 0, 11);
  const ev = move(g, "north");
  assert.deepEqual(pos(g), [2, 17, 11]);
  const changed = ev.find((e) => e.type === "roomChanged");
  assert.deepEqual([changed.from, changed.to], [1, 2]);
  assert.match(changed.description, /Entrance room/);
  assert.ok(texts(ev).some((t) => /Entrance room/.test(t)));
  assert.deepEqual(g.getState().visited, [1, 2]);
  move(g, "south");
  assert.deepEqual(pos(g), [1, 0, 11]);
  assert.deepEqual(g.getState().visited, [1, 2]);
  // west and east keep the row
  g.dev.teleport(3, 8, 0);
  move(g, "west");
  assert.deepEqual(pos(g), [4, 8, 23]);
  move(g, "east");
  assert.deepEqual(pos(g), [3, 8, 0]);
});

test("stepping on stairs takes the up or down exit and keeps your spot", () => {
  const g = placed(4, 3, 19);
  move(g, "east"); // onto the U at (3,20)
  assert.deepEqual(pos(g), [20, 3, 19]);
  const g2 = placed(20, 3, 19);
  move(g2, "east"); // onto the D
  assert.deepEqual(pos(g2), [4, 3, 19]);
});

test("the wine cellar is too dark without the lamp", () => {
  const g = placed(11, 6, 3);
  const ev = move(g, "west"); // the stairs down to the cellar
  assert.deepEqual(pos(g), [11, 6, 3]);
  assert.equal(said(ev), "It's too dark to go that way!");
  const g2 = placed(11, 6, 3, ["lamp"]);
  move(g2, "west");
  assert.deepEqual(pos(g2), [68, 6, 3]);
  // coming up from the passage is just as dark
  const g3 = placed(69, 0, 9);
  move(g3, "north");
  assert.equal(pos(g3)[0], 69);
});

test("running into a visible item picks it up", () => {
  const g = placed(12, 4, 9);
  const ev = move(g, "east");
  assert.deepEqual(ev.filter((e) => e.type === "took").map((e) => e.item), ["sword"]);
  assert.deepEqual(player(g).inventory, ["sword"]);
  assert.deepEqual(pos(g), [12, 4, 9]); // you don't move into its cell
  const it = g.getState().items.sword;
  assert.equal(it.room, null);
});

test("take: next to an item, too far away, already carried", () => {
  const g = placed(12, 6, 10);
  assert.equal(said(verb(g, "take", { item: "sword" })), "Get it Yourself!");
  g.dev.teleport(12, 5, 11);
  const ev = verb(g, "take", { item: "sword" });
  assert.ok(ev.some((e) => e.type === "took" && e.item === "sword"));
  assert.equal(said(verb(g, "take", { item: "sword" })), "You already have it!");
  assert.equal(said(verb(g, "take", { item: "lamp" })), "I don't see a LAMP");
});

test("you can carry six things", () => {
  const g = newGame();
  for (const id of ["lamp", "harp", "book", "magic_wand", "key", "glasses"]) g.dev.giveItem(id);
  g.dev.teleport(12, 5, 11);
  const ev = verb(g, "take", { item: "sword" });
  assert.equal(said(ev), "Can't carry any more!");
  assert.equal(player(g).inventory.length, 6);
  const ev2 = move(g, "northwest"); // run into it
  assert.equal(said(ev2), "Can't carry any more!");
});

test("drop puts the item down where you last moved toward", () => {
  const g = placed(1, 10, 10, ["crown"]);
  assert.equal(said(verb(g, "drop", { item: "crown" })), "Something is in the way!"); // haven't moved yet
  move(g, "east");
  const ev = verb(g, "drop", { item: "crown" });
  assert.deepEqual(ev.filter((e) => e.type === "dropped").map((e) => e.item), ["crown"]);
  assert.equal(said(ev), "Done.");
  const it = g.getState().items.crown;
  assert.deepEqual([it.room, it.row, it.col], [1, 10, 12]);
  assert.deepEqual(player(g).inventory, []);
  assert.equal(said(verb(g, "drop", { item: "crown" })), "You don't have a CROWN");
  // facing a wall
  g.dev.giveItem("harp");
  g.dev.teleport(1, 1, 1);
  move(g, "west");
  assert.equal(said(verb(g, "drop", { item: "harp" })), "Something is in the way!");
});

test("treasures count while carried or lying in the courtyard", () => {
  const g = placed(1, 10, 10);
  const ev = g.dev.giveItem("crown");
  assert.equal(g.getState().treasuresFound, 1);
  assert.equal(g.getState().score, 50);
  assert.ok(ev.some((e) => e.type === "scored" && e.points === 50));
  move(g, "east");
  verb(g, "drop", { item: "crown" });
  assert.equal(g.getState().score, 50); // still in the courtyard
  verb(g, "take", { item: "crown" });
  g.dev.teleport(2, 8, 8);
  move(g, "east");
  const ev2 = verb(g, "drop", { item: "crown" });
  assert.equal(g.getState().treasuresFound, 0);
  assert.ok(ev2.some((e) => e.type === "scored" && e.points === -50));
  // tools are not treasures
  g.dev.giveItem("lamp");
  assert.equal(g.getState().score, 0);
});

test("the inventory command lists what you carry", () => {
  const g = newGame();
  assert.deepEqual(texts(verb(g, "inventory")), ["- Inventory -", "Nothing."]);
  g.dev.giveItem("lamp");
  g.dev.giveItem("magic_wand");
  assert.deepEqual(texts(verb(g, "inventory")), ["- Inventory -", "♠ LAMP", "- MAGIC WAND"]);
  assert.deepEqual(texts(typed(g, "INVENTORY")), ["- Inventory -", "♠ LAMP", "- MAGIC WAND"]);
});

test("the typed parser takes the original's two-word commands", () => {
  const g = newGame();
  assert.equal(said(typed(g, "jump")), "What???");
  assert.equal(said(typed(g, "dance wildly")), "What???");
  assert.equal(said(typed(g, "eat bread")), "I'm not hungry!");
  assert.equal(said(typed(g, "look sky")), "I can't see a SKY, and I don't have a SKY!");
  assert.equal(said(typed(g, "climb wall")), "I don't need to climb.");
  assert.equal(said(typed(g, "look floor")), "The FLOORS are made of Gray Stone.");
  assert.equal(said(typed(g, "look walls")), "Writing on the wall says... | No high score");
});

test("the high score on the courtyard wall comes from the options", () => {
  const g = newGame({ highScore: { name: "CHRIS SMART", points: 1500 } });
  assert.equal(said(verb(g, "look", { target: "wall" })), "Writing on the wall says... | CHRIS SMART 1500");
});

test("state round-trips through JSON and plays on identically", () => {
  const a = newGame({ seed: 99 });
  a.dev.teleport(4, 8, 8);
  a.dev.giveItem("sword");
  for (let i = 0; i < 5; i++) a.tick(500);
  const saved = JSON.parse(JSON.stringify(a.getState()));
  const b = newGame({ seed: 12345 });
  b.load(saved);
  assert.deepEqual(b.getState(), a.getState());
  const script = [["tick", 500], ["move", "east"], ["tick", 500], ["move", "east"], ["tick", 700], ["move", "south"],
    ["tick", 1500], ["move", "east"], ["tick", 2000]];
  for (const [kind, arg] of script) {
    const ea = kind === "tick" ? a.tick(arg) : a.act({ type: "move", dir: arg });
    const eb = kind === "tick" ? b.tick(arg) : b.act({ type: "move", dir: arg });
    assert.deepEqual(eb, ea);
  }
  assert.deepEqual(b.getState(), a.getState());
});

test("getState is a copy and load rejects junk", () => {
  const g = newGame();
  const s = g.getState();
  s.player.room = 50;
  assert.equal(g.getState().player.room, 1);
  assert.throws(() => g.load(null));
  assert.throws(() => g.load({ version: 1 }));
  assert.throws(() => g.load({ ...g.getState(), version: 999 }));
});

test("the same seed gives the same game", () => {
  const run = (seed) => {
    const g = placed(4, 9, 9, ["sword"], { seed });
    const ev = [];
    for (let i = 0; i < 40; i++) {
      ev.push(...g.tick(250));
      ev.push(...g.act({ type: "move", dir: "east" }));
    }
    return JSON.stringify(ev) + JSON.stringify(g.getState());
  };
  assert.equal(run(5), run(5));
  assert.notEqual(run(5), run(6));
});

test("dev: noclip, god, teleport, giveItem, setStrength", () => {
  const g = newGame();
  g.dev.setNoclip(true);
  g.dev.teleport(1, 1, 1);
  move(g, "west");
  assert.deepEqual(pos(g), [1, 1, 0]);
  assert.equal(g.getState().dev.noclip, true);
  g.dev.setNoclip(false);
  g.dev.setGod(true);
  assert.equal(g.getState().dev.god, true);
  const ev = g.dev.teleport(14);
  assert.ok(ev.some((e) => e.type === "roomChanged" && e.to === 14));
  const [room, r, c] = pos(g);
  assert.equal(room, 14);
  assert.equal(ROOMS[13].map[r][c], " ");
  g.dev.giveItem("key");
  assert.ok(player(g).inventory.includes("key"));
  assert.equal(g.getState().items.key.hidden, false);
  g.dev.setStrength(42);
  assert.equal(player(g).strength, 42);
  assert.throws(() => g.dev.teleport(999));
  assert.throws(() => g.dev.giveItem("banana"));
});

test("dev teleport always lands on reachable floor", () => {
  const g = newGame();
  for (const room of ROOMS) {
    g.dev.teleport(room.id);
    const [, r, c] = pos(g);
    assert.equal(room.map[r][c], " ", `room ${room.id}`);
  }
});

test("act and tick do nothing once the game is over", () => {
  const g = placed(1, 16, 11, ["scepter"]);
  verb(g, "wave", { item: "scepter" });
  move(g, "south");
  move(g, "south");
  assert.equal(g.getState().status, "escaped");
  assert.deepEqual(move(g, "north"), []);
  assert.deepEqual(g.tick(10000), []);
  assert.deepEqual(g.availableActions(), []);
});

test("createGame needs the rooms", () => {
  assert.throws(() => createGame({}));
});
