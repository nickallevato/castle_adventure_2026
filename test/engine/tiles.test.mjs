import { test } from "node:test";
import assert from "node:assert/strict";
import { newGame, placed, verb, move, ROOMS } from "./helpers/setup.mjs";
import { TILE_IDS } from "../../src/engine/index.js";

const SPEC_TILES = ["floor", "wall", "wall_color1", "wall_color2", "gate", "stairs_up", "stairs_down",
  "bush_small", "bush_big", "stone", "wood", "line_h", "line_v", "corner_tl", "corner_tr", "corner_bl",
  "corner_br", "railing", "statue", "fountain", "water", "chain", "gray", "bed_left", "bed_right",
  "bed_top", "bed_bottom", "bed_white", "bed_red", "bed_blue", "bed_purple", "bed_yellow", "letter_k",
  "letter_b"];

test("the engine's tile ids are exactly the spec's", () => {
  assert.deepEqual([...TILE_IDS].sort(), [...SPEC_TILES].sort());
});

test("every cell of every room maps to a known tile id", () => {
  const g = newGame();
  for (const room of ROOMS) {
    const grid = g.tileGrid(room.id);
    assert.equal(grid.length, 18, `room ${room.id} rows`);
    for (const row of grid) {
      assert.equal(row.length, 24, `room ${room.id} cols`);
      for (const t of row) assert.ok(SPEC_TILES.includes(t), `room ${room.id}: ${t}`);
    }
  }
});

test("walls stay walls and floor stays floor", () => {
  const g = newGame();
  for (const room of ROOMS) {
    const grid = g.tileGrid(room.id);
    for (let r = 0; r < 18; r++)
      for (let c = 0; c < 24; c++) {
        const glyph = room.map[r][c], t = grid[r][c];
        const where = `room ${room.id} (${r},${c}) '${glyph}' -> ${t}`;
        if (glyph === "▓") assert.equal(t, "wall", where);
        if (glyph === "═") assert.equal(t, "gate", where);
        if (glyph === "U") assert.equal(t, "stairs_up", where);
        if (glyph === "D") assert.equal(t, "stairs_down", where);
        // something you bump into is never drawn as floor
        if (glyph !== " ") assert.notEqual(t, "floor", where);
        // open floor is floor, except the unreachable inside of the King's desk
        if (glyph === " " && !(room.id === 56 && r === 6 && c >= 10 && c <= 13)) assert.equal(t, "floor", where);
      }
  }
});

test("ambiguous glyphs get their meaning from the room", () => {
  const g = newGame();
  const count = (room, tile) => g.tileGrid(room).flat().filter((t) => t === tile).length;
  assert.ok(count(9, "gray") > 0); // kitchen table
  assert.ok(count(14, "gray") > 0); // throne
  assert.ok(count(11, "wood") > 0 && count(58, "wood") > 0 && count(68, "wood") > 0); // shelves, barrels
  assert.ok(count(10, "bed_white") > 0 && count(10, "bed_left") === 1 && count(10, "bed_right") === 1);
  assert.ok(count(37, "bed_red") > 0 && count(37, "bed_top") > 0 && count(37, "bed_bottom") > 0);
  assert.ok(count(38, "bed_blue") > 0);
  assert.ok(count(39, "bed_purple") > 0);
  assert.ok(count(40, "bed_yellow") > 0);
  assert.ok(count(67, "bed_white") > 0);
  assert.ok(count(83, "wall_color1") > 0 && count(83, "wall_color2") > 0);
  assert.ok(count(17, "bush_big") > 0 && count(17, "bush_small") > 0);
  assert.ok(count(70, "stone") > 0 && count(70, "bush_big") === 0); // the maze's blocks are stone
  assert.equal(g.tileGrid(18)[9][11], "fountain");
  assert.equal(g.tileGrid(19)[8][11], "statue");
  assert.equal(g.tileGrid(74)[10][8], "letter_k");
  assert.equal(g.tileGrid(74)[10][9], "letter_b");
  assert.ok(count(79, "chain") > 0);
  assert.ok(count(33, "railing") > 0);
  assert.equal(g.tileGrid(56)[5][9], "wood"); // desks are wood, not lines
  assert.equal(g.tileGrid(67)[7][18], "line_v"); // the mirror
});

test("tileGrid shows the current state and returns a fresh copy", () => {
  const g = placed(1, 16, 11, ["scepter"]);
  const before = g.tileGrid(1);
  before[0][0] = "floor";
  assert.equal(g.tileGrid(1)[0][0], "wall");
  verb(g, "wave", { item: "scepter" });
  assert.equal(g.tileGrid(1)[17][11], "floor");
  // map changes are drawn on the room you're in only
  move(g, "north");
  assert.equal(g.tileGrid(2)[0][0], newGame().tileGrid(2)[0][0]);
  assert.throws(() => g.tileGrid(99));
});

test("describe names monsters, items, tiles and you", () => {
  const g = placed(4, 3, 3);
  assert.equal(g.describe(4, 3, 3), "You");
  assert.equal(g.describe(4, 8, 12), "Ugly Ogre");
  assert.equal(g.describe(4, 1, 2), "Gray Stone Wall");
  assert.equal(g.describe(4, 3, 20), "Stairs up");
  assert.equal(g.describe(4, 5, 5), null);
  assert.equal(g.describe(12, 4, 10), "Sword");
  assert.equal(g.describe(17, 4, 18), "Small Bush");
  assert.equal(g.describe(19, 8, 11), "Statue of the King");
  assert.equal(g.describe(18, 9, 11), "Fountain");
  assert.equal(g.describe(56, 5, 9), "Wooden Desk");
  assert.equal(g.describe(68, 14, 8), "Door");
  assert.equal(g.describe(10, 10, 7), "Desk"); // the hidden flask isn't given away
  assert.equal(g.describe(4, 99, 0), null);
  assert.equal(g.describe(999, 0, 0), null);
});
