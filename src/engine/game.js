// Castle Adventure game rules. Pure logic: no DOM, no timers, deterministic from the seed.
//
// The rules follow the original CASTLE.EXE (compiled IBM BASIC), which was disassembled to learn
// them; comments name the original behavior where it is surprising. Positions are 0-based
// (row 0-17, col 0-23); the original used 1-based screen rows and columns.
import { ITEMS, MONSTERS } from "./data.js";
import { ROWS, COLS, TILE_IDS, baseTileGrid, tileForGlyph, tileName } from "./tiles.js";
import { lines, messageEvents, basicNumber } from "./text.js";

export const STATE_VERSION = 1;
export const MAX_STRENGTH = 100; // the player starts with 100 and water restores it to 100
export const MAX_INVENTORY = 6;
export const MONSTER_STEP_MS = 500; // see "Timing" in the spec: the original moved monsters once per 200 idle polls of the keyboard
export const PERFECT_SCORE = 1550;

const COURTYARD = 1;
const DARK_ROOMS = [68, 83]; // the original only checks the lamp for these two destinations
const FIGHTERS = MONSTERS.filter((m) => m.fights).map((m) => m.id);
const PARSER_MONSTERS = MONSTERS.filter((m) => m.kind !== "door").map((m) => m.id); // the original's 10
const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
const MONSTER_BY_ID = Object.fromEntries(MONSTERS.map((m) => [m.id, m]));
const TREASURES = ITEMS.filter((i) => i.treasure).map((i) => i.id);

export const DIRS = {
  north: [-1, 0], south: [1, 0], east: [0, 1], west: [0, -1],
  northeast: [-1, 1], northwest: [-1, -1], southeast: [1, 1], southwest: [1, -1],
};

// Verb ids accepted by act({type:"verb"}), mapped to the original's command words.
export const VERBS = {
  use: "USE", // not an original verb: does the natural thing with an item (see USE below)
  look: "LOOK", search: "SEARCH", examine: "EXAMINE", take: "GET", get: "GET", drop: "DROP",
  throw: "THROW", fill: "FILL", wear: "WEAR", play: "PLAY", wave: "WAVE", rub: "RUB",
  clean: "CLEAN", say: "SAY", unlock: "UNLOCK", open: "OPEN", lock: "LOCK", close: "CLOSE",
  drink: "DRINK", eat: "EAT", read: "READ", jump: "JUMP", leep: "LEEP", pour: "POUR",
  climb: "CLIMB", mirror: "MIRROR", pet: "PET", kill: "KILL", show: "SHOW", inventory: "INV",
};

// Room furniture the parser knows, for LOOK/GET and for the action bar.
const FEATURES = {
  1: ["gate", "wall"], 9: ["table"], 10: ["desk", "bed"], 11: ["shelves"], 14: ["throne"],
  18: ["fountain"], 19: ["statue"], 33: ["garden", "balcony"], 37: ["beds"], 38: ["beds"],
  39: ["bed"], 40: ["desk", "bed"], 56: ["desk"], 58: ["shelves"], 59: ["shelves"],
  67: ["mirror", "beds"], 68: ["barrels", "door"], 74: ["wall"], 79: ["table", "chains"],
  82: ["door"], 83: ["wall"],
};
const HEAVY = { TABLE: [9, 79], DESK: [10, 40, 56], BED: [10, 37, 38, 39, 40, 67],
  BEDS: [10, 37, 38, 39, 40, 67], SHELF: [11, 58, 59], SHELVES: [11, 58, 59], THRONE: [14],
  FOUNTAIN: [18], STATUE: [19], BARREL: [68], BARRELS: [68], MIRROR: [67] };
const STONE_NOUNS = ["WALLS", "WALL", "ROOF", "FLOOR", "CEILING", "ARCHWAY", "ARCHWAYS"];

// Map changes made by puzzles. Like the original, these are drawn onto the current screen only
// and disappear when you leave the room.
const MODS = {
  gateOpen: [[17, 10, " "], [17, 11, " "], [17, 12, " "], [17, 13, " "]],
  mirrorOpen: [[6, 18, " "], [7, 18, " "], [8, 18, " "], [9, 18, " "], [10, 18, " "], [11, 18, " "],
    [7, 19, "▓"], [7, 20, "▓"], [7, 21, "▓"], [7, 22, "▓"], [7, 23, "▓"],
    [10, 19, "▓"], [10, 20, "▓"], [10, 21, "▓"], [10, 22, "▓"], [10, 23, "▓"],
    [8, 19, " "], [9, 19, " "]],
  passageOpen: [[17, 10, "▌"], [17, 11, " "], [17, 12, " "], [17, 13, "▐"]],
};
// The two drowning traps: where they trigger and how the room floods.
const TRAPS = {
  76: { at: [[12, 14], [13, 14]], walls: [[12, 10], [13, 10], [12, 16], [13, 16]],
    water: { rows: [12, 13], from: 11, to: 15 } },
  78: { at: [[8, 17], [9, 17]], walls: [[8, 11], [9, 11], [8, 23], [9, 23]],
    water: { rows: [8, 9], from: 12, to: 22 } },
};
const FAIRY_SPOTS = { 52: [9, 0], 54: [0, 11] }; // she blocks the way into the empty room (57)

