import { test } from "node:test";
import assert from "node:assert/strict";
import { playThrough } from "./helpers/walkthrough.mjs";

// The scripted player (helpers/walkthrough.mjs) plays the whole game through act() and tick()
// alone, at about 10 key presses a second of game time, fighting every monster it meets.
test("the game can be won: every treasure, every monster, out through the gate", () => {
  const { state, player, scoreBeforeEscape } = playThrough({ seed: 3 });
  assert.equal(state.status, "escaped");
  assert.equal(state.treasuresFound, 13);
  assert.equal(state.treasuresTotal, 13);
  for (const id of Object.keys(state.items).filter((i) => state.items[i].treasure))
    assert.ok(state.items[id].room === 1 || state.player.inventory.includes(id), `${id} collected`);
  for (const m of Object.values(state.monsters).filter((x) => !["vampire", "fairy", "door"].includes(x.kind)))
    assert.equal(m.alive, false, `${m.id} killed`);
  assert.equal(scoreBeforeEscape, 1450);
  assert.equal(state.score, 1550);
  const msgs = player.messages();
  assert.ok(msgs.includes("You've Escaped the Castle!"));
  assert.ok(msgs.includes("PERFECT!"));
  assert.ok(player.events.some((e) => e.type === "escaped"));
  assert.ok(state.visited.length >= 50, `visited ${state.visited.length} rooms`);
});
