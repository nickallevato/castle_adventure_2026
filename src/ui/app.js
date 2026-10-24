// Wires the engine to the emulated screen, the HTML chrome, input, saves, maps and dev mode.

import { GameScreen } from "./screen.js";
import { buildRoom, TILE } from "./art/room-builder.js";
import { playerBob, monsterBob, itemBob } from "./art/sprite-bobs.js";
import { Hud } from "./hud.js";
import { requester, el, fmtTime } from "./screens.js";
import { createSaveStore } from "./saves.js";
import { roomTitle } from "./room-names.js";
import { computeWorldLayout } from "./world-layout.js";
import { MapView } from "./worldmap.js";
import { DevPanel, showGallery } from "./dev.js";
import { createWalker, nextStep, walkPos } from "./walk.js";

const DIR_KEYS = { arrowup: "north", w: "north", arrowdown: "south", s: "south", arrowleft: "west", a: "west", arrowright: "east", d: "east" };
const now = () => performance.now();

export class App {
  constructor({ createGame, engineKind, rooms, params }) {
    this.createGame = createGame;
    this.engineKind = engineKind;
    this.rooms = rooms;
    this.roomById = new Map(rooms.map((r) => [r.id, r]));
    this.params = params;
    this.saves = createSaveStore();
    this.layout = computeWorldLayout(rooms);
    this.hud = new Hud({ onAction: (a) => this.doAction(a) });
    this.screen = new GameScreen(document.getElementById("screen"));
    this.roomCache = new Map();
    this.mode = "title";
    this.overlay = null; // { kind, close }
    this.held = [];
    this.lastStep = null;
    this.view = { player: null, mons: new Map() };
    this.effects = [];
    this.reveal = false;
    this.devOn = params.has("dev") || this.saves.getSetting("dev", false) === true && params.has("devkeep");
    this.map = new MapView(this);
    this.dev = new DevPanel(this);
    this.lastFrame = now();
    this.hidden = document.hidden;
  }

  // ---------- boot ----------
  start() {
    document.getElementById("app").classList.remove("booting");
    if (matchMedia("(pointer: coarse)").matches || "ontouchstart" in window) document.body.classList.add("touch");
    this.bindInput();
    addEventListener("resize", () => this.fit());
    document.addEventListener("visibilitychange", () => { this.hidden = document.hidden; });
    this.fit();
    this.schedule();
    const p = this.params;
    if (this.devOn) this.dev.show();
    const quick = p.has("gallery") || p.has("room") || p.has("worldmap") || p.has("flyover") || p.has("map") || p.has("play") || p.has("screen");
    if (!quick) return this.showTitle();
    this.newGame();
    if (p.has("room")) this.teleport(Number(p.get("room")), p.has("row") ? Number(p.get("row")) : undefined, p.has("col") ? Number(p.get("col")) : undefined);
    if (p.has("reveal")) this.setReveal(true);
    if (p.has("strength")) this.game.dev?.setStrength?.(Number(p.get("strength")));
    if (p.has("give")) for (const id of p.get("give").split(",")) this.devGive(id);
    this.refresh();
    if (p.has("worldmap")) this.map.open({ mode: "world", floor: p.has("floor") ? Number(p.get("floor")) : undefined, zoom: p.has("zoom") ? Number(p.get("zoom")) : undefined });
    else if (p.has("flyover")) this.map.open({ mode: "flyover", offset: Number(p.get("ft") || 0) });
    else if (p.has("map")) this.map.open({ mode: "explored" });
    const scr = p.get("screen");
    if (scr === "dead") this.showDeath(true);
    if (scr === "escaped") this.showEscape(true);
    if (scr === "title") this.showTitle();
    if (scr === "menu") this.openMenu();
    if (p.has("gallery")) showGallery(Number(p.get("gallery")) || 3);
  }

  fit() {
    const mon = document.getElementById("monitor");
    const narrow = matchMedia("(max-width: 860px), (max-aspect-ratio: 1/1)").matches;
    let w, h;
    if (narrow) { w = document.documentElement.clientWidth - 20; h = window.innerHeight * 0.62; }
    else { const r = mon.getBoundingClientRect(); w = r.width - 14; h = r.height - 14; }
    this.screen.resize(Math.max(320 / (devicePixelRatio || 1), w), Math.max(256 / (devicePixelRatio || 1), h));
    this.titleScreen?.resize(Math.min(innerWidth - 40, 1000), innerHeight - 220);
    this.map.resize?.();
  }

