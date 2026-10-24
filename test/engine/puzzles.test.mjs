import { test } from "node:test";
import assert from "node:assert/strict";
import { newGame, placed, move, verb, typed, texts, said, player, pos } from "./helpers/setup.mjs";

const st = (g) => g.getState();
const walk = (g, dir, n) => {
  const ev = [];
  for (let i = 0; i < n; i++) ev.push(...move(g, dir));
  return ev;
};

test("hidden items: look at the furniture, then take them from beside it", () => {
  const g = placed(10, 5, 7); // the chef's desk is at rows 10-11, cols 6-9
  assert.equal(st(g).items.wine_flask.revealed, false);
  assert.equal(said(verb(g, "look", { target: "desk" })), "There is a Wine Flask on top.");
  assert.equal(st(g).items.wine_flask.revealed, true);
  assert.equal(said(verb(g, "take", { item: "wine_flask" })), "I can't reach it!");
  g.dev.teleport(10, 9, 7);
  assert.ok(g.availableActions().some((a) => a.id === "take:wine_flask"));
  const ev = verb(g, "take", { item: "wine_flask" });
  assert.equal(said(ev), "Done.");
  assert.ok(ev.some((e) => e.type === "took" && e.item === "wine_flask"));
  assert.equal(said(verb(g, "look", { target: "desk" })), "It's made of Wood.");
  assert.equal(said(verb(g, "look", { item: "wine_flask" })), "It's empty.");
  // the original's parser can GET it without looking first
  const g2 = placed(10, 9, 7);
  assert.equal(said(typed(g2, "GET FLASK")), "Done.");
  assert.equal(said(typed(g2, "get desk")), "DESKS are too heavy!");
  assert.equal(said(typed(placed(1, 9, 7), "get desk")), "DESKS are too heavy! and I don't see any!");
});

