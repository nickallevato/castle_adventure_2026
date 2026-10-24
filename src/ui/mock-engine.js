// A stand-in engine implementing the engine contract minimally, so the UI can run before (or without)
// src/engine/. Not the real game rules: walk around, take/drop, fake monsters that wander and bite.

const GLYPH = {
  "▓": "wall", "░": "bush_small", "▒": "bush_big", "█": "wood", "─": "line_h", "│": "line_v",
  "┌": "corner_tl", "┐": "corner_tr", "└": "corner_bl", "┘": "corner_br", "═": "gate", "≈": "water",
  U: "stairs_up", D: "stairs_down", " ": "floor", "Γ": "fountain", "α": "statue", "├": "railing",
  k: "letter_k", b: "letter_b",
};
const WALKABLE = new Set(["floor", "stairs_up", "stairs_down"]);
const DELTA = { north: [-1, 0], south: [1, 0], east: [0, 1], west: [0, -1], northeast: [-1, 1], northwest: [-1, -1], southeast: [1, 1], southwest: [1, -1] };

const ITEMS = [
  ["book", "Book", false, 58, 10, 10], ["crystal_ball", "Crystal Ball", false, 66, 12, 9],
  ["glasses", "Eye Glasses", false, 40, 11, 17], ["helmet", "Helmet", false, 22, 4, 11],
  ["key", "Key", false, 56, 6, 11], ["lamp", "Lamp", false, 17, 13, 18], ["magic_wand", "Magic Wand", false, 24, 8, 3],
  ["sword", "Sword", false, 12, 4, 10], ["wine_flask", "Wine Flask", false, 10, 10, 7],
  ["crown", "Crown", true, 14, 4, 8], ["diamond", "Diamond", true, 57, 9, 12], ["goblet", "Fancy Goblet", true, 8, 13, 5],
  ["goldbar", "Goldbar", true, 74, 13, 22], ["harp", "Harp", true, 65, 7, 15], ["holy_cross", "Holy Cross", true, 37, 12, 14],
  ["hourglass", "Hourglass", true, 20, 13, 5], ["jade_figurine", "Jade Figurine", true, 29, 9, 12],
  ["large_gem", "Large Gem", true, 18, 9, 11], ["necklace", "Necklace", true, 19, 8, 11], ["ruby", "Ruby", true, 60, 15, 3],
  ["scepter", "Scepter", true, 83, 9, 11], ["silver_bars", "Silver Bars", true, 26, 7, 6],
];
const MONSTERS = [
  ["demon1", "demon", "Angry Demon", 14, 6, 12, 160], ["demon2", "demon", "Angry Demon", 24, 9, 5, 160],
  ["ogre1", "ogre", "Ugly Ogre", 4, 8, 12, 80], ["ogre2", "ogre", "Ugly Ogre", 21, 11, 11, 80],
  ["spider_big", "spider_big", "Big Spider", 73, 13, 17, 80], ["spider_small", "spider_small", "Small Spider", 70, 4, 16, 60],
  ["snake", "snake", "Snake", 17, 13, 16, 60], ["bat", "bat", "Bat", 68, 6, 17, 40], ["vampire", "vampire", "Vampire", 28, 9, 22, 0],
  ["fairy1", "fairy", "Fairy", 52, 9, 1, 0], ["fairy2", "fairy", "Fairy", 54, 1, 11, 0],
  ["door1", "door", "Door", 68, 14, 8, 0], ["door2", "door", "Door", 68, 14, 9, 0],
];