function hashSeed(seed) {
  const text = String(seed ?? 1);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freshState(seed) {
  const items = {};
  for (const it of ITEMS)
    items[it.id] = { id: it.id, name: it.name, treasure: it.treasure, room: it.room, row: it.row,
      col: it.col, hidden: it.hiddenIn != null, hiddenIn: it.hiddenIn ?? null, revealed: false };
  const monsters = {};
  for (const m of MONSTERS)
    monsters[m.id] = { id: m.id, kind: m.kind, name: m.name, room: m.room, row: m.row, col: m.col,
      strength: m.strength, alive: true };
  return {
    version: STATE_VERSION,
    status: "playing",
    player: { room: COURTYARD, row: 14, col: 14, facing: "south", strength: MAX_STRENGTH,
      maxStrength: MAX_STRENGTH, inventory: [], lastMove: { dr: 0, dc: 0 } },
    score: 0,
    treasuresFound: 0,
    treasuresTotal: TREASURES.length,
    items,
    monsters,
    visited: [COURTYARD],
    dev: { noclip: false, god: false },
    flags: { cellarLocked: true, dungeonLocked: true, flaskFull: false, drankWater: false },
    prevRoom: 0,
    mods: [], // [{row, col, glyph, tile?}] on the current room
    clockMs: 0,
    rng: hashSeed(seed),
    turn: 0,
  };
}

export function createGame({ rooms, seed = 1, highScore = null, monsterStepMs = MONSTER_STEP_MS } = {}) {
  if (!Array.isArray(rooms) || rooms.length < 83) throw new Error("createGame needs the 83 rooms from data/rooms.json");
  const ROOM = {};
  for (const r of rooms) ROOM[r.id] = r;
  const BASE_TILES = {};
  for (const r of rooms) BASE_TILES[r.id] = baseTileGrid(r);
  const ARRIVAL = arrivalSpots(ROOM);

  let s = freshState(seed);
  let out = []; // events of the call in progress

  // ---------------------------------------------------------------------------------------------
  // small helpers
  const rand = () => {
    let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rnd = (n) => Math.floor(rand() * n); // BASIC INT(RND * n)
  const say = (key, vars, opts) => out.push(...messageEvents(lines(key, vars), opts));
  const sayLines = (block, opts) => out.push(...messageEvents(block, opts));
  const here = () => s.player.room;
  const carried = (id) => s.player.inventory.includes(id);
  const item = (id) => s.items[id];
  const mon = (id) => s.monsters[id];
  const shortName = (id) => MONSTER_BY_ID[id].noun; // "UGLY OGRE" is "OGRE" in messages

  function glyphAt(roomId, r, c) {
    if (roomId === here()) {
      for (let i = s.mods.length - 1; i >= 0; i--) {
        const m = s.mods[i];
        if (m.row === r && m.col === c) return m.glyph;
      }
    }
    return ROOM[roomId].map[r][c];
  }
  const itemAt = (roomId, r, c) =>
    Object.values(s.items).find((i) => i.room === roomId && i.row === r && i.col === c) ?? null;
  const monsterAt = (roomId, r, c) =>
    Object.values(s.monsters).find((m) => m.room === roomId && m.row === r && m.col === c) ?? null;
  const inBounds = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  // The original's SCREEN(r, c) = 32 test: nothing at all is drawn there.
  const isClear = (r, c) => inBounds(r, c) && glyphAt(here(), r, c) === " " && !itemAt(here(), r, c) &&
    !monsterAt(here(), r, c) && !(s.player.row === r && s.player.col === c);
  const monstersHere = () => PARSER_MONSTERS.map(mon).filter((m) => m.room === here());
  const liveFightersHere = () => FIGHTERS.map(mon).filter((m) => m.room === here() && m.alive);
  const findItemByNoun = (noun) => ITEMS.find((i) => i.noun === noun) ?? null;
  const findMonsterHere = (noun) =>
    PARSER_MONSTERS.map(mon).find((m) => m.room === here() && MONSTER_BY_ID[m.id].noun === noun) ?? null;
  const neighbors = (r, c) => {
    const cells = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) if (dr || dc) cells.push([r + dr, c + dc]);
    return cells;
  };
  const nextTo = (test) => neighbors(s.player.row, s.player.col).some(([r, c]) => inBounds(r, c) && test(r, c));
  const addMods = (cells) => {
    for (const [row, col, glyph, tile] of cells) s.mods.push(tile ? { row, col, glyph, tile } : { row, col, glyph });
  };

  function updateScore() {
    const before = s.score;
    const found = TREASURES.filter((id) => carried(id) || item(id).room === COURTYARD).length;
    const kills = FIGHTERS.filter((id) => !mon(id).alive).length;
    s.treasuresFound = found;
    s.score = found * 50 + kills * 100 + (s.status === "escaped" ? 100 : 0);
    if (s.score !== before) out.push({ type: "scored", points: s.score - before, score: s.score });
  }

  // ---------------------------------------------------------------------------------------------
  // rooms
  function enterRoom(to, row, col) {
    const from = here();
    s.prevRoom = from;
    s.player.room = to;
    s.player.row = row;
    s.player.col = col;
    s.mods = [];
    if (!s.visited.includes(to)) s.visited.push(to);
    out.push({ type: "roomChanged", from, to, description: ROOM[to].description });
    out.push({ type: "message", text: ROOM[to].description, lines: ROOM[to].descriptionLines ?? [],
      kind: "description" });
    // Walking out of the secret laboratory puts you back inside the Sorcerer's room, past the
    // mirror that would otherwise block the way.
    if (to === 67 && from === 66) {
      s.player.row = 9;
      s.player.col = 16;
      say("puffSorcerer");
    }
    if (from === 83) addMods(MODS.passageOpen); // coming back from the secret room
    const fairy = FAIRY_SPOTS[to];
    if (fairy && from !== 57) Object.assign(mon("fairy"), { room: to, row: fairy[0], col: fairy[1] });
  }

  function takeExit(dir, row, col) {
    const to = ROOM[here()].exits[dir] ?? 0;
    if (!to) {
      // Leaving a room where it has no exit ends the game as an escape. In the original castle the
      // only such opening is the courtyard gate once the scepter has opened it. (With noclip you
      // could walk off any edge, so that only counts in the courtyard.)
      if (!s.dev.noclip || here() === COURTYARD) escape();
      return;
    }
    if (DARK_ROOMS.includes(to) && !carried("lamp") && !s.dev.noclip) {
      say("tooDark");
      return;
    }
    enterRoom(to, row, col);
  }

  // ---------------------------------------------------------------------------------------------
  // moving and bumping
  function move(dir) {
    const d = DIRS[dir];
    if (!d) throw new Error(`unknown direction ${dir}`);
    const [dr, dc] = d;
    s.player.lastMove = { dr, dc };
    s.player.facing = dc > 0 ? "east" : dc < 0 ? "west" : dr < 0 ? "north" : "south";
    const { row, col } = s.player;
    const nr = row + dr, nc = col + dc;
    if (nr < 0) return takeExit("north", 17, col);
    if (nr >= ROWS) return takeExit("south", 0, col);
    if (nc < 0) return takeExit("west", row, 23);
    if (nc >= COLS) return takeExit("east", row, 0);
    const glyph = glyphAt(here(), nr, nc);
    if (glyph === "U") return takeExit("up", row, col);
    if (glyph === "D") return takeExit("down", row, col);

    const thing = itemAt(here(), nr, nc);
    if (thing) return pickUp(thing.id); // running into a visible item picks it up
    const m = monsterAt(here(), nr, nc);
    if (m && !s.dev.noclip) return bump(m);
    if (glyph === "═" && !s.dev.noclip) return say("gateLocked");
    if (glyph !== " " && !s.dev.noclip) return; // walls and furniture just stop you
    s.player.row = nr;
    s.player.col = nc;
    checkTrap();
  }

  function pickUp(id) {
    if (s.player.inventory.length >= MAX_INVENTORY) return say("cantCarry");
    const it = item(id);
    Object.assign(it, { room: null, row: null, col: null, hidden: false });
    s.player.inventory.push(id);
    out.push({ type: "took", item: id });
  }

  function bump(m) {
    if (m.kind === "door") return say("doorLocked");
    if (m.kind === "vampire") return say("vampireBlocks");
    if (m.kind === "fairy") return say("fairyBlocks");
    if (!m.alive) return; // a dead monster's body is just in the way
    attack(m);
  }

  function attack(m) {
    if (!carried("sword")) return say("noWeapon");
    // 50% to hit; the original prints nothing on a miss.
    if (rnd(100) + 1 <= 50) {
      out.push({ type: "hit", by: "player", target: m.id, damage: 0, missed: true });
      return;
    }
    // STR = STR - INT(RND*25) + 5 in the original, so a "hit" does -5..19 (it can heal).
    const damage = rnd(25) - 5;
    m.strength -= damage;
    out.push({ type: "hit", by: "player", target: m.id, damage });
    if (m.strength >= 0) say("youStruck", { M: shortName(m.id) });
    else {
      m.alive = false;
      say("youKilled", { M: shortName(m.id) });
      out.push({ type: "killed", monster: m.id });
    }
  }

  function checkTrap() {
    const trap = TRAPS[here()];
    if (!trap || carried("necklace") || s.dev.god) return;
    if (!trap.at.some(([r, c]) => r === s.player.row && c === s.player.col)) return;
    addMods(trap.walls.map(([r, c]) => [r, c, "▓"]));
    for (const r of trap.water.rows)
      for (let c = trap.water.from; c <= trap.water.to; c++) addMods([[r, c, "░", "water"]]);
    say("trap");
    die();
  }

  // ---------------------------------------------------------------------------------------------
  // monsters (real time)
  function monsterStep() {
    for (const id of FIGHTERS) {
      if (s.status !== "playing") return;
      const m = mon(id);
      if (m.room !== here() || !m.alive) continue;
      const dr = Math.sign(s.player.row - m.row), dc = Math.sign(s.player.col - m.col);
      const r = m.row + dr, c = m.col + dc;
      if (r === s.player.row && c === s.player.col) monsterAttacks(m);
      else if (isClear(r, c)) {
        m.row = r;
        m.col = c;
      }
    }
  }

  function monsterAttacks(m) {
    let roll = rnd(100) + 1;
    if (carried("helmet")) roll -= 10;
    if (roll <= 40) return; // missed, silently
    const damage = s.dev.god ? 0 : rnd(25) - 5;
    s.player.strength -= damage;
    out.push({ type: "hit", by: m.id, target: "player", damage });
    if (s.player.strength < 0) {
      say("monsterKilledYou", { M: shortName(m.id) });
      die();
      return;
    }
    const block = lines("monsterStruck", { M: shortName(m.id) });
    if (carried("helmet")) block.push(...lines("helmetHelped"));
    sayLines(block);
  }

  // ---------------------------------------------------------------------------------------------
  // the end
  function die() {
    s.status = "dead";
    out.push({ type: "died" });
    endOfGame("failed");
  }

  function escape() {
    s.status = "escaped";
    say("escaped");
    updateScore();
    out.push({ type: "escaped" });
    endOfGame(null);
  }

  function endOfGame(headline) {
    if (headline) say(headline);
    updateScore();
    const treasures = TREASURES.filter((id) => carried(id) || item(id).room === COURTYARD);
    say("collected");
    sayLines([treasures.length ? treasures.map((id) => ITEM_BY_ID[id].dataName).join(", ") : lines("none")[0]]);
    const kills = FIGHTERS.filter((id) => !mon(id).alive);
    say("killed");
    sayLines([kills.length ? kills.map((id) => MONSTER_BY_ID[id].dataName).join(", ") : lines("none")[0]]);
    say("score", { S: basicNumber(s.score) });
    say(s.score === PERFECT_SCORE ? "perfect" : "perfectIs");
    out.push({ type: "gameOver", status: s.status, score: s.score });
  }

  // ---------------------------------------------------------------------------------------------
  // the parser's verbs. noun is upper case, as the original compared it.
  function command(verb, noun) {
    switch (verb) {
      case "LOOK": case "SEARCH": case "EXAMINE": return look(noun);
      case "DROP": case "THROW": return drop(noun);
      case "FILL":
        if (noun === "FLASK") return get(here() === 68 ? "WINE" : "WATER");
        return say("what");
      case "GET": case "TAKE": return get(noun);
      case "WEAR": return wear(noun);
      case "PLAY": return play(noun);
      case "WAVE": return wave(noun);
      case "RUB": case "CLEAN": return rub(noun);
      case "SAY": return sayWords(noun);
      case "OPEN": case "UNLOCK": return lock("UNLOCK", noun);
      case "CLOSE": case "LOCK": return lock("LOCK", noun);
      case "DRINK": return drink(noun);
      case "EAT": return say("eat");
      case "READ": return read(noun);
      case "JUMP": case "LEEP":
        return say(noun === "DOWN" && [33, 64, 65].includes(here()) ? "jumpUnsafe" : "jumped");
      case "POUR": return pour(noun);
      case "CLIMB": return say("climb");
      case "MIRROR":
        if (here() === 67 && noun === "MIRROR") return say("mirror");
        return say("what");
      case "PET": return say(findMonsterHere(noun) ? "petMonster" : "petWhat", { N: noun });
      case "KILL": return say(findMonsterHere(noun) ? "killMonster" : "killWhat", { N: noun });
      case "SHOW": return show(noun);
      default: return say("what");
    }
  }

  function inventory() {
    const block = [...lines("inventoryTitle")];
    const have = ITEMS.filter((i) => carried(i.id));
    if (!have.length) block.push(...lines("inventoryNothing"));
    for (const i of have) block.push(`${i.glyph} ${i.dataName}`);
    sayLines(block.filter((l) => l.trim()), { separate: true });
  }

  function reveal(id) {
    item(id).revealed = true;
  }

  const hiddenHere = (id) => item(id).hidden && item(id).hiddenIn === here();

  function look(noun) {
    const it = findItemByNoun(noun);
    if (it) {
      if (!carried(it.id)) return say("lookDontHaveIt");
      if (it.id === "wine_flask") return say(s.flags.flaskFull ? "look.flaskFull" : "look.flaskEmpty");
      const byKind = { harp: "gold", holy_cross: "gold", hourglass: "gold", goblet: "gold", crown: "gold",
        diamond: "expensive", jade_figurine: "expensive", scepter: "expensive", large_gem: "expensive",
        goldbar: "expensive", silver_bars: "theyExpensive", ruby: "theyExpensive" };
      return say(`look.${byKind[it.id] ?? it.id}`);
    }
    const room = here();
    switch (noun) {
      case "TABLE": return say(room === 9 ? "look.tableStone" : room === 79 ? "look.tableBlood" : "look.noTable");
      case "DESK":
        if (room === 10 && hiddenHere("wine_flask")) return reveal("wine_flask"), say("look.deskFlask");
        if (room === 40 && hiddenHere("glasses")) return reveal("glasses"), say("look.deskGlasses");
        if (room === 56 && hiddenHere("key")) return reveal("key"), say("look.deskKey");
        return say([10, 40, 56].includes(room) ? "look.deskWood" : "look.noDesk");
      case "BED": case "BEDS":
        if (noun === "BEDS" && room === 37) return say("look.bedsRed");
        if (noun === "BEDS" && room === 38) return say("look.bedsBlue");
        if (noun === "BEDS" && room === 67) return say("look.bedsOld");
        if (room === 10 || room === 67) return say("look.bedOld");
        if (room === 37) return say("look.bedRed");
        if (room === 38) return say("look.bedBlue");
        if (room === 39) return say("look.bedPurple");
        if (room === 40) return say("look.bedYellow");
        return say(noun === "BEDS" ? "look.noBeds" : "look.noBed");
      case "SHELF": case "SHELVES":
        if (room === 58 && hiddenHere("book")) {
          reveal("book");
          return say(noun === "SHELF" ? "look.shelfBook" : "look.shelvesBook");
        }
        if ([58, 11, 59].includes(room)) return say("look.shelvesWood");
        return say(noun === "SHELF" ? "look.noShelf" : "look.noShelves");
      case "STAIRS": case "STAIR": case "STAIRCASE": {
        const { up, down } = ROOM[room].exits;
        if (up && down) return say("look.stairsBoth");
        if (up) return say("look.stairsUp");
        if (down) return say("look.stairsDown");
        return say(noun === "STAIRS" ? "look.noStairs" : "look.noStaircase");
      }
      case "THRONE": return say(room === 14 ? "look.throne" : "look.noThrone");
      case "FOUNTAIN": return say(room === 18 ? "look.fountain" : "look.noFountain");
      case "STATUE":
        if (room !== 19) return say("look.noStatue");
        if (hiddenHere("necklace")) return reveal("necklace"), say("look.statueNecklace");
        return say("look.statue");
      case "MIRROR": return say(room === 67 ? "look.mirror" : "look.noMirror");
      case "BARREL": case "BARRELS":
        if (room === 68) return say(noun === "BARRELS" ? "look.barrels" : "look.barrel");
        return say(noun === "BARRELS" ? "look.noBarrels" : "look.noBarrel");
      case "CHAIN": case "CHAINS":
        if (room === 79) return say(noun === "CHAINS" ? "look.chains" : "look.chain");
        return say(noun === "CHAINS" ? "look.noChains" : "look.noChain");
      case "GARDEN": case "GARDENS":
        if (room !== 33) return say("look.noGarden");
        // From the balcony you can see the gem lying in the fountain down in the garden.
        if (item("large_gem").hidden) return reveal("large_gem"), say("look.gardenGem");
        return say("look.garden");
      case "BALCONY": return say(room === 33 ? "look.balcony" : "look.noBalcony");
    }
    if (STONE_NOUNS.includes(noun)) {
      if (room === 74) return say("look.kevin");
      if (room === 83) return say("look.colors");
      if (room === COURTYARD && (noun === "WALL" || noun === "WALLS")) {
        if (highScore && highScore.name)
          return say("look.highScore", { T: highScore.name, S: String(highScore.points ?? "") });
        return say("look.noHighScore");
      }
      const n = noun === "WALLS" ? "WALL" : noun === "ARCHWAYS" ? "ARCHWAY" : noun;
      return say("look.grayStone", { N: n });
    }
    if (noun === "GATE" && room === COURTYARD) return say("look.strong");
    if (noun === "DOOR" && (room === 82 || room === 68)) return say("look.strong");
    const m = findMonsterHere(noun);
    if (m) {
      if (m.kind === "fairy") return say("look.fairy", { M: shortName(m.id) });
      return say(m.strength > 0 ? "look.monsterMean" : "look.monsterDead", { M: shortName(m.id) });
    }
    return say("look.unknown", { N: noun });
  }

  function drop(noun) {
    const it = ITEMS.find((i) => i.noun === noun && carried(i.id));
    if (!it) return say("dropDontHave", { N: noun });
    const { dr, dc } = s.player.lastMove; // you drop things in the direction you last moved
    const r = s.player.row + dr, c = s.player.col + dc;
    if (!isClear(r, c)) return say("dropBlocked");
    s.player.inventory = s.player.inventory.filter((id) => id !== it.id);
    Object.assign(item(it.id), { room: here(), row: r, col: c, hidden: false });
    out.push({ type: "dropped", item: it.id });
    say("dropDone");
  }

  function get(noun) {
    const room = here();
    if (noun === "BLOOD") return say("getBlood");
    const it = findItemByNoun(noun);
    if (it) {
      const st = item(it.id);
      if (st.room === room) return say("getItYourself"); // you have to walk into it
      if (carried(it.id)) return say("getAlreadyHave");
      if (!(st.hidden && st.hiddenIn === room)) return say("getDontSee", { N: noun });
      // A hidden item is picked up from next to the furniture it is hidden in.
      if (!nextTo((r, c) => it.hiddenNear.includes(glyphAt(room, r, c)))) return say("getCantReach");
      if (s.player.inventory.length >= MAX_INVENTORY) return say("cantCarry");
      pickUp(it.id);
      return say("getDone");
    }
    if (HEAVY[noun]) {
      const n = noun.endsWith("S") ? noun : `${noun}S`;
      return say(HEAVY[noun].includes(room) ? "getTooHeavy" : "getTooHeavyNone", { N: n });
    }
    if ((noun === "CHAIN" || noun === "CHAINS") && room === 79) return say("getChains");
    if (noun === "WINE" && room === 68) return say("getBarrelsEmpty");
    if (noun === "WATER" && room === 18) {
      if (!carried("wine_flask")) return say("getNoContainer");
      if (s.flags.flaskFull) return say("getFlaskFull");
      if (!nextTo((r, c) => ["│", "─"].includes(glyphAt(room, r, c)))) return say("getCantReach");
      s.flags.flaskFull = true;
      out.push({ type: "filled", item: "wine_flask" });
      return say("getDone");
    }
    return say(findMonsterHere(noun) ? "getMonster" : "impossible");
  }

  // WEAR, PLAY, WAVE and RUB first look the item up by name, then check you carry it.
  function carriedItem(noun, notCarriedKey) {
    const it = findItemByNoun(noun);
    if (!it) {
      say("dontHaveA", { N: noun });
      return null;
    }
    if (!carried(it.id)) {
      say(notCarriedKey, { N: noun });
      return null;
    }
    return it;
  }

  function wear(noun) {
    const it = carriedItem(noun, "dontHaveIt");
    if (!it) return;
    if (it.id === "necklace" || it.id === "helmet") return say("wearIt");
    if (it.id === "crown") return say("wearCrown");
    if (it.id === "glasses") return say("wearThem");
    return say("wearDifficult");
  }

  function play(noun) {
    const it = carriedItem(noun, "dontHaveIt");
    if (!it) return;
    if (it.id !== "harp") return say("playHorrible", { N: noun });
    const block = lines("playHarp");
    const fairy = mon("fairy");
    if (fairy.room === here()) {
      Object.assign(fairy, { room: null, row: null, col: null });
      block.push(...lines("fairyLeaves"));
      out.push({ type: "monsterLeft", monster: "fairy" });
    }
    sayLines(block);
  }

  function vampireLeaves() {
    Object.assign(mon("vampire"), { room: null, row: null, col: null });
    out.push({ type: "monsterLeft", monster: "vampire" });
    say("vampireGone");
  }

  function wave(noun) {
    const it = carriedItem(noun, "dontHaveA");
    if (!it) return;
    const room = here();
    if (it.id === "magic_wand") {
      if (room === 67) {
        addMods(MODS.mirrorOpen);
        out.push({ type: "mapChanged", room });
        return say("waveSecret", { N: noun });
      }
      if (room === 77 && glyphAt(77, 17, 11) !== " ") {
        addMods(MODS.passageOpen);
        out.push({ type: "mapChanged", room });
        return say("waveSecret", { N: noun });
      }
      return say("waveNothing", { N: noun });
    }
    if (it.id === "holy_cross" && room === 28) return vampireLeaves();
    if (it.id === "scepter") {
      if (room !== COURTYARD) return say("waveNothing", { N: noun });
      addMods(MODS.gateOpen);
      out.push({ type: "mapChanged", room });
      return say("waveScepterGate");
    }
    return say("waveSilly", { N: noun });
  }

  function rub(noun) {
    const it = carriedItem(noun, "dontHaveA");
    if (!it) return;
    return say(it.id === "lamp" ? "rubLamp" : "rubCleaner", { N: noun });
  }

  function sayWords(text) {
    const m = monstersHere()[0];
    if (m) return say("sayFunny", { T: text, M: shortName(m.id) });
    return say("say", { T: text });
  }

  function lock(verb, noun) {
    const room = here();
    if (!carried("key")) return say("noKey");
    if (noun === "GATE") {
      if (room !== COURTYARD) return say("noGate");
      return say(verb === "UNLOCK" ? "gateMagic" : "gateAlreadyLocked");
    }
    if (noun !== "DOOR") return say("impossible");
    if (room !== 68 && room !== 82) return say("noDoor");
    const doors = room === 68 ? ["door1", "door2"] : ["door3", "door4"];
    if (verb === "UNLOCK" && !nextTo((r, c) => doors.some((id) => mon(id).room === room &&
        mon(id).row === r && mon(id).col === c))) return say("getCantReach");
    if (verb === "LOCK") {
      for (const id of doors) Object.assign(mon(id), { room, row: MONSTER_BY_ID[id].row,
        col: MONSTER_BY_ID[id].col, alive: true });
      s.flags[room === 68 ? "cellarLocked" : "dungeonLocked"] = true;
    } else {
      // Unlocking also steps you next to the doorway, the way the original redraws you.
      if (room === 68) {
        s.player.row = s.player.row > 14 ? 15 : 13;
        s.player.col = 8;
      } else {
        s.player.col = s.player.col < 13 ? 12 : 14;
        s.player.row = 8;
      }
      for (const id of doors) Object.assign(mon(id), { room: null, row: null, col: null, alive: false });
      s.flags[room === 68 ? "cellarLocked" : "dungeonLocked"] = false;
    }
    out.push({ type: verb === "LOCK" ? "locked" : "unlocked", room });
    return say("lockDone");
  }

  function drink(noun) {
    if (noun !== "WATER") return say("drinkNoneOf", { N: noun });
    if (!s.flags.flaskFull || !carried("wine_flask")) return say("drinkNoneOf", { N: noun });
    // Only the first drink restores you; after that the water just tastes good.
    if (s.flags.drankWater) return say("drinkGoodAgain");
    s.flags.drankWater = true;
    s.flags.flaskFull = false;
    s.player.strength = MAX_STRENGTH;
    return say("drinkGood");
  }

  function pour(noun) {
    if (noun !== "WATER") return say("pourNone");
    if (!s.flags.flaskFull || !carried("wine_flask")) return say("pourNothing");
    s.flags.flaskFull = false;
    return say(carried("goblet") ? "pourGoblet" : "pour");
  }

  function read(noun) {
    if (noun !== "BOOK") return say("readWhat");
    if (!carried("book")) return say("readNoBook");
    if (!carried("glasses")) return say("readBlurry");
    return say("readBook");
  }

  function show(noun) {
    const it = ITEMS.find((i) => i.noun === noun && carried(i.id));
    if (!it) return say("showDontHave", { N: noun });
    const vampire = mon("vampire");
    if (it.id === "holy_cross" && vampire.room === here()) return vampireLeaves();
    const audience = monstersHere()[0];
    if (vampire.room === here() || mon("fairy").room === here() || liveFightersHere().length)
      return say("showFunny", { M: shortName(audience.id) });
    return say("showNobody");
  }

  // Runs a typed command the way the original's parser did ("GET FLASK", "INV").
  function typed(text) {
    const cmd = String(text).toUpperCase();
    if (cmd.length > 2 && cmd.startsWith("INV")) return inventory();
    if (cmd === "QUIT") return say("quit");
    const space = cmd.indexOf(" ");
    if (space < 1 || space >= cmd.length - 1) return say("what");
    return command(cmd.slice(0, space), cmd.slice(space + 1));
  }

  // ---------------------------------------------------------------------------------------------
  // structured actions from the UI
  function nounFor(action) {
    if (action.item) {
      const it = ITEM_BY_ID[action.item];
      if (!it) throw new Error(`unknown item ${action.item}`);
      return it.noun;
    }
    const t = action.target;
    if (t == null) return null;
    if (MONSTER_BY_ID[t]) return MONSTER_BY_ID[t].noun;
    const kind = MONSTERS.find((m) => m.kind === t);
    if (kind) return kind.noun;
    return String(t).toUpperCase();
  }

  // "use" isn't an original verb; it stands for whatever you would naturally do with the item.
  const USE = { lamp: "rub", harp: "play", necklace: "wear", glasses: "wear", helmet: "wear",
    crown: "wear", book: "read", key: "unlock", crystal_ball: "look" };

  function verbAction(action) {
    let verb = action.verb;
    if (verb === "use") {
      if (!action.item) return say("what");
      verb = action.item === "wine_flask" ? (s.flags.flaskFull ? "drink" : "fill") : USE[action.item] ?? "wave";
      action = { ...action, verb };
    }
    if (verb === "inventory") return inventory();
    // LOOK on its own re-reads the room description (the original wanted a noun).
    if ((verb === "look" || verb === "search" || verb === "examine") && !action.item && action.target == null) {
      const room = ROOM[here()];
      out.push({ type: "message", text: room.description, lines: room.descriptionLines ?? [], kind: "description" });
      return;
    }
    const word = VERBS[verb];
    if (!word) return say("what");
    if (verb === "say") return sayWords(String(action.text ?? action.target ?? "").toUpperCase());
    // Convenience: taking a visible item you stand next to picks it up, as running into it would.
    if (word === "GET" && action.item) {
      const st = item(action.item);
      if (st && st.room === here() && Math.abs(st.row - s.player.row) <= 1 &&
          Math.abs(st.col - s.player.col) <= 1) return pickUp(action.item);
    }
    if (verb === "fill") return command("FILL", "FLASK");
    if ((verb === "drink" || verb === "pour") && (action.item === "wine_flask" || action.target == null))
      return command(word, "WATER");
    if ((verb === "unlock" || verb === "lock" || verb === "open" || verb === "close") &&
        (action.item === "key" || action.target == null))
      return command(word, here() === COURTYARD ? "GATE" : "DOOR");
    let noun = nounFor(action);
    if (noun == null) {
      if (verb === "jump" || verb === "leep") noun = "DOWN";
      else if (verb === "mirror") noun = "MIRROR";
      else return say("what");
    }
    return command(word, noun);
  }

  // ---------------------------------------------------------------------------------------------
  // public API
  function run(fn) {
    out = [];
    if (s.status === "playing") {
      fn();
      if (s.status === "playing") updateScore();
    }
    const events = out;
    out = [];
    return events;
  }

  function act(action) {
    if (!action || typeof action !== "object") throw new Error("act needs an action object");
    return run(() => {
      s.turn++;
      if (action.type === "move") move(action.dir);
      else if (action.type === "verb") verbAction(action);
      else if (action.type === "command") typed(action.text ?? "");
      else throw new Error(`unknown action type ${action.type}`);
    });
  }

  function tick(ms) {
    return run(() => {
      s.clockMs += Math.max(0, Number(ms) || 0);
      let steps = 0;
      while (s.clockMs >= monsterStepMs && s.status === "playing") {
        s.clockMs -= monsterStepMs;
        monsterStep();
        if (++steps >= 50) s.clockMs = 0; // a huge gap (tab asleep) doesn't replay forever
      }
    });
  }

  function tileGrid(roomId) {
    const grid = BASE_TILES[roomId];
    if (!grid) throw new Error(`no room ${roomId}`);
    const result = grid.map((row) => row.slice());
    if (roomId === here())
      for (const m of s.mods) result[m.row][m.col] = m.tile ?? tileForGlyph(roomId, m.glyph, m.row, m.col);
    return result;
  }

  function describe(roomId, row, col) {
    if (!ROOM[roomId] || !inBounds(row, col)) return null;
    if (roomId === here() && s.player.row === row && s.player.col === col) return "You";
    const m = monsterAt(roomId, row, col);
    if (m) return m.alive || m.kind === "door" ? m.name : `Dead ${m.name.split(" ").pop()}`;
    const it = itemAt(roomId, row, col);
    if (it) return it.name;
    return tileName(roomId, tileGrid(roomId)[row][col]);
  }

  function availableActions() {
    if (s.status !== "playing") return [];
    const acts = [];
    const used = new Set();
    const add = (a, key) => {
      if (key && !used.has(key)) {
        used.add(key);
        a.key = key;
      }
      acts.push(a);
    };
    const room = here();
    const { row, col } = s.player;
    // take: visible items next to you, and hidden items you have found out about
    for (const it of ITEMS) {
      const st = item(it.id);
      if (st.room === room && Math.abs(st.row - row) <= 1 && Math.abs(st.col - col) <= 1)
        add({ id: `take:${it.id}`, verb: "take", item: it.id, label: `Take ${it.name}` }, "t");
      else if (st.hidden && st.revealed && st.hiddenIn === room &&
          nextTo((r, c) => it.hiddenNear.includes(glyphAt(room, r, c))))
        add({ id: `take:${it.id}`, verb: "take", item: it.id, label: `Take ${it.name}` }, "t");
    }
    // things to do with what you carry
    const has = (id) => carried(id);
    if (has("wine_flask") && !s.flags.flaskFull &&
        ((room === 18 && nextTo((r, c) => ["│", "─"].includes(glyphAt(room, r, c)))) || room === 68))
      add({ id: "fill:wine_flask", verb: "fill", item: "wine_flask", label: "Fill Wine Flask" }, "f");
    if (has("wine_flask") && s.flags.flaskFull) {
      add({ id: "drink:wine_flask", verb: "drink", item: "wine_flask", label: "Drink water" }, "k");
      add({ id: "pour:wine_flask", verb: "pour", item: "wine_flask", label: "Pour out water" });
    }
    if (has("key") && (room === 68 || room === 82)) {
      const locked = room === 68 ? s.flags.cellarLocked : s.flags.dungeonLocked;
      if (locked) add({ id: "unlock:door", verb: "unlock", target: "door", label: "Unlock Door" }, "u");
      else add({ id: "lock:door", verb: "lock", target: "door", label: "Lock Door" });
    }
    if (has("key") && room === COURTYARD)
      add({ id: "unlock:gate", verb: "unlock", target: "gate", label: "Unlock Gate" }, "u");
    const uses = { lamp: ["rub", "Rub", "r"], harp: ["play", "Play", "p"], necklace: ["wear", "Wear", "e"],
      book: ["read", "Read", "b"], magic_wand: ["wave", "Wave", "v"], glasses: ["wear", "Wear", "e"],
      helmet: ["wear", "Wear", "e"], holy_cross: ["wave", "Wave", "v"], scepter: ["wave", "Wave", "v"],
      crown: ["wear", "Wear", "e"] };
    for (const id of s.player.inventory) {
      const u = uses[id];
      if (u) add({ id: `${u[0]}:${id}`, verb: u[0], item: id, label: `${u[1]} ${ITEM_BY_ID[id].name}` }, u[2]);
    }
    if (has("holy_cross") && mon("vampire").room === room)
      add({ id: "show:holy_cross", verb: "show", item: "holy_cross", label: "Show Holy Cross" }, "h");
    // looking around
    for (const f of FEATURES[room] ?? [])
      add({ id: `look:${f}`, verb: "look", target: f, label: `Look at ${f}` }, "l");
    const seen = new Set();
    for (const m of monstersHere()) {
      const noun = MONSTER_BY_ID[m.id].noun;
      if (seen.has(noun)) continue;
      seen.add(noun);
      add({ id: `look:${m.id}`, verb: "look", target: m.id,
        label: `Look at ${m.alive ? m.name : `Dead ${m.name.split(" ").pop()}`}` }, "l");
    }
    if (room === 67) add({ id: "mirror:mirror", verb: "mirror", target: "mirror", label: "Mirror, mirror..." });
    for (const id of s.player.inventory)
      add({ id: `look:${id}`, verb: "look", item: id, label: `Look at ${ITEM_BY_ID[id].name}` });
    for (const id of s.player.inventory)
      add({ id: `drop:${id}`, verb: "drop", item: id, label: `Drop ${ITEM_BY_ID[id].name}` }, "x");
    add({ id: "inventory", verb: "inventory", label: "Inventory" }, "i");
    return acts;
  }

  function getState() {
    return clone(s);
  }

  function load(state) {
    if (!state || typeof state !== "object" || !state.player || !state.items || !state.monsters)
      throw new Error("not a Castle Adventure save");
    if (state.version !== STATE_VERSION) throw new Error(`unsupported save version ${state.version}`);
    const next = clone(state);
    for (const it of ITEMS) if (!next.items[it.id]) throw new Error(`save is missing item ${it.id}`);
    for (const m of MONSTERS) if (!next.monsters[m.id]) throw new Error(`save is missing monster ${m.id}`);
    if (!ROOM[next.player.room]) throw new Error(`save has unknown room ${next.player.room}`);
    s = next;
  }

  const dev = {
    setNoclip(on) {
      s.dev.noclip = !!on;
    },
    setGod(on) {
      s.dev.god = !!on;
    },
    teleport(roomId, row, col) {
      if (!ROOM[roomId]) throw new Error(`no room ${roomId}`);
      out = [];
      const [r, c] = row == null || col == null ? ARRIVAL[roomId] : [row, col];
      if (s.status === "playing") enterRoom(roomId, r, c);
      const events = out;
      out = [];
      return events;
    },
    giveItem(itemId) {
      if (!ITEM_BY_ID[itemId]) throw new Error(`no item ${itemId}`);
      if (carried(itemId)) return [];
      return run(() => {
        Object.assign(item(itemId), { room: null, row: null, col: null, hidden: false });
        s.player.inventory.push(itemId);
        out.push({ type: "took", item: itemId });
      });
    },
    setStrength(n) {
      s.player.strength = Math.max(0, Math.round(Number(n) || 0));
    },
  };

  return { act, tick, availableActions, tileGrid, describe, getState, load, dev };
}

// A sensible place to put the player when teleporting into a room: the open floor cell nearest
// the middle that you could actually walk to from one of the room's ways in.
function arrivalSpots(ROOM) {
  const spots = {};
  for (const id of Object.keys(ROOM)) {
    const room = ROOM[id];
    const m = room.map;
    const open = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS && m[r][c] === " ";
    const seen = new Set();
    const queue = [];
    const push = (r, c) => {
      if (open(r, c) && !seen.has(r * COLS + c)) {
        seen.add(r * COLS + c);
        queue.push([r, c]);
      }
    };
    const e = room.exits;
    for (let c = 0; c < COLS; c++) {
      if (e.north && open(0, c) && open(1, c)) push(0, c);
      if (e.south && open(17, c) && open(16, c)) push(17, c);
    }
    for (let r = 0; r < ROWS; r++) {
      if (e.west && open(r, 0) && open(r, 1)) push(r, 0);
      if (e.east && open(r, 23) && open(r, 22)) push(r, 23);
    }
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (m[r][c] === "U" || m[r][c] === "D")
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) push(r + dr, c + dc);
    while (queue.length) {
      const [r, c] = queue.shift();
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) push(r + dr, c + dc);
    }
    let best = [8, 11], bestD = Infinity;
    for (const k of seen) {
      const r = Math.floor(k / COLS), c = k % COLS;
      const d = (r - 8.5) ** 2 + (c - 11.5) ** 2;
      if (d < bestD) {
        bestD = d;
        best = [r, c];
      }
    }
    spots[id] = best;
  }
  return spots;
}

export { TILE_IDS };