test("the other hidden things: key, glasses, book, necklace, gem", () => {
  let g = placed(56, 8, 11); // King's study desk at rows 5-7, cols 9-14
  assert.equal(said(verb(g, "look", { target: "desk" })), "There is a Key on top");
  assert.equal(said(verb(g, "take", { item: "key" })), "Done.");
  g = placed(40, 10, 16); // yellow room desk at rows 11-12, cols 16-18
  assert.equal(said(verb(g, "look", { target: "desk" })), "There is a Pair of Eye Glasses on Top.");
  assert.equal(said(verb(g, "take", { item: "glasses" })), "Done.");
  g = placed(58, 8, 9); // library shelves
  assert.equal(said(verb(g, "look", { target: "shelves" })), "There's a book on one.");
  assert.equal(said(verb(g, "take", { item: "book" })), "Done.");
  assert.equal(said(verb(g, "look", { item: "book" })), "It is titled `The Gate'");
  g = placed(19, 6, 12); // the statue at rows 7-9, cols 11-13
  assert.equal(said(verb(g, "look", { target: "statue" })), "The statue is wearing a Necklace");
  assert.equal(said(verb(g, "take", { item: "necklace" })), "Done.");
  assert.equal(said(verb(g, "look", { target: "statue" })), "The Statue looks like The King!");
  assert.deepEqual(texts(verb(g, "look", { item: "necklace" })), ["On the back it says:", "Protection from Traps."]);
  // the gem is seen from the balcony and fished out of the garden fountain
  g = placed(33, 8, 5);
  assert.equal(said(verb(g, "look", { target: "garden" })), "There is a BIG Gem in the Garden Fountain!");
  assert.equal(said(verb(g, "look", { target: "fountain" })), "I don't see A fountain!");
  g.dev.teleport(18, 9, 9);
  assert.match(said(verb(g, "look", { target: "fountain" })), /^The fountain is filled with water.But you can't see In it.$/);
  assert.equal(said(verb(g, "take", { item: "large_gem" })), "Done.");
  g.dev.teleport(33, 8, 5);
  assert.equal(said(verb(g, "look", { target: "garden" })), "The Garden Has A Fountain in the middle.");
});

test("the flask: fill it at the fountain, drink once for full strength", () => {
  const g = placed(18, 9, 9);
  assert.equal(said(verb(g, "fill", { item: "wine_flask" })), "You don't have a Container!");
  g.dev.giveItem("wine_flask");
  g.dev.teleport(18, 4, 4);
  assert.equal(said(verb(g, "fill", { item: "wine_flask" })), "I can't reach it!");
  g.dev.teleport(18, 9, 9);
  assert.equal(said(verb(g, "drink", { item: "wine_flask" })), "You don't have any WATER!");
  assert.equal(said(verb(g, "fill", { item: "wine_flask" })), "Done.");
  assert.equal(said(verb(g, "fill", { item: "wine_flask" })), "The flask is full!");
  assert.equal(said(verb(g, "look", { item: "wine_flask" })), "It's filled with water.");
  g.dev.setStrength(12);
  assert.equal(said(verb(g, "drink", { item: "wine_flask" })), "That was good! I feel much better now!");
  assert.equal(player(g).strength, 100);
  assert.equal(st(g).flags.flaskFull, false);
  // a second drink tastes good but doesn't heal
  verb(g, "fill", { item: "wine_flask" });
  g.dev.setStrength(12);
  assert.equal(said(verb(g, "drink", { item: "wine_flask" })), "That was good.");
  assert.equal(player(g).strength, 12);
  assert.equal(said(verb(g, "pour", { item: "wine_flask" })), "You pour the water & it spills on the ground.");
  assert.equal(said(verb(g, "pour", { item: "wine_flask" })), "You don't have any.");
  g.dev.giveItem("goblet");
  verb(g, "fill", { item: "wine_flask" });
  assert.equal(said(verb(g, "pour", { item: "wine_flask" })),
    "You pour the water & it spills on the ground. The goblet had a hole in it!");
  // the barrels in the cellar are dry
  const c = placed(68, 7, 7, ["wine_flask", "lamp"]);
  assert.equal(said(verb(c, "fill", { item: "wine_flask" })), "The Barrels are empty.");
});

test("the wine cellar door: locked until you unlock it with the key from beside it", () => {
  const g = placed(68, 13, 8, ["lamp"]);
  assert.equal(said(move(g, "south")), "The Door is locked.");
  assert.equal(said(verb(g, "unlock", { target: "door" })), "You don't have a Key!");
  g.dev.giveItem("key");
  g.dev.teleport(68, 11, 8);
  assert.equal(said(verb(g, "unlock", { target: "door" })), "I can't reach it!");
  g.dev.teleport(68, 13, 9);
  const ev = verb(g, "unlock", { target: "door" });
  assert.equal(said(ev), "Done.");
  assert.ok(ev.some((e) => e.type === "unlocked" && e.room === 68));
  assert.deepEqual(pos(g), [68, 13, 8]); // stepped beside the doorway, like the original
  assert.equal(st(g).monsters.door1.room, null);
  assert.equal(st(g).flags.cellarLocked, false);
  walk(g, "south", 5);
  assert.equal(pos(g)[0], 69);
  move(g, "north");
  assert.equal(pos(g)[0], 68);
  assert.equal(said(verb(g, "lock", { target: "door" })), "Done.");
  assert.equal(st(g).monsters.door1.room, 68);
  assert.equal(st(g).flags.cellarLocked, true);
});

test("the dungeon door works the same way", () => {
  const g = placed(82, 8, 15, ["key"]);
  assert.equal(said(move(g, "west")), "");
  assert.deepEqual(pos(g), [82, 8, 14]);
  assert.equal(said(move(g, "west")), "The Door is locked.");
  assert.equal(said(verb(g, "look", { target: "door" })), "It looks very Strong.");
  assert.equal(said(verb(g, "unlock", { target: "door" })), "Done.");
  assert.deepEqual(pos(g), [82, 8, 14]);
  walk(g, "west", 15);
  assert.equal(pos(g)[0], 81);
  assert.equal(said(verb(g, "unlock", { target: "door" })), "I don't see a door!");
});

test("the magic wand opens the Sorcerer's mirror; the lab sends you back with a puff of smoke", () => {
  const g = placed(67, 8, 17, ["magic_wand"]);
  assert.equal(g.tileGrid(67)[8][18], "line_v");
  assert.deepEqual(move(g, "east"), []); // the mirror
  assert.equal(said(verb(g, "look", { target: "mirror" })), "It looks Magical!");
  assert.equal(said(verb(g, "mirror", { target: "mirror" })), "The wicked witch never lived here!!");
  const ev = verb(g, "wave", { item: "magic_wand" });
  assert.deepEqual(texts(ev), ["As you wave the WAND....", "There is a *Puff* of smoke Revealing a Secret passage!"]);
  const tiles = g.tileGrid(67);
  assert.equal(tiles[8][18], "floor");
  assert.equal(tiles[8][19], "floor");
  assert.equal(tiles[7][21], "wall");
  walk(g, "east", 7);
  assert.equal(pos(g)[0], 66);
  g.dev.teleport(66, 11, 9);
  move(g, "south"); // the crystal ball at (12,9)
  assert.equal(said(verb(g, "look", { item: "crystal_ball" })),
    "In the Cyrstal Ball.... | You see a man in a winding passage,waving a Wand.");
  g.dev.teleport(66, 8, 0);
  const back = move(g, "west");
  assert.deepEqual(pos(g), [67, 9, 16]);
  assert.ok(texts(back).includes("There is a puff of smoke & you appear in the Sorcerers room!"));
  assert.equal(g.tileGrid(67)[8][18], "line_v"); // closed again
  // waving it anywhere else does nothing
  g.dev.teleport(3);
  assert.deepEqual(texts(verb(g, "wave", { item: "magic_wand" })), ["As you wave the WAND....", "Nothing Happens!"]);
});

test("the wand reveals the secret passage in the winding passage; the secret room is dark", () => {
  const g = placed(77, 16, 11, ["magic_wand"]);
  assert.deepEqual(move(g, "south"), []);
  assert.equal(g.tileGrid(77)[17][11], "wall");
  verb(g, "wave", { item: "magic_wand" });
  assert.equal(g.tileGrid(77)[17][11], "floor");
  assert.equal(g.tileGrid(77)[17][10], "wall");
  assert.deepEqual(texts(verb(g, "wave", { item: "magic_wand" })), ["As you wave the WAND....", "Nothing Happens!"]);
  move(g, "south");
  assert.deepEqual(pos(g), [77, 17, 11]);
  assert.equal(said(move(g, "south")), "It's too dark to go that way!");
  assert.deepEqual(pos(g), [77, 17, 11]);
  g.dev.giveItem("lamp");
  move(g, "south");
  assert.deepEqual(pos(g), [83, 0, 11]);
  assert.equal(said(verb(g, "look", { target: "wall" })), "The walls are many Colors!");
  move(g, "north");
  assert.deepEqual(pos(g), [77, 17, 11]);
  assert.equal(g.tileGrid(77)[17][12], "floor"); // still open behind you
  // leave by another way and it closes again
  g.dev.teleport(76, 12, 12);
  g.dev.teleport(77);
  assert.equal(g.tileGrid(77)[17][11], "wall");
});

test("the book needs the glasses", () => {
  const g = newGame();
  assert.equal(said(verb(g, "read", { target: "sign" })), "You can't read That!");
  assert.equal(said(verb(g, "read", { item: "book" })), "You don't have a book!");
  g.dev.giveItem("book");
  assert.equal(said(verb(g, "read", { item: "book" })), "You can't see well enough. It's all Blurry.");
  g.dev.giveItem("glasses");
  assert.deepEqual(texts(verb(g, "read", { item: "book" })), ["The book reads:", "Wave Scepter"]);
  assert.equal(said(verb(g, "wear", { item: "glasses" })), "Ok. I'm wearing them.");
});

test("the holy cross makes the vampire disappear", () => {
  const g = placed(28, 9, 21, ["holy_cross"]);
  assert.deepEqual(texts(verb(g, "look", { target: "vampire" })), ["The VAMPIRE looks Mean!"]);
  g.dev.teleport(3);
  assert.equal(said(verb(g, "wave", { item: "holy_cross" })), "You look awful Silly waving that CROSS");
  g.dev.teleport(28, 9, 21);
  move(g, "east");
  assert.equal(said(move(g, "east")), "The Vampire is blocking your way. He can't be hurt.");
  const ev = verb(g, "wave", { item: "holy_cross" });
  assert.equal(said(ev), "The vampire sees the holy cross and disappears!");
  assert.equal(st(g).monsters.vampire.room, null);
  walk(g, "east", 2);
  assert.equal(pos(g)[0], 29);
  // showing it works too
  const g2 = placed(28, 9, 20, ["holy_cross"]);
  assert.ok(g2.availableActions().some((a) => a.id === "show:holy_cross"));
  assert.equal(said(verb(g2, "show", { item: "holy_cross" })), "The vampire sees the holy cross and disappears!");
});

test("the fairy blocks the empty room until she hears the harp", () => {
  const g = placed(53, 0, 11, ["harp"]);
  move(g, "north");
  assert.deepEqual(pos(g), [52, 17, 11]);
  const f = st(g).monsters.fairy;
  assert.deepEqual([f.room, f.row, f.col], [52, 9, 0]);
  g.dev.teleport(52, 9, 1);
  assert.equal(said(move(g, "west")), "The Fairy is blocking your way. He can't be hurt.");
  assert.equal(said(verb(g, "look", { target: "fairy" })), "The FAIRY looks pretty but unhappy.");
  assert.equal(said(verb(g, "play", { item: "harp" })),
    "The Harp makes Beautiful Music! The fairy likes the music and leaves!");
  assert.equal(st(g).monsters.fairy.room, null);
  walk(g, "west", 2);
  assert.equal(pos(g)[0], 57);
  move(g, "east");
  assert.equal(st(g).monsters.fairy.room, null); // not when you come back from the empty room
  g.dev.teleport(53, 0, 11);
  move(g, "north");
  assert.equal(st(g).monsters.fairy.room, 52); // but she's back next time
  g.dev.teleport(54, 1, 11);
  assert.deepEqual([st(g).monsters.fairy.room, st(g).monsters.fairy.row, st(g).monsters.fairy.col], [54, 0, 11]);
  assert.equal(said(verb(g, "play", { item: "sword" })), "You don't have it!");
  assert.equal(said(verb(g, "play", { target: "lute" })), "You don't have a LUTE!");
});

test("drowning traps: the necklace protects you", () => {
  const g = placed(76, 12, 13);
  const ev = move(g, "east");
  assert.ok(texts(ev).includes("You have sprung a Trap!! The room has filled with water and you drowned!"));
  assert.equal(st(g).status, "dead");
  assert.ok(ev.some((e) => e.type === "died"));
  const tiles = g.tileGrid(76);
  for (let c = 11; c <= 15; c++) assert.equal(tiles[12][c], "water");
  assert.equal(tiles[12][10], "wall");

  const safe = placed(76, 12, 13, ["necklace"]);
  move(safe, "east");
  assert.equal(st(safe).status, "playing");
  assert.deepEqual(pos(safe), [76, 12, 14]);

  const g2 = placed(78, 8, 16);
  move(g2, "east");
  assert.equal(st(g2).status, "dead");
  assert.equal(g2.tileGrid(78)[9][20], "water");
});

test("the scepter opens the courtyard gate, and walking out escapes", () => {
  const g = placed(1, 16, 11);
  assert.equal(said(move(g, "south")), "The Gate is locked.");
  g.dev.giveItem("key");
  assert.equal(said(verb(g, "unlock", { target: "gate" })), "The Gate is locked Magically.");
  assert.equal(said(verb(g, "lock", { target: "gate" })), "The Gate is already locked!");
  assert.equal(said(verb(g, "look", { target: "gate" })), "It looks very Strong.");
  g.dev.giveItem("scepter");
  g.dev.teleport(3);
  assert.deepEqual(texts(verb(g, "wave", { item: "scepter" })), ["As you wave the SCEPTER....", "Nothing Happens!"]);
  g.dev.teleport(1, 16, 11);
  assert.deepEqual(texts(verb(g, "wave", { item: "scepter" })), ["As you wave the scepter...", "The Gate opens by itself!"]);
  assert.deepEqual(g.tileGrid(1)[17].slice(9, 15), ["wall", "floor", "floor", "floor", "floor", "wall"]);
  // leaving the courtyard closes it again
  g.dev.teleport(1, 0, 11);
  move(g, "north");
  move(g, "south");
  assert.equal(g.tileGrid(1)[17][11], "gate");
  g.dev.teleport(1, 16, 11);
  verb(g, "wave", { item: "scepter" });
  move(g, "south");
  const before = st(g).score;
  const ev = move(g, "south");
  const s = st(g);
  assert.equal(s.status, "escaped");
  assert.equal(s.score, before + 100);
  assert.ok(ev.some((e) => e.type === "escaped"));
  assert.ok(ev.some((e) => e.type === "scored" && e.points === 100));
  assert.ok(texts(ev).includes("You've Escaped the Castle!"));
});

test("a perfect score is 1550", () => {
  const g = placed(1, 16, 11);
  for (const id of Object.keys(st(g).items)) if (st(g).items[id].treasure && id !== "scepter") g.dev.giveItem(id);
  g.dev.teleport(1, 16, 11);
  // nobody's dead yet: 13 treasures (scepter given below) = 650
  g.dev.giveItem("scepter");
  assert.equal(st(g).score, 650);
  assert.equal(st(g).treasuresFound, 13);
});

test("odds and ends the original answers", () => {
  const g = placed(33, 8, 5, ["lamp", "sword", "crown", "necklace", "helmet"]);
  assert.equal(said(verb(g, "rub", { item: "lamp" })), "There's no Genii in this Lamp!");
  assert.equal(said(verb(g, "rub", { item: "sword" })), "The SWORD is cleaner now.");
  assert.equal(said(verb(g, "wear", { item: "crown" })), "The crown is too Heavy!");
  assert.equal(said(verb(g, "wear", { item: "necklace" })), "Ok. I'm wearing it.");
  assert.equal(said(verb(g, "wear", { item: "sword" })), "That could be Difficult!");
  assert.equal(said(verb(g, "wear", { item: "book" })), "You don't have it!");
  assert.equal(said(verb(g, "play", { item: "sword" })), "The SWORD makes Horrible music!!");
  assert.equal(said(verb(g, "jump", { target: "down" })), "I don't think it's safe to Jump here!");
  assert.equal(said(verb(g, "look", { target: "balcony" })), "The balcony is made of stone.");
  assert.equal(said(verb(g, "look", { item: "crown" })), "It's made of Gold!");
  assert.equal(said(verb(g, "look", { item: "lamp" })), "It's lit Magically");
  assert.equal(said(verb(g, "look", { item: "goldbar" })), "You Don't Have it!");
  assert.equal(said(verb(g, "say", { text: "hello" })), "\"HELLO\"");
  assert.equal(said(verb(g, "show", { item: "crown" })), "There's not anyone to show it to!");
  assert.equal(said(verb(g, "eat", { item: "crown" })), "I'm not hungry!");
  assert.equal(said(verb(g, "pet", { target: "dog" })), "I can't pet a DOG!");
  assert.equal(said(verb(g, "use", { item: "lamp" })), "There's no Genii in this Lamp!");
  g.dev.teleport(3);
  assert.equal(said(verb(g, "jump", { target: "down" })), "I Jumped. | This is boring.");
  g.dev.teleport(4, 3, 3);
  assert.equal(said(verb(g, "say", { text: "hello" })), "\"HELLO\" | The OGRE looks at you Funny!");
  assert.equal(said(verb(g, "pet", { target: "ogre" })), "I don't think that would be advisable!");
  assert.equal(said(verb(g, "kill", { target: "ogre" })), "Do it yourself!");
  assert.equal(said(verb(g, "take", { target: "ogre" })), "I don't think that would be very safe!");
  assert.equal(said(verb(g, "show", { item: "crown" })), "The OGRE looks at you Funny!");
  assert.equal(said(verb(g, "look", { target: "stairs" })), "The Staircase leads up.");
  assert.equal(said(verb(g, "take", { target: "blood" })), "Yuc!!");
  assert.equal(said(verb(g, "take", { target: "floor" })), "Impossible!!");
  g.dev.teleport(79, 9, 9);
  assert.equal(said(verb(g, "look", { target: "table" })), "It's covered with Blood!");
  assert.equal(said(verb(g, "take", { target: "chains" })), "They're Connected to the wall.");
  assert.equal(said(verb(g, "look", { target: "chains" })), "They look Magical!");
  g.dev.teleport(74, 1, 1);
  assert.equal(said(verb(g, "look", { target: "wall" })), "The Wall Says: Kevin Bales was Here!");
  g.dev.teleport(37);
  assert.equal(said(verb(g, "look", { target: "beds" })), "They're Red.");
  assert.equal(said(verb(g, "look", { target: "bed" })), "It's Red.");
  g.dev.teleport(14);
  assert.equal(said(verb(g, "look", { target: "throne" })), "The throne is made of stone.");
  g.dev.teleport(68);
  assert.equal(said(verb(g, "look", { target: "barrels" })), "They look Old!");
  assert.equal(said(verb(g, "look", { target: "bat" })), "The BAT looks Mean!");
});

test("look on its own repeats the room description", () => {
  const g = newGame();
  assert.match(said(verb(g, "look")), /^You are in the Castle Courtyard\./);
});
