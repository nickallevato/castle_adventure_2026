// Places every room on a grid from its exits. Pure: no DOM.
//
// - n/s/e/w are unit grid offsets within a floor; up/down change floor.
// - Rooms joined by n/s/e/w form a "wing" (connected component). A wing's floor comes from a BFS over
//   up/down exits starting at the wing of room 1 (first assignment wins; inconsistent stairs are kept as
//   links but do not move anything).
// - Inside a wing, rooms are placed by BFS from the room the wing was entered by. If the cell a room
//   wants is taken (mazes and other non-Euclidean exits), it goes to the nearest free cell, preferring
//   the exit's direction; that exit is then drawn as a long link instead of a shared doorway.
// - Wings on the same floor are packed so they never overlap (with a one-cell gutter), as close as
//   possible to the room they are reached from on the floor below/above.

export const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const OPP = { north: "south", south: "north", east: "west", west: "east", up: "down", down: "up" };

export function computeWorldLayout(rooms, { start = 1 } = {}) {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const ids = rooms.map((r) => r.id);

  // undirected horizontal adjacency (with direction from each side)
  const hAdj = new Map(ids.map((id) => [id, []]));
  const vAdj = new Map(ids.map((id) => [id, []]));
  for (const r of rooms) {
    for (const [dir, to] of Object.entries(r.exits || {})) {
      if (!byId.has(to)) continue;
      if (DIRS[dir]) {
        hAdj.get(r.id).push({ to, dir });
        hAdj.get(to).push({ to: r.id, dir: OPP[dir], reverse: true });
      } else if (dir === "up" || dir === "down") {
        const d = dir === "up" ? 1 : -1;
        vAdj.get(r.id).push({ to, d });
        vAdj.get(to).push({ to: r.id, d: -d, reverse: true });
      }
    }
  }
  // prefer forward exits over reverse ones when ordering BFS
  for (const list of hAdj.values()) list.sort((a, b) => (a.reverse ? 1 : 0) - (b.reverse ? 1 : 0));
  for (const list of vAdj.values()) list.sort((a, b) => (a.reverse ? 1 : 0) - (b.reverse ? 1 : 0));

  // wings
  const wingOf = new Map();
  const wings = [];
  for (const id of ids) {
    if (wingOf.has(id)) continue;
    const w = { index: wings.length, rooms: [] };
    const q = [id];
    wingOf.set(id, w.index);
    while (q.length) {
      const c = q.shift();
      w.rooms.push(c);
      for (const e of hAdj.get(c)) if (!wingOf.has(e.to)) { wingOf.set(e.to, w.index); q.push(e.to); }
    }
    wings.push(w);
  }

  // floor per wing, plus the room each wing is entered by (and from where)
  const startId = byId.has(start) ? start : ids[0];
  const order = [];
  const visitWing = (wi, floor, entry, from) => {
    const w = wings[wi];
    w.floor = floor; w.entry = entry; w.from = from;
    order.push(wi);
  };
  const queue = [];
  visitWing(wingOf.get(startId), 0, startId, null);
  queue.push(wingOf.get(startId));
  const runFloorBfs = () => {
    while (queue.length) {
      const wi = queue.shift();
      for (const id of wings[wi].rooms) {
        for (const e of vAdj.get(id)) {
          const wj = wingOf.get(e.to);
          if (wings[wj].floor !== undefined) continue;
          visitWing(wj, wings[wi].floor + e.d, e.to, id);
          queue.push(wj);
        }
      }
    }
  };
  runFloorBfs();
  for (const w of wings) if (w.floor === undefined) { visitWing(w.index, 0, w.rooms[0], null); queue.push(w.index); runFloorBfs(); }

  // place each wing locally
  const pos = new Map(); // id -> {x, y, floor}
  const local = new Map();
  for (const wi of order) {
    const w = wings[wi];
    const cells = new Map();
    const at = new Map();
    const put = (id, x, y) => { at.set(id, { x, y }); cells.set(x + "," + y, id); };
    put(w.entry, 0, 0);
    const q = [w.entry];
    while (q.length) {
      const c = q.shift();
      const p = at.get(c);
      for (const e of hAdj.get(c)) {
        if (at.has(e.to)) continue;
        const [dx, dy] = DIRS[e.dir];
        const want = { x: p.x + dx, y: p.y + dy };
        const spot = cells.has(want.x + "," + want.y) ? nearestFree(cells, p, want, dx, dy) : want;
        put(e.to, spot.x, spot.y);
        q.push(e.to);
      }
    }
    local.set(wi, at);
    w.cells = [...at.values()];
  }

  // pack wings per floor
  const occupied = new Map(); // floor -> Set("x,y")
  for (const wi of order) {
    const w = wings[wi];
    const at = local.get(wi);
    const occ = occupied.get(w.floor) || new Set();
    occupied.set(w.floor, occ);
    // anchor: the entry room sits right above/below the room it was reached from
    let ax = 0, ay = 0;
    if (w.from != null && pos.has(w.from)) { ax = pos.get(w.from).x; ay = pos.get(w.from).y; }
    const fits = (ox, oy) => {
      for (const c of at.values()) {
        for (let gx = -1; gx <= 1; gx++) for (let gy = -1; gy <= 1; gy++) {
          if (occ.has(c.x + ox + gx + "," + (c.y + oy + gy))) return false;
        }
      }
      return true;
    };
    let off = null;
    for (let rad = 0; rad < 200 && !off; rad++) {
      // try rings of increasing radius, closest first
      const cand = [];
      for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        cand.push([dx, dy]);
      }
      cand.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
      for (const [dx, dy] of cand) if (fits(ax + dx, ay + dy)) { off = [ax + dx, ay + dy]; break; }
    }
    for (const [id, c] of at) {
      const x = c.x + off[0], y = c.y + off[1];
      pos.set(id, { id, x, y, floor: w.floor, wing: wi });
      occ.add(x + "," + y);
    }
  }

  // links
  const links = [];
  const seen = new Set();
  for (const r of rooms) {
    for (const [dir, to] of Object.entries(r.exits || {})) {
      if (!byId.has(to)) continue;
      const key = [Math.min(r.id, to), Math.max(r.id, to), DIRS[dir] ? "h" : "v"].join(":");
      const back = byId.get(to).exits?.[OPP[dir]] === r.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = pos.get(r.id), b = pos.get(to);
      let kind;
      if (DIRS[dir]) {
        const [dx, dy] = DIRS[dir];
        kind = a.floor === b.floor && b.x - a.x === dx && b.y - a.y === dy ? "door" : "long";
      } else kind = "stairs";
      links.push({ from: r.id, to, dir, kind, twoWay: back });
    }
  }

  // floors
  const floorMap = new Map();
  for (const p of pos.values()) {
    if (!floorMap.has(p.floor)) floorMap.set(p.floor, { level: p.floor, rooms: [], minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const f = floorMap.get(p.floor);
    f.rooms.push(p.id);
    f.minX = Math.min(f.minX, p.x); f.maxX = Math.max(f.maxX, p.x);
    f.minY = Math.min(f.minY, p.y); f.maxY = Math.max(f.maxY, p.y);
  }
  const floors = [...floorMap.values()].sort((a, b) => a.level - b.level);
  return { rooms: Object.fromEntries([...pos].map(([k, v]) => [k, v])), floors, links };
}

function nearestFree(cells, from, want, dx, dy) {
  // Search outward from the desired cell; score favors staying on the exit's side of `from`.
  let best = null, bestScore = Infinity;
  for (let rad = 1; rad < 40; rad++) {
    for (let x = want.x - rad; x <= want.x + rad; x++)
      for (let y = want.y - rad; y <= want.y + rad; y++) {
        if (cells.has(x + "," + y)) continue;
        const along = (x - from.x) * dx + (y - from.y) * dy;
        const score = Math.hypot(x - want.x, y - want.y) + (along > 0 ? 0 : 3) + Math.hypot(x - from.x, y - from.y) * 0.25;
        if (score < bestScore) { bestScore = score; best = { x, y }; }
      }
    if (best && bestScore <= rad + 0.5) break;
  }
  return best;
}

/** Name for a floor level. */
export function floorName(level) {
  if (level === 0) return "Ground Floor";
  if (level < 0) return level === -1 ? "Cellars & Dungeon" : `Deep Level ${-level}`;
  return ["", "Upper Halls", "Bedchambers & Battlements", "Library & Castle Wall", "The Towers", "Tower Tops"][level] || `Level ${level}`;
}