const NAMES = {
  wall: "Stone Wall", bush_small: "Small Bush", bush_big: "Big Bush", wood: "Wooden Furniture", gate: "Large Gate",
  stairs_up: "Staircase Up", stairs_down: "Staircase Down", water: "Water", fountain: "Fountain", statue: "Statue of the King",
  railing: "Railing", line_h: "Trim", line_v: "Trim", corner_tl: "Trim", corner_tr: "Trim", corner_bl: "Trim", corner_br: "Trim",
  letter_k: "Carved Letter K", letter_b: "Carved Letter B",
};

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function createGame({ rooms, seed = 1 }) {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const rand = rng(seed);
  let acc = 0;
  let state;

  function fresh() {
    return {
      status: "playing",
      player: { room: 1, row: 14, col: 12, facing: "north", strength: 100, maxStrength: 100, inventory: [] },
      score: 0, treasuresFound: 0, treasuresTotal: ITEMS.filter((i) => i[2]).length,
      items: Object.fromEntries(ITEMS.map(([id, name, treasure, room, row, col]) => [id, { id, name, treasure, room, row, col }])),
      monsters: Object.fromEntries(MONSTERS.map(([id, kind, name, room, row, col, strength]) => [id, { id, kind, name, room, row, col, strength, alive: true }])),
      visited: [1], dev: { noclip: false, god: false }, mock: true,
    };
  }
  state = fresh();

  const grid = (roomId) => {
    const r = byId.get(roomId);
    return r.map.map((line) => [...line].map((ch) => GLYPH[ch] || "stone"));
  };
  const tileAt = (roomId, row, col) => grid(roomId)[row]?.[col];
  const monsterAt = (room, row, col) => Object.values(state.monsters).find((m) => m.alive && m.room === room && m.row === row && m.col === col);
  const itemAt = (room, row, col) => Object.values(state.items).find((i) => i.room === room && i.row === row && i.col === col);

  function enter(to, from, dir, row, col) {
    const p = state.player;
    p.room = to;
    if (row != null) { p.row = row; p.col = col; }
    else {
      // find a stair tile or a free floor tile
      const g = grid(to);
      const want = dir === "up" ? "stairs_down" : "stairs_up";
      let spot = null;
      g.forEach((r, ri) => r.forEach((t, ci) => { if (!spot && t === want) spot = [ri, ci]; }));
      if (spot) {
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1]]) {
          if (g[spot[0] + dr]?.[spot[1] + dc] === "floor") { spot = [spot[0] + dr, spot[1] + dc]; break; }
        }
      } else spot = [9, 12];
      [p.row, p.col] = spot;
    }
    if (!state.visited.includes(to)) state.visited.push(to);
    return [{ type: "roomChanged", from, to }, { type: "message", text: byId.get(to).description }];
  }

  function move(dir) {
    const p = state.player;
    const [dr, dc] = DELTA[dir];
    p.facing = dc > 0 ? "east" : dc < 0 ? "west" : dr < 0 ? "north" : "south";
    const r = p.row + dr, c = p.col + dc;
    if (r < 0 || r > 17 || c < 0 || c > 23) {
      const edge = r < 0 ? "north" : r > 17 ? "south" : c < 0 ? "west" : "east";
      const to = byId.get(p.room).exits[edge];
      if (!to) return [{ type: "message", text: "You can't go that way." }];
      const nr = r < 0 ? 17 : r > 17 ? 0 : r, nc = c < 0 ? 23 : c > 23 ? 0 : c;
      return enter(to, p.room, edge, nr, nc);
    }
    const m = monsterAt(p.room, r, c);
    if (m) {
      if (m.kind === "door") return [{ type: "message", text: "The door is locked." }];
      const dmg = 5 + Math.floor(rand() * 10);
      m.strength -= dmg;
      const ev = [{ type: "hit", by: "player", target: m.id, damage: dmg }];
      if (m.strength <= 0) { m.alive = false; ev.push({ type: "message", text: `You killed the ${m.name}!` }, { type: "scored", points: 5 }); state.score += 5; }
      return ev;
    }
    const t = tileAt(p.room, r, c);
    if (!WALKABLE.has(t) && !state.dev.noclip) return [];
    p.row = r; p.col = c;
    if (t === "stairs_up" || t === "stairs_down") {
      const d = t === "stairs_up" ? "up" : "down";
      const to = byId.get(p.room).exits[d];
      if (to) return enter(to, p.room, d);
    }
    return [];
  }

  function near(it) {
    const p = state.player;
    return it.room === p.room && Math.abs(it.row - p.row) <= 1 && Math.abs(it.col - p.col) <= 1;
  }

  function verb(v, item) {
    const p = state.player;
    if (v === "take") {
      const it = state.items[item];
      if (!it || !near(it)) return [{ type: "message", text: "You can't reach that." }];
      it.room = null; p.inventory.push(item);
      const ev = [{ type: "took", item }, { type: "message", text: `You took the ${it.name}.` }];
      if (it.treasure && !it.counted) { it.counted = true; state.treasuresFound++; state.score += 10; ev.push({ type: "scored", points: 10 }); }
      return ev;
    }
    if (v === "drop") {
      const i = p.inventory.indexOf(item);
      if (i < 0) return [];
      p.inventory.splice(i, 1);
      Object.assign(state.items[item], { room: p.room, row: p.row, col: p.col });
      return [{ type: "dropped", item }, { type: "message", text: `You dropped the ${state.items[item].name}.` }];
    }
    if (v === "look") return [{ type: "message", text: byId.get(p.room).description }];
    if (v === "use") return [{ type: "message", text: `Nothing happens.` }];
    return [{ type: "message", text: "Nothing happens." }];
  }

  const api = {
    getState: () => JSON.parse(JSON.stringify(state)),
    load(s) { state = JSON.parse(JSON.stringify(s)); },
    act(a) {
      if (state.status !== "playing") return [];
      if (a.type === "move") return move(a.dir);
      if (a.type === "verb") return verb(a.verb, a.item);
      return [];
    },
    tick(ms) {
      if (state.status !== "playing") return [];
      acc += ms;
      const ev = [];
      while (acc >= 700) {
        acc -= 700;
        const p = state.player;
        for (const m of Object.values(state.monsters)) {
          if (!m.alive || m.room !== p.room || m.kind === "door" || m.kind === "fairy") continue;
          const dr = Math.sign(p.row - m.row), dc = Math.sign(p.col - m.col);
          if (Math.abs(p.row - m.row) + Math.abs(p.col - m.col) === 1) {
            if (rand() < 0.5 && !state.dev.god) {
              const dmg = 1 + Math.floor(rand() * 3);
              p.strength = Math.max(0, p.strength - dmg);
              ev.push({ type: "hit", by: m.id, target: "player", damage: dmg });
              if (p.strength <= 0) { state.status = "dead"; ev.push({ type: "message", text: `The ${m.name} has killed you.` }, { type: "died" }); return ev; }
            }
            continue;
          }
          const opts = rand() < 0.5 ? [[dr, 0], [0, dc]] : [[0, dc], [dr, 0]];
          for (const [a, b] of opts) {
            if (!a && !b) continue;
            const r = m.row + a, c = m.col + b;
            if (tileAt(m.room, r, c) === "floor" && !monsterAt(m.room, r, c) && !(r === p.row && c === p.col)) { m.row = r; m.col = c; break; }
          }
        }
      }
      return ev;
    },
    availableActions() {
      const p = state.player;
      const acts = [];
      for (const it of Object.values(state.items)) if (near(it)) acts.push({ id: `take:${it.id}`, verb: "take", item: it.id, label: `Take ${it.name}`, key: "t" });
      for (const id of p.inventory) acts.push({ id: `drop:${id}`, verb: "drop", item: id, label: `Drop ${state.items[id].name}` });
      acts.push({ id: "look", verb: "look", label: "Look", key: "l" });
      return acts;
    },
    tileGrid: (roomId) => grid(roomId),
    describe(roomId, row, col) {
      const p = state.player;
      if (p.room === roomId && p.row === row && p.col === col) return "You";
      const m = monsterAt(roomId, row, col); if (m) return m.name;
      const it = itemAt(roomId, row, col); if (it) return it.name;
      const t = tileAt(roomId, row, col);
      return NAMES[t] || null;
    },
    dev: {
      setNoclip(b) { state.dev.noclip = !!b; },
      setGod(b) { state.dev.god = !!b; },
      teleport(roomId, row, col) {
        if (!byId.has(roomId)) return [];
        return enter(roomId, state.player.room, null, row ?? 9, col ?? 12);
      },
      giveItem(id) { const it = state.items[id]; if (!it || state.player.inventory.includes(id)) return []; it.room = null; state.player.inventory.push(id); return [{ type: "took", item: id }]; },
      setStrength(n) { state.player.strength = Math.max(0, Math.min(state.player.maxStrength, n | 0)); },
    },
  };
  return api;
}
