// Semantic tile layer: turns the original CP437 room glyphs into tile ids for the renderer.
// The rules live in data/tiles.json. Walkability never comes from here: the engine collides
// against the original glyphs, so a cell that was a wall in the original stays a wall.
import { TILES } from "./data.js";

export const ROWS = 18;
export const COLS = 24;
export const TILE_IDS = TILES.ids;

/** Tile id for one original glyph in a room (before bed end pieces and fills). */
export function tileForGlyph(roomId, glyph, row, col) {
  const checker = TILES.checker[roomId];
  if (checker && checker.glyphs.includes(glyph)) return (row + col) % 2 ? checker.odd : checker.even;
  const own = TILES.rooms[roomId];
  if (own && own[glyph]) return own[glyph];
  return TILES.glyphs[glyph] ?? "stone";
}

/** The base tile grid of a room, from its original map. */
export function baseTileGrid(room) {
  const grid = room.map.map((line, r) => [...line].map((g, c) => tileForGlyph(room.id, g, r, c)));
  if (TILES.beds.includes(room.id)) addBedEnds(room, grid);
  for (const [r0, c0, r1, c1, tile] of TILES.fill[room.id] ?? [])
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r][c] = tile;
  return grid;
}

// A bed is a solid block of full-block glyphs. Wide beds get a left and right end, tall ones a
// top and bottom end; the cells in between keep the bed's color.
function addBedEnds(room, grid) {
  const seen = new Set();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (room.map[r][c] !== "█" || seen.has(r * COLS + c)) continue;
      const cells = [];
      const stack = [[r, c]];
      seen.add(r * COLS + c);
      while (stack.length) {
        const [y, x] = stack.pop();
        cells.push([y, x]);
        for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= ROWS || xx < 0 || xx >= COLS) continue;
          if (room.map[yy][xx] !== "█" || seen.has(yy * COLS + xx)) continue;
          seen.add(yy * COLS + xx);
          stack.push([yy, xx]);
        }
      }
      const rows = cells.map(([y]) => y), cols = cells.map(([, x]) => x);
      const top = Math.min(...rows), bottom = Math.max(...rows);
      const left = Math.min(...cols), right = Math.max(...cols);
      const wide = right - left >= bottom - top;
      for (const [y, x] of cells) {
        if (wide && x === left && right > left) grid[y][x] = "bed_left";
        else if (wide && x === right && right > left) grid[y][x] = "bed_right";
        else if (!wide && y === top) grid[y][x] = "bed_top";
        else if (!wide && y === bottom) grid[y][x] = "bed_bottom";
      }
    }
}

/** Hover name for a tile in a room, or null for plain floor. */
export function tileName(roomId, tile) {
  if (tile === "floor") return null;
  const own = TILES.roomNames[roomId];
  if (own && own[tile]) return own[tile];
  return TILES.names[tile] ?? null;
}