  // ---------- game lifecycle ----------
  newGame(seed) {
    const s = seed ?? (this.params.has("seed") ? Number(this.params.get("seed")) : (Date.now() & 0xffffff) || 1);
    this.game = this.createGame({ rooms: this.rooms, seed: s });
    this.state = this.game.getState();
    if (this.state.status === "title") this.handleEvents(this.game.act({ type: "verb", verb: "start" }) || []);
    this.state = this.game.getState();
    this.mode = "play";
    this.effects = [];
    this.view = { player: null, mons: new Map() };
    this.hud.clearLog();
    this.closeTitle();
    this.closeOverlay();
    this.screen.banner = null;
    this.enterRoomView(true);
    this.hud.log(this.roomById.get(this.state.player.room)?.description, "room");
    this.refresh();
    if (this.devOn) { this.dev.sync(); }
  }

  loadState(rec) {
    if (!rec) return false;
    this.newGame();
    try {
      this.game.load(rec.state);
    } catch (e) {
      console.warn("[castle] load failed", e);
      this.hud.log("That save could not be loaded.", "hit");
      return false;
    }
    this.state = this.game.getState();
    this.mode = this.state.status === "dead" ? "over" : "play";
    this.enterRoomView(true);
    this.hud.clearLog();
    this.hud.log("Game restored.", "score");
    this.hud.log(this.roomById.get(this.state.player.room)?.description, "room");
    this.refresh();
    return true;
  }

  get room() { return this.state?.player?.room; }

  builtRoom(id) {
    const grid = this.game.tileGrid(id);
    const key = id + ":" + grid.map((r) => r.join(",")).join("|");
    let b = this.roomCache.get(key);
    if (!b) {
      b = buildRoom(id, grid);
      b.key = key;
      this.roomCache.set(key, b);
      if (this.roomCache.size > 140) this.roomCache.delete(this.roomCache.keys().next().value);
    }
    return b;
  }

  enterRoomView(instant = false) {
    const b = this.builtRoom(this.room);
    this.screen.setRoom(b, { instant });
    this.currentBuilt = b;
    const r = this.roomById.get(this.room);
    this.hud.setRoom(roomTitle(r?.description), r?.description || "");
    const p = this.state.player;
    this.view.player = createWalker(p.col * TILE, p.row * TILE);
    this.view.mons.clear();
  }

  refresh() {
    const st = this.state;
    if (!st) return;
    // rebuild the room if its tiles changed (gates opening, etc.)
    const b = this.builtRoom(this.room);
    if (b !== this.currentBuilt && this.screen.room === this.currentBuilt) { this.screen.setRoom(b, { instant: true }); this.currentBuilt = b; }
    this.hud.setStats(st);
    this.hud.setInventory(st);
    this.hud.setActions(this.mode === "play" ? this.safe(() => this.game.availableActions(), []) : []);
    this.screen.setStatus({
      name: roomTitle(this.roomById.get(this.room)?.description),
      strength: st.player.strength, maxStrength: st.player.maxStrength ?? 100,
      score: st.score ?? 0, found: st.treasuresFound ?? 0, total: st.treasuresTotal ?? 0,
    });
    this.dev.sync();
  }

  safe(fn, fallback) { try { return fn(); } catch (e) { console.warn("[castle] engine call failed", e); return fallback; } }

  // ---------- actions and events ----------
  /** Step now if the walk rhythm allows it (a fresh press, or the next beat while held). */
  tryMove(dir, t = now(), fresh = false) {
    const due = nextStep(this.lastStep, t, !!dir, fresh);
    if (due !== null) this.move(dir, due);
  }

  move(dir, at = now()) {
    if (!this.canPlay()) return;
    const before = this.state.player;
    this.lastStep = at;
    const ev = this.safe(() => this.game.act({ type: "move", dir }), []);
    this.after(ev, before, at);
  }

