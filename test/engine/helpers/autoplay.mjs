// A scripted player for the engine tests. It only changes the game through act() and tick();
// it reads getState() and the room maps to plan its route, like a player looking at the screen.
import { DIRS } from "../../../src/engine/index.js";

const DIR_BY_DELTA = Object.fromEntries(Object.entries(DIRS).map(([name, [dr, dc]]) => [`${dr},${dc}`, name]));
const TRAP_CELLS = { 76: [[12, 14], [13, 14]], 78: [[8, 17], [9, 17]] };

export class AutoPlayer {
  constructor(game, rooms, { msPerAction = 100, log = false } = {}) {
    this.game = game;
    this.rooms = Object.fromEntries(rooms.map((r) => [r.id, r]));
    this.msPerAction = msPerAction;
    this.events = [];
    this.actions = 0;
    this.log = log;
  }

  get s() {
    return this.game.getState();
  }

  do(action) {
    const ev = [...this.game.act(action), ...this.game.tick(this.msPerAction)];
    this.actions++;
    this.events.push(...ev);
    if (this.log) for (const e of ev) if (e.type === "message") console.log("   ", e.text);
    const st = this.s;
    if (st.status === "dead") throw new Error(`died after ${this.actions} actions:\n${this.recent()}`);
    return ev;
  }

  wait(ms) {
    const ev = this.game.tick(ms);
    this.events.push(...ev);
    if (this.s.status === "dead") throw new Error(`died while waiting:\n${this.recent()}`);
    return ev;
  }

  recent(n = 25) {
    return this.events.filter((e) => e.type === "message").slice(-n).map((e) => e.text).join("\n");
  }

  messages() {
    return this.events.filter((e) => e.type === "message").map((e) => e.text);
  }

  glyph(st, room, r, c) {
    if (room === st.player.room)
      for (let i = st.mods.length - 1; i >= 0; i--) {
        const m = st.mods[i];
        if (m.row === r && m.col === c) return m.glyph;
      }
    return this.rooms[room].map[r][c];
  }

  occupied(st, room, r, c) {
    for (const it of Object.values(st.items)) if (it.room === room && it.row === r && it.col === c) return true;
    for (const m of Object.values(st.monsters)) if (m.room === room && m.row === r && m.col === c) return true;
    return false;
  }

  // Breadth-first search over (room, row, col) from the player's position to a goal.
  plan(goal) {
    const st = this.s;
    const hasLamp = st.player.inventory.includes("lamp");
    const hasNecklace = st.player.inventory.includes("necklace");
    const start = [st.player.room, st.player.row, st.player.col];
    const key = (a) => a.join(":");
    const prev = new Map([[key(start), null]]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      const [room, r, c] = cur;
      if (goal(room, r, c, st)) {
        const moves = [];
        for (let k = key(cur); prev.get(k); k = key(prev.get(k).from)) moves.unshift(prev.get(k).dir);
        return moves;
      }
      for (const [dir, [dr, dc]] of Object.entries(DIRS)) {
        let next = null;
        const nr = r + dr, nc = c + dc;
        const exits = this.rooms[room].exits;
        const leave = (d, rr, cc) => {
          const to = exits[d];
          if (!to || ([68, 83].includes(to) && !hasLamp)) return null;
          return [to, rr, cc];
        };
        if (nr < 0) next = leave("north", 17, c);
        else if (nr > 17) next = leave("south", 0, c);
        else if (nc < 0) next = leave("west", r, 23);
        else if (nc > 23) next = leave("east", r, 0);
        else {
          const g = this.glyph(st, room, nr, nc);
          if (g === "U") next = leave("up", r, c);
          else if (g === "D") next = leave("down", r, c);
          else if (g === " " && !this.occupied(st, room, nr, nc) &&
              !(!hasNecklace && (TRAP_CELLS[room] ?? []).some(([y, x]) => y === nr && x === nc)))
            next = [room, nr, nc];
        }
        if (!next) continue;
        // the Sorcerer's lab spits you out inside the Sorcerer's room
        if (room === 66 && next[0] === 67) next = [67, 9, 16];
        const k = key(next);
        if (prev.has(k)) continue;
        prev.set(k, { from: cur, dir });
        queue.push(next);
      }
    }
    return null;
  }

  liveFighter(st = this.s) {
    return Object.values(st.monsters).find((m) => m.room === st.player.room && m.alive &&
      !["vampire", "fairy", "door"].includes(m.kind));
  }

