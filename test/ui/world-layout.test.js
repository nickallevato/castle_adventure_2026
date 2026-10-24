import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeWorldLayout } from "../../src/ui/world-layout.js";
import { roomTitle } from "../../src/ui/room-names.js";

const rooms = JSON.parse(readFileSync(new URL("../../data/rooms.json", import.meta.url)));

test("every room is placed exactly once", () => {
  const L = computeWorldLayout(rooms);
  assert.equal(Object.keys(L.rooms).length, 83);
  for (const r of rooms) assert.ok(L.rooms[r.id], `room ${r.id} placed`);
  const onFloors = L.floors.flatMap((f) => f.rooms);
  assert.equal(onFloors.length, 83);
  assert.equal(new Set(onFloors).size, 83);
});

test("no two rooms overlap on a floor", () => {
  const L = computeWorldLayout(rooms);
  for (const f of L.floors) {
    const cells = new Set();
    for (const id of f.rooms) {
      const p = L.rooms[id];
      const k = `${p.x},${p.y}`;
      assert.ok(!cells.has(k), `overlap at floor ${f.level} cell ${k}`);
      cells.add(k);
    }
  }
});

test("room 1 is on the ground floor, up/down exits change floor, and most doors line up", () => {
  const L = computeWorldLayout(rooms);
  assert.equal(L.rooms[1].floor, 0);
  assert.equal(L.rooms[11].floor - L.rooms[68].floor, 1, "storage room is above the wine cellar");
  assert.equal(L.rooms[20].floor - L.rooms[4].floor, 1);
  const doors = L.links.filter((l) => l.kind === "door").length;
  const long = L.links.filter((l) => l.kind === "long").length;
  assert.ok(doors > long * 5, `${doors} doors vs ${long} long links`);
});

test("inconsistent exits (a maze) are handled without overlaps", () => {
  const maze = [
    { id: 1, exits: { north: 2, east: 3 } },
    { id: 2, exits: { east: 4, south: 1 } },
    { id: 3, exits: { north: 5, west: 1 } },
    { id: 4, exits: { south: 3, west: 2, east: 1 } }, // east wraps around to 1
    { id: 5, exits: { north: 5, west: 1, up: 6 } },
    { id: 6, exits: { down: 1 } },
    { id: 7, exits: {} }, // unreachable
  ];
  const L = computeWorldLayout(maze);
  assert.equal(Object.keys(L.rooms).length, 7);
  for (const f of L.floors) {
    const cells = f.rooms.map((id) => `${L.rooms[id].x},${L.rooms[id].y}`);
    assert.equal(new Set(cells).size, cells.length);
  }
  assert.equal(L.rooms[6].floor, 1);
  assert.ok(L.links.some((l) => l.kind === "long"));
});

test("room titles come from the original descriptions", () => {
  assert.equal(roomTitle(rooms[13].description), "Throne Room");
  assert.equal(roomTitle(rooms[0].description), "Castle Courtyard");
  assert.equal(roomTitle(rooms[60].description), "Below the West Tower");
});