  doAction(a) {
    if (!this.canPlay()) return;
    const before = this.state.player;
    const ev = this.safe(() => this.game.act({ type: "verb", verb: a.verb, item: a.item, target: a.target }), []);
    this.after(ev, before);
  }

  after(ev, before, at = now()) {
    this.state = this.game.getState();
    this.handleEvents(ev || []);
    const p = this.state.player, v = this.view.player;
    if (v && p.room === before.room && (p.row !== before.row || p.col !== before.col)) {
      v.startFrom(before.col * TILE, before.row * TILE, at);
    } else if (v && p.room === before.room && p.facing !== before.facing) { /* turn in place */ }
    this.refresh();
  }

  handleEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case "message": this.hud.log(e.text, e.kind === "description" ? "room" : ""); break;
        case "roomChanged":
          this.state = this.game.getState();
          this.enterRoomView(false);
          this.saves.autosave(this.state, { room: e.to, title: roomTitle(this.roomById.get(e.to)?.description), score: this.state.score });
          break;
        case "hit": this.onHit(e); break;
        case "scored": this.effect(`+${e.points}`, null, 250); this.hud.log(`You scored ${e.points} points.`, "score"); break;
        case "died": this.mode = "over"; setTimeout(() => this.showDeath(), 900); break;
        case "escaped": this.mode = "over"; setTimeout(() => this.showEscape(), 700); break;
        default: break; // took, dropped and anything new: state refresh covers it
      }
    }
  }

  onHit(e) {
    const st = this.state;
    const tgt = e.target === "player" ? null : st.monsters?.[e.target];
    const color = e.target === "player" ? 249 : 248;
    this.effect(`-${e.damage}`, tgt ? { x: tgt.col * TILE, y: tgt.row * TILE } : null, color);
    if (e.target === "player") { this.shakeUntil = now() + 160; }
  }

  effect(text, at, color) {
    const v = this.view.player;
    const pos = at || (v ? { x: v.x, y: v.y } : { x: 140, y: 100 });
    this.effects.push({ text, x: pos.x + 6 - text.length * 3, y: pos.y - 4, t0: now(), color });
  }

  canPlay() { return this.mode === "play" && !this.overlay && !this.map.isOpen && this.state?.status !== "dead"; }

  teleport(roomId, row, col) {
    if (!this.roomById.has(roomId)) return;
    const ev = this.safe(() => this.game.dev.teleport(roomId, row, col), []);
    this.state = this.game.getState();
    this.handleEvents(ev || []);
    if (this.state.player.room === roomId && this.screen.room?.id !== roomId) { this.enterRoomView(true); }
    else if (!(ev || []).some((x) => x.type === "roomChanged")) this.enterRoomView(true);
    this.refresh();
  }

  setReveal(b) { this.reveal = !!b; this.map.invalidate?.(); }
  devGive(id) { this.handleEvents(this.safe(() => this.game.dev.giveItem(id), []) || []); this.state = this.game.getState(); this.refresh(); }

  // ---------- frame loop ----------
  // rAF drives the frame loop; a timer keeps it alive where rAF doesn't fire (headless capture)
  schedule() {
    if (!this.rafPending) {
      this.rafPending = true;
      requestAnimationFrame(() => { this.rafPending = false; this.loop(now()); });
    }
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.loop(now()), 50);
  }

  loop(t) {
    this.schedule();
    if (t - this.lastFrame < 4) return;
    const dt = Math.min(100, t - this.lastFrame);
    this.lastFrame = t;
    if (this.titleScreen) { this.titleScreen.frame(t, [], [], null); }
    if (this.map.isOpen) { this.map.frame(t); return; }
    if (!this.game) return;
    const paused = this.hidden || !!this.overlay || this.mode !== "play";
    if (!paused) {
      // held direction repeat
      const dir = this.heldDir();
      if (dir) this.tryMove(dir, t);
      const ev = this.safe(() => this.game.tick(dt), []);
      if (ev && ev.length) { this.state = this.game.getState(); this.handleEvents(ev); this.refresh(); }
      else if (this.mode === "play" && (t | 0) % 6 === 0) this.state = this.game.getState();
    }
    this.draw(t, paused);
  }

  draw(t, paused) {
    const st = this.state;
    if (!st) return;
    const dark = this.screen.room?.dark;
    const ents = [];
    const roomId = this.screen.room?.id ?? st.player.room;
    const showRoom = roomId === st.player.room;
    // player position, smoothly interpolated
    const v = this.view.player;
    const p = st.player;
    const tx = p.col * TILE, ty = p.row * TILE;
    if (v) walkPos(v, tx, ty, t);
    const light = v ? { x: v.x + 6, y: v.y + 6 } : null;
    const inLight = (x, y) => !dark || this.reveal || !light || Math.hypot(x + 6 - light.x, y + 6 - light.y) < 60;
    if (showRoom) {
      for (const it of Object.values(st.items || {})) {
        if (it.room !== roomId || it.row == null) continue;
        if ((it.hidden || it.visible === false) && !this.reveal) continue;
        const x = it.col * TILE, y = it.row * TILE;
        if (!inLight(x, y)) continue;
        ents.push({ bob: itemBob(it.id, dark), x, y, z: y - 1 });
      }
      const frame = Math.floor(t / 280) & 1;
      for (const m of Object.values(st.monsters || {})) {
        if (!m.alive || m.room !== roomId) continue;
        if ((m.hidden || m.visible === false) && !this.reveal) continue;
        let mv = this.view.mons.get(m.id);
        const mx = m.col * TILE, my = m.row * TILE;
        if (!mv) { mv = { x: mx, y: my, fx: mx, fy: my, tx: mx, ty: my, t0: 0 }; this.view.mons.set(m.id, mv); }
        if (mv.tx !== mx || mv.ty !== my) { mv.fx = mv.x; mv.fy = mv.y; mv.tx = mx; mv.ty = my; mv.t0 = t; }
        const k = mv.t0 ? Math.min(1, (t - mv.t0) / 180) : 1;
        mv.x = mv.fx + (mx - mv.fx) * k; mv.y = mv.fy + (my - mv.fy) * k;
        if (!inLight(mv.x, mv.y)) continue;
        ents.push({ bob: monsterBob(m.kind, m.kind === "door" ? 0 : frame, dark), x: mv.x, y: mv.y });
      }
      if (v && st.status !== "dead") {
        const walking = v.walking(t);
        const f = walking ? (v.step & 1) : 0;
        let sx = v.x, sy = v.y;
        if (this.shakeUntil && t < this.shakeUntil) sx += Math.round(Math.sin(t * 0.09) * 1.5);
        ents.push({ bob: playerBob(p.facing, f, dark), x: sx, y: sy, z: sy + 0.5 });
      }
    }
    const texts = [];
    this.effects = this.effects.filter((e) => t - e.t0 < 800);
    for (const e of this.effects) texts.push({ text: e.text, x: e.x, y: e.y - ((t - e.t0) / 800) * 12, color: e.color });
    this.screen.frame(t, ents, texts, light, paused && !this.screen.banner);
  }

  // ---------- input ----------
  bindInput() {
    addEventListener("keydown", (e) => this.onKey(e));
    addEventListener("keyup", (e) => {
      const d = DIR_KEYS[e.key.toLowerCase()];
      if (d) this.held = this.held.filter((x) => x !== d);
    });
    addEventListener("blur", () => { this.held = []; });
    const cv = document.getElementById("screen");
    cv.addEventListener("pointermove", (e) => this.hover(e));
    cv.addEventListener("pointerleave", () => this.hud.tooltip(null));
    cv.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse") { this.hover(e); clearTimeout(this.tipTimer); this.tipTimer = setTimeout(() => this.hud.tooltip(null), 1800); }
    });
    document.getElementById("btn-menu").addEventListener("click", () => this.openMenu());
    document.getElementById("btn-map").addEventListener("click", () => this.map.open({ mode: "explored" }));
    for (const b of document.querySelectorAll("#dpad [data-dir]")) {
      const dir = b.dataset.dir;
      const down = (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); this.held = this.held.filter((x) => x !== dir).concat(dir); this.tryMove(dir, now(), true); };
      const up = () => { this.held = this.held.filter((x) => x !== dir); };
      b.addEventListener("pointerdown", down);
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    }
  }

  // two perpendicular direction keys held together walk diagonally (the original had 8 directions)
  heldDir() {
    const h = this.held;
    if (!h.length) return null;
    const v = [...h].reverse().find((d) => d === "north" || d === "south");
    const x = [...h].reverse().find((d) => d === "east" || d === "west");
    return v && x ? v + x : h[h.length - 1];
  }

  hover(e) {
    if (!this.game || this.mode === "title") return;
    const hit = this.screen.pick(e.clientX, e.clientY);
    if (!hit) return this.hud.tooltip(null);
    const txt = this.safe(() => this.game.describe(this.room, hit.row, hit.col), null);
    this.hud.tooltip(txt, e.clientX, e.clientY);
  }

  onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "`" || e.code === "Backquote") { e.preventDefault(); return this.dev.toggle(); }
    if (this.map.isOpen) return this.map.onKey(e);
    if (this.overlay) {
      if (k === "escape") { e.preventDefault(); this.closeOverlay(); }
      else this.overlay.onKey?.(e);
      return;
    }
    if (this.titleScreen) {
      if (k === "enter" || k === "n") { e.preventDefault(); this.newGame(); }
      else if (k === "c" && this.saves.hasAutosave()) { e.preventDefault(); this.loadState(this.saves.loadAutosave()); }
      else if (k === "l") { e.preventDefault(); this.openSlots("load"); }
      return;
    }
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    const d = DIR_KEYS[k];
    if (d) {
      e.preventDefault();
      if (e.repeat) return;
      this.held = this.held.filter((x) => x !== d).concat(d);
      this.tryMove(this.heldDir(), now(), true);
      return;
    }
    if (k === "escape") { e.preventDefault(); return this.openMenu(); }
    if (k === "m") { e.preventDefault(); return this.map.open({ mode: "explored" }); }
    const a = this.hud.actionForKey(k);
    if (a && this.canPlay()) { e.preventDefault(); this.doAction(a); }
  }

  // ---------- overlays ----------
  setOverlay(o) { this.closeOverlay(); this.overlay = o; this.held = []; }
  closeOverlay() { const o = this.overlay; this.overlay = null; o?.close?.(); }

  openMenu() {
    if (this.mode === "title") return;
    const r = requester({
      title: "Castle Adventure",
      layout: "col",
      body: [el("p", {}, "Game paused.")],
      buttons: [
        { label: "Resume", key: "r", onClick: () => this.closeOverlay() },
        { label: "Save game", key: "s", disabled: this.mode !== "play", onClick: () => this.openSlots("save") },
        { label: "Load game", key: "l", onClick: () => this.openSlots("load") },
        { label: "Explored map", key: "m", onClick: () => { this.closeOverlay(); this.map.open({ mode: "explored" }); } },
        { label: this.devOn ? "Hide dev mode" : "Dev mode", key: "d", onClick: () => { this.closeOverlay(); this.dev.toggle(); } },
        { label: "Quit to title", key: "q", onClick: () => { this.closeOverlay(); this.showTitle(); } },
      ],
      onClose: () => { if (this.overlay === r) this.overlay = null; },
    });
    this.setOverlay(r);
    this.overlay = r;
  }

  openSlots(kind) {
    const list = this.saves.list();
    const auto = this.saves.loadAutosave();
    const body = [el("p", {}, kind === "save" ? "Choose a slot to save into." : "Choose a saved game.")];
    const buttons = [];
    if (kind === "load" && auto) buttons.push({ label: `Autosave: ${auto.meta?.title || "?"} (${fmtTime(auto.savedAt)})`, key: "a", onClick: () => { this.closeOverlay(); this.loadState(auto); } });
    list.forEach((s, i) => {
      const n = i + 1;
      const label = s ? `Slot ${n}: ${s.title || "Room " + s.room} · ${s.score ?? 0} pts · ${fmtTime(s.savedAt)}` : `Slot ${n}: empty`;
      buttons.push({
        label, key: String(n), disabled: kind === "load" && !s,
        onClick: () => {
          if (kind === "save") {
            const ok = this.saves.save(n, this.game.getState(), { room: this.room, title: roomTitle(this.roomById.get(this.room)?.description), score: this.state.score });
            this.closeOverlay();
            this.hud.log(ok ? `Saved to slot ${n}.` : "Could not save (storage unavailable).", ok ? "score" : "hit");
          } else { this.closeOverlay(); this.closeTitle(); this.loadState(this.saves.load(n)); }
        },
      });
    });
    buttons.push({ label: "Cancel", key: "c", onClick: () => this.closeOverlay() });
    const r = requester({ title: kind === "save" ? "Save game" : "Load game", layout: "col", body, buttons, onClose: () => { if (this.overlay === r) this.overlay = null; } });
    this.setOverlay(r);
    this.overlay = r;
  }

  showDeath(force = false) {
    if (!force && this.state?.status !== "dead" && this.mode !== "over") return;
    this.screen.banner = { lines: ["YOU HAVE", "DIED"], palette: "blood" };
    const st = this.state;
    const r = requester({
      title: "Alas", low: true,
      body: [el("p", { class: "big" }, "You have died."), el("p", {}, `Score: ${st?.score ?? 0}   Treasures: ${st?.treasuresFound ?? 0} / ${st?.treasuresTotal ?? 0}`)],
      buttons: [
        { label: "New game", key: "n", onClick: () => this.newGame() },
        { label: "Load game", key: "l", onClick: () => this.openSlots("load") },
        { label: "Title", key: "t", onClick: () => { this.closeOverlay(); this.showTitle(); } },
      ],
    });
    this.setOverlay(r);
    this.overlay = r;
  }

  showEscape(force = false) {
    if (!force && this.state?.status !== "escaped" && this.mode !== "over") return;
    this.screen.banner = { lines: ["YOU", "ESCAPED!"], palette: "gold" };
    const st = this.state;
    const all = st && st.treasuresFound >= st.treasuresTotal;
    const r = requester({
      title: "Freedom", low: true,
      body: [
        el("p", { class: "big" }, "You escaped the castle!"),
        el("p", {}, `Final score: ${st?.score ?? 0}`),
        el("p", {}, `Treasures recovered: ${st?.treasuresFound ?? 0} / ${st?.treasuresTotal ?? 0}${all ? " (all of them!)" : ""}`),
      ],
      buttons: [
        { label: "New game", key: "n", onClick: () => this.newGame() },
        { label: "Title", key: "t", onClick: () => { this.closeOverlay(); this.showTitle(); } },
      ],
    });
    this.setOverlay(r);
    this.overlay = r;
  }

  // ---------- title ----------
  showTitle() {
    this.closeOverlay();
    this.map.close();
    this.mode = "title";
    if (this.titleScreen) return;
    const hasAuto = this.saves.hasAutosave();
    const hasSlots = this.saves.list().some(Boolean) || hasAuto;
    const canvas = el("canvas", { width: 320, height: 256, "aria-label": "Castle Adventure title" });
    const wrap = el("div", { id: "title-screen" },
      el("div", { class: "monitor" }, canvas),
      el("div", { class: "menu" },
        el("button", { class: "wb-btn", onclick: () => this.newGame() }, el("span", { class: "key" }, "N"), "New game"),
        el("button", { class: "wb-btn", disabled: !hasAuto, onclick: () => this.loadState(this.saves.loadAutosave()) }, el("span", { class: "key" }, "C"), "Continue"),
        el("button", { class: "wb-btn", disabled: !hasSlots, onclick: () => this.openSlots("load") }, el("span", { class: "key" }, "L"), "Load"),
      ),
      el("div", { class: "credit" }, "Kevin Bales' Castle Adventure (1984), on an emulated Amiga 1200. Arrows or WASD to move, M for the map, Esc for the menu."),
    );
    document.body.append(wrap);
    const ts = new GameScreen(canvas);
    const preview = this.createGame({ rooms: this.rooms, seed: 7 });
    ts.setRoom(buildRoom(18, preview.tileGrid(18)));
    ts.setStatus({ name: "Press N for a new game", strength: 100, maxStrength: 100, score: 0, found: 0, total: preview.getState().treasuresTotal ?? 13 });
    ts.banner = { lines: ["CASTLE", "ADVENTURE"], palette: "title" };
    ts.el = wrap;
    this.titleScreen = ts;
    ts.resize(Math.min(innerWidth - 40, 1000), innerHeight - 200);
  }

  closeTitle() {
    if (!this.titleScreen) return;
    this.titleScreen.el.remove();
    this.titleScreen = null;
  }
}
