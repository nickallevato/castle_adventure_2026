import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { placed, newGame, verb, move } from "./helpers/setup.mjs";
import MESSAGES from "../../data/messages.json" with { type: "json" };
import STRINGS from "../../data/exe-strings.json" with { type: "json" };

const root = new URL("../../", import.meta.url).pathname;
const run = (script, ...args) => execFileSync(process.execPath, [join(root, script), ...args], { cwd: root });

test("the data files are what the extraction tools produce from the original files", () => {
  const dir = mkdtempSync(join(tmpdir(), "castle-data-"));
  run("tools/extract-rooms.mjs", "original/CASTLE.RAN", join(dir, "rooms.json"));
  run("tools/extract-exe.mjs", "original/CASTLE.EXE", dir);
  run("tools/build-messages.mjs", join(dir, "exe-strings.json"), join(dir, "messages.json"));
  for (const file of ["rooms.json", "items.json", "monsters.json", "exe-strings.json", "messages.json"])
    assert.equal(readFileSync(join(dir, file), "utf8"), readFileSync(join(root, "data", file), "utf8"), file);
});

test("every message line is made of text from CASTLE.EXE", () => {
  const texts = STRINGS.map((s) => s.text);
  for (const [key, lines] of Object.entries(MESSAGES))
    for (const line of lines)
      for (const piece of line.split(/\{[A-Z]\}/))
        if (piece && piece !== '"') assert.ok(texts.some((t) => t.includes(piece)), `${key}: ${JSON.stringify(piece)}`);
});

test("room descriptions keep the original's 25-column lines", () => {
  const rooms = JSON.parse(readFileSync(join(root, "data/rooms.json"), "utf8"));
  assert.equal(rooms.length, 83);
  assert.equal(rooms[0].description, "You are in the Castle Courtyard. To the north is a large Doorway.To the south is a large gate.");
  assert.deepEqual(rooms[10].descriptionLines.slice(-1), ["corner."]);
  for (const r of rooms) for (const l of r.descriptionLines) assert.ok(l.length <= 25);
});

test("availableActions: unique ids and keys, and what you can do right here", () => {
  const g = placed(12, 5, 11, ["lamp", "harp"]);
  const acts = g.availableActions();
  const ids = acts.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  const keys = acts.filter((a) => a.key).map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) assert.ok(!"wasdm`".includes(k), `key ${k} clashes with movement or the map`);
  for (const a of acts) {
    assert.equal(typeof a.label, "string");
    assert.equal(typeof a.verb, "string");
  }
  assert.ok(ids.includes("take:sword"));
  assert.ok(ids.includes("drop:lamp") && ids.includes("drop:harp"));
  assert.ok(ids.includes("play:harp") && ids.includes("rub:lamp"));
  assert.ok(ids.includes("look:lamp"));
  assert.ok(ids.includes("inventory"));
  // every listed action runs
  for (const a of acts) {
    const game = placed(12, 5, 11, ["lamp", "harp"]);
    const { id, label, key, ...action } = a;
    assert.doesNotThrow(() => game.act({ type: "verb", ...action }), id);
  }
  // things in the room
  const desk = placed(56, 8, 11).availableActions().map((a) => a.id);
  assert.ok(desk.includes("look:desk"));
  assert.ok(!desk.includes("take:key")); // not until you've looked
  const g2 = placed(56, 8, 11);
  verb(g2, "look", { target: "desk" });
  assert.ok(g2.availableActions().some((a) => a.id === "take:key"));
  const monsters = placed(4, 3, 3).availableActions().map((a) => a.id);
  assert.ok(monsters.includes("look:ogre1"));
  const doors = placed(68, 13, 8, ["key", "lamp"]).availableActions().map((a) => a.id);
  assert.ok(doors.includes("unlock:door"));
  const fountain = placed(18, 9, 9, ["wine_flask"]).availableActions().map((a) => a.id);
  assert.ok(fountain.includes("fill:wine_flask"));
});

test("unknown actions are rejected or answered the way the original did", () => {
  const g = newGame();
  assert.throws(() => g.act({ type: "dance" }));
  assert.throws(() => g.act(null));
  assert.throws(() => g.act({ type: "verb", verb: "look", item: "banana" }));
  assert.deepEqual(g.act({ type: "verb", verb: "frobnicate", item: "lamp" }).map((e) => e.text), ["What???"]);
  assert.equal(move(g, "north").length, 0);
});