  // Fight every live monster in the room (if we have the sword), drinking water when low.
  fightHere() {
    for (let guard = 0; guard < 3000; guard++) {
      const st = this.s;
      const m = this.liveFighter(st);
      if (!m || !st.player.inventory.includes("sword")) return;
      this.maybeDrink();
      const dr = m.row - st.player.row, dc = m.col - st.player.col;
      if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) {
        this.do({ type: "move", dir: DIR_BY_DELTA[`${dr},${dc}`] });
        continue;
      }
      // let it come to us, unless it is stuck behind something
      const before = `${m.row},${m.col}`;
      this.wait(this.msPerAction * 4);
      const after = Object.values(this.s.monsters).find((x) => x.id === m.id);
      if (`${after.row},${after.col}` === before) {
        const path = this.plan((room, r, c) => room === st.player.room &&
          Math.abs(r - after.row) <= 1 && Math.abs(c - after.col) <= 1);
        if (path && path.length) this.do({ type: "move", dir: path[0] });
        else return; // can't reach it; leave it be
      }
    }
    throw new Error("fight did not end");
  }

  maybeDrink() {
    const st = this.s;
    if (st.player.strength < 45 && st.flags.flaskFull && !st.flags.drankWater &&
        st.player.inventory.includes("wine_flask"))
      this.do({ type: "verb", verb: "drink", item: "wine_flask" });
  }

  // Walk until goal(room, row, col) holds, fighting whatever attacks on the way.
  walk(goal, what = "goal") {
    for (let guard = 0; guard < 5000; guard++) {
      const st = this.s;
      if (goal(st.player.room, st.player.row, st.player.col, st)) return;
      if (this.liveFighter(st) && st.player.inventory.includes("sword")) {
        this.fightHere();
        continue;
      }
      // follow the planned route while it still works; plan again when something gets in the way
      const here = `${st.player.room}:${st.player.row}:${st.player.col}`;
      if (!this.route || this.route.goal !== goal || this.route.at !== here || !this.route.moves.length) {
        const moves = this.plan(goal);
        if (!moves) throw new Error(`no path to ${what} from room ${st.player.room} (${st.player.row},${st.player.col})`);
        this.route = { goal, moves, at: here };
      }
      const dir = this.route.moves.shift();
      this.do({ type: "move", dir });
      const now = this.s.player;
      const [dr, dc] = DIRS[dir];
      const moved = now.room !== st.player.room || (now.row === st.player.row + dr && now.col === st.player.col + dc);
      this.route.at = moved ? `${now.room}:${now.row}:${now.col}` : null;
    }
    throw new Error(`walking to ${what} took too long`);
  }

  goTo(room, row, col) {
    this.walk((rm, r, c) => rm === room && (row == null || (r === row && c === col)), `room ${room}`);
  }

  // Stand next to a cell (8 directions).
  goNextTo(room, row, col) {
    this.walk((rm, r, c) => rm === room && Math.abs(r - row) <= 1 && Math.abs(c - col) <= 1 &&
      !(r === row && c === col), `next to ${room}:${row},${col}`);
  }

  // Stand next to any cell of the room whose glyph is one of `glyphs`.
  goNextToGlyph(room, glyphs) {
    const map = this.rooms[room].map;
    this.walk((rm, r, c) => {
      if (rm !== room) return false;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const y = r + dr, x = c + dc;
          if ((dr || dc) && y >= 0 && y < 18 && x >= 0 && x < 24 && glyphs.includes(map[y][x])) return true;
        }
      return false;
    }, `next to ${glyphs.join("")} in ${room}`);
  }

  take(itemId) {
    const it = this.s.items[itemId];
    this.goNextTo(it.room, it.row, it.col);
    this.fightHere();
    this.do({ type: "verb", verb: "take", item: itemId });
    if (!this.s.player.inventory.includes(itemId)) throw new Error(`could not take ${itemId}:\n${this.recent(5)}`);
  }

  verb(verb, extra = {}) {
    return this.do({ type: "verb", verb, ...extra });
  }

  // Drop items in the courtyard (or wherever we are), stepping into open floor first so the
  // cell we last moved toward is free.
  dropAll(ids) {
    for (const id of ids) {
      for (let tries = 0; tries < 30 && this.s.player.inventory.includes(id); tries++) {
        const ev = this.verb("drop", { item: id });
        if (ev.some((e) => e.type === "dropped")) break;
        // step somewhere open and try again
        const st = this.s;
        const dirs = Object.entries(DIRS).filter(([, [dr, dc]]) => {
          const r = st.player.row + dr, c = st.player.col + dc;
          const r2 = r + dr, c2 = c + dc;
          return r2 >= 0 && r2 < 18 && c2 >= 0 && c2 < 24 && this.glyph(st, st.player.room, r, c) === " " &&
            this.glyph(st, st.player.room, r2, c2) === " " && !this.occupied(st, st.player.room, r, c) &&
            !this.occupied(st, st.player.room, r2, c2);
        });
        if (!dirs.length) throw new Error("nowhere to drop");
        this.do({ type: "move", dir: dirs[tries % dirs.length][0] });
      }
      if (this.s.player.inventory.includes(id)) throw new Error(`could not drop ${id}`);
    }
  }
}
