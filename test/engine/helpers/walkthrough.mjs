// The scripted full playthrough: every treasure, every monster, then out through the gate.
// Used by test/engine/playthrough.test.mjs; run it by hand with tools/playthrough.mjs [seed] [-v].
import { createGame } from "../../../src/engine/index.js";
import { AutoPlayer } from "./autoplay.mjs";
import ROOMS from "../../../data/rooms.json" with { type: "json" };

export function playThrough({ seed = 7, log = false, msPerAction = 100 } = {}) {
  const game = createGame({ rooms: ROOMS, seed });
  // The player only gets act, tick and getState: no dev cheats, no loading saves.
  const api = Object.freeze({ act: game.act, tick: game.tick, getState: game.getState });
  const p = new AutoPlayer(api, ROOMS, { log, msPerAction });
  const has = (id) => p.s.player.inventory.includes(id);
  const step = (name) => {
    if (log) console.log(`== ${name} (room ${p.s.player.room}, strength ${p.s.player.strength})`);
  };
  const toCourtyardAndDrop = (ids) => {
    p.goTo(1);
    // somewhere in the open, away from what we dropped before
    p.walk((room, r, c, st) => room === 1 && r >= 4 && r <= 13 && c >= 3 && c <= 20 &&
      !Object.values(st.items).some((i) => i.room === 1 && Math.abs(i.row - r) <= 2 && Math.abs(i.col - c) <= 2),
      "an open spot in the courtyard");
    p.dropAll(ids.filter(has));
  };
  const lookAt = (target) => p.verb("look", { target });
  const takeHidden = (id, room, glyphs) => {
    p.goNextToGlyph(room, glyphs);
    p.verb("take", { item: id });
    if (!has(id)) throw new Error(`could not take ${id}:\n${p.recent(5)}`);
  };
  const expect = (ok, what) => {
    if (!ok) throw new Error(`${what}:\n${p.recent(6)}`);
  };

  // 1. Sword from the museum; the flask from the chef's desk, filled at the garden fountain;
  //    the helmet from the guards' hall. Then the upper halls: the ogre, the statue's necklace,
  //    the hourglass, the demon and its magic wand, and the ogre in the ballroom on the way down.
  step("sword");
  p.take("sword");
  step("flask");
  p.goTo(10);
  lookAt("desk");
  takeHidden("wine_flask", 10, ["─", "│"]);
  p.goTo(18);
  lookAt("fountain");
  p.goNextToGlyph(18, ["─", "│"]);
  p.verb("fill", { item: "wine_flask" });
  expect(p.s.flags.flaskFull, "flask not filled");
  step("helmet");
  p.take("helmet");
  p.verb("wear", { item: "helmet" });
  step("ogre");
  p.goTo(21);
  p.fightHere();
  step("necklace");
  p.goTo(19);
  lookAt("statue");
  takeHidden("necklace", 19, ["─", "│"]);
  step("hourglass");
  p.take("hourglass");
  step("wand");
  p.goTo(24);
  p.fightHere();
  p.take("magic_wand");
  step("ogre in the ballroom");
  p.goTo(4);
  p.fightHere();
  toCourtyardAndDrop(["necklace", "hourglass", "magic_wand"]);

  // 2. The ground floor: the snake in the garden, the gem in the fountain (seen from the balcony
  //    above), the goblet, and the crown guarded by the demon in the throne room.
  step("garden");
  p.goTo(17);
  p.fightHere();
  step("balcony");
  p.goTo(33);
  lookAt("garden");
  p.goTo(18);
  takeHidden("large_gem", 18, ["─", "│"]);
  step("goblet");
  p.take("goblet");
  step("crown");
  p.goTo(14);
  p.fightHere();
  p.take("crown");
  toCourtyardAndDrop(["large_gem", "goblet", "crown"]);

  // 3. The holy cross gets past the vampire to the jade figurine; silver bars on the battlement.
  step("holy cross");
  p.take("holy_cross");
  p.goTo(28);
  p.verb("wave", { item: "holy_cross" });
  expect(!p.s.monsters.vampire.room, "vampire still here");
  step("jade");
  p.take("jade_figurine");
  step("silver bars");
  p.take("silver_bars");
  toCourtyardAndDrop(["holy_cross", "jade_figurine", "silver_bars"]);

  // 4. The harp from the east tower, the ruby from the castle wall.
  step("harp");
  p.take("harp");
  step("ruby");
  p.take("ruby");
  toCourtyardAndDrop(["ruby"]);

  // 5. The key from the King's study; the harp sends the fairy away from the empty room.
  step("key");
  p.goTo(56);
  lookAt("desk");
  takeHidden("key", 56, ["─", "│"]);
  step("fairy");
  p.goTo(52);
  lookAt("fairy");
  p.verb("play", { item: "harp" });
  expect(!p.s.monsters.fairy.room, "fairy still here");
  step("diamond");
  p.take("diamond");
  toCourtyardAndDrop(["harp", "diamond", ...(p.s.flags.flaskFull ? ["helmet"] : ["wine_flask"])]);

  // 6. Under the castle with the lamp, key, necklace and wand: through the wine cellar door, the
  //    maze (gold bar), the trapped passage, and the wand's secret passage to the scepter.
  step("cellar");
  p.take("lamp");
  p.take("necklace");
  p.take("magic_wand");
  p.goTo(68);
  p.fightHere(); // the bat
  p.goNextTo(68, 14, 8);
  p.verb("unlock", { target: "door" });
  expect(!p.s.flags.cellarLocked, "door still locked");
  p.dropAll(["key"]);
  step("maze");
  p.goTo(70);
  p.fightHere(); // the small spider
  p.goTo(73);
  p.fightHere(); // the big spider
  p.take("goldbar");
  step("secret passage");
  p.goTo(77);
  p.verb("wave", { item: "magic_wand" });
  // make room for the scepter: drink the water if it's still there, then leave the flask
  if (has("wine_flask")) {
    if (p.s.flags.flaskFull && !p.s.flags.drankWater) p.verb("drink", { item: "wine_flask" });
    p.dropAll(["wine_flask"]);
  } else if (p.s.player.inventory.length >= 6) p.dropAll(["helmet"]);
  step("scepter");
  p.take("scepter");

  // 7. Home: drop the gold bar, open the gate with the scepter and walk out.
  step("escape");
  toCourtyardAndDrop(["goldbar"]);
  p.walk((room, r, c) => room === 1 && r === 16 && c === 11, "the gate");
  p.verb("wave", { item: "scepter" });
  const scoreBeforeEscape = p.s.score;
  p.do({ type: "move", dir: "south" }); // into the open gateway
  if (p.s.status !== "escaped") p.do({ type: "move", dir: "south" }); // and out
  return { game, player: p, state: p.s, scoreBeforeEscape };
}
