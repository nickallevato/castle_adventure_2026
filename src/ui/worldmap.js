// World map (dev), explored map (M) and the flyover. Every room is rendered through the same
// planar / register / color-cycling pipeline as the game screen: each visible room's 8-plane buffer
// is converted with its area's live-cycled registers and composited onto one big map canvas.

import { buildRoom, PW, PH, TILE } from "./art/room-builder.js";
import { itemBob, monsterBob } from "./art/sprite-bobs.js";
import { createPlanes, copyPlanes } from "./amiga/bitplanes.js";
import { blit } from "./amiga/blitter.js";
import { Display } from "./amiga/display.js";
import { applyCycles } from "./amiga/palette.js";
import { darkLevels, animateTorch } from "./art/moods.js";
import { roomTitle } from "./room-names.js";
import { floorName } from "./world-layout.js";
import { el } from "./screens.js";

const GAP = 30;
const CW = PW + GAP, CH = PH + GAP;
const FLY_ORDER = [0, 1, 2, 3, 4, 5, -1];
const TRANSPARENT_NORMAL = [0, 1, 2, 3, 4, 5, 6, 7];
const TRANSPARENT_DARK = [0, 64, 128];

export class MapView {
  constructor(app) {
    this.app = app;
    this.isOpen = false;
    this.rooms = new Map(); // roomId -> { key, built, planes, display, canvas, ctx, image }
    this.cam = { x: 0, y: 0, z: 1 };
    this.drag = null;
    this.pointers = new Map();
  }

  get layout() { return this.app.layout; }

  open({ mode = "world", floor, zoom, offset = 0 } = {}) {
    const app = this.app;
    if (!app.game) return;
    if (this.isOpen) this.close();
    this.mode = mode;
    this.isOpen = true;
    app.held = [];
    const st = app.game.getState();
    this.visited = new Set(st.visited || []);
    this.visited.add(st.player.room);
    const cur = this.layout.rooms[st.player.room];
    this.floors = this.layout.floors.filter((f) => mode !== "explored" || f.rooms.some((id) => this.visited.has(id)));
    this.floor = floor ?? cur?.floor ?? 0;
    if (!this.floors.some((f) => f.level === this.floor)) this.floor = this.floors[0]?.level ?? 0;
    this.buildDom();
    this.fitFloor(zoom);
    if (mode === "explored" && cur && cur.floor === this.floor) this.centerOn(st.player.room, this.cam.z);
    if (mode === "flyover") this.startFlyover(offset);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.fly = null;
    this.root?.remove();
    this.caption?.remove();
    this.floorcard?.remove();
    this.root = this.caption = this.floorcard = null;
    this.app.refresh?.();
  }

  invalidate() { for (const r of this.rooms.values()) r.key = null; }

  buildDom() {
    const tabs = el("div", { class: "tabs" });
    const title = this.mode === "explored" ? "Explored map" : this.mode === "flyover" ? "Flyover" : "World map";
    this.canvas = el("canvas", { "aria-label": title });
    const bar = el("div", { class: "wb-screenbar" },
      el("span", { class: "wb-depth" }),
      el("span", { class: "sb-title" }, title),
      tabs,
      el("span", { class: "sb-spacer" }),
      el("span", { class: "hint" }, this.mode === "flyover" ? "any key or click stops" : this.mode === "world" ? "drag, wheel or pinch · click a room to teleport" : "drag, wheel or pinch"),
      this.mode === "world" ? el("button", { class: "wb-btn small", onclick: () => this.startFlyover(0) }, "Flyover") : null,
      el("button", { class: "wb-btn small", onclick: () => this.close() }, "Close"),
    );
    this.tabs = tabs;
    this.root = el("div", { id: "mapview" }, bar, this.canvas);
    document.body.append(this.root);
    this.renderTabs();
    this.ctx = this.canvas.getContext("2d");
    this.resize();
    const cv = this.canvas;
    cv.addEventListener("pointerdown", (e) => this.onDown(e));
    cv.addEventListener("pointermove", (e) => this.onMove(e));
    cv.addEventListener("pointerup", (e) => this.onUp(e));
    cv.addEventListener("pointercancel", (e) => { this.pointers.delete(e.pointerId); this.drag = null; });
    cv.addEventListener("wheel", (e) => { e.preventDefault(); if (this.fly) return this.stopFlyover(); this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  }

  renderTabs() {
    this.tabs.replaceChildren(...this.floors.map((f) =>
      el("button", { class: "wb-btn small" + (f.level === this.floor ? " on" : ""), onclick: () => { this.stopFlyover(); this.setFloor(f.level); } },
        `${f.level >= 0 ? f.level : "B" + -f.level} ${floorName(f.level)}`)));
  }

  setFloor(level, keepCam = false) {
    this.floor = level;
    this.renderTabs();
    if (!keepCam) this.fitFloor();
  }

  resize() {
    if (!this.canvas) return;
    const dpr = devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  floorRooms() {
    const f = this.layout.floors.find((x) => x.level === this.floor);
    if (!f) return [];
    return f.rooms.filter((id) => this.mode !== "explored" || this.visited.has(id));
  }

  bounds(ids) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) { const p = this.layout.rooms[id]; minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    return { minX, minY, maxX, maxY };
  }

  fitFloor(zoom) {
    const ids = this.floorRooms();
    if (!ids.length) return;
    const b = this.bounds(ids);
    const w = (b.maxX - b.minX + 1) * CW, h = (b.maxY - b.minY + 1) * CH;
    const z = zoom ?? Math.min(this.canvas.width / (w + 80), this.canvas.height / (h + 80));
    this.cam = { x: b.minX * CW + w / 2 - GAP / 2, y: b.minY * CH + h / 2 - GAP / 2, z: Math.max(0.08, Math.min(8, z)) };
  }

  centerOn(id, z) {
    const p = this.layout.rooms[id];
    this.cam.x = p.x * CW + PW / 2; this.cam.y = p.y * CH + PH / 2;
    if (z) this.cam.z = z;
  }

  toWorld(cx, cy) {
    const r = this.canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const sx = (cx - r.left) * dpr, sy = (cy - r.top) * dpr;
    return { x: (sx - this.canvas.width / 2) / this.cam.z + this.cam.x, y: (sy - this.canvas.height / 2) / this.cam.z + this.cam.y };
  }

  zoomAt(cx, cy, f) {
    const before = this.toWorld(cx, cy);
    this.cam.z = Math.max(0.08, Math.min(10, this.cam.z * f));
    const after = this.toWorld(cx, cy);
    this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
  }

  onDown(e) {
    if (this.fly) { this.stopFlyover(); return; }
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: 0 };
    else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.cam.z };
      this.drag = null;
    }
  }
  onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const dpr = devicePixelRatio || 1;
    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.zoomAt(mid.x, mid.y, (this.pinch.z * (d / this.pinch.d)) / this.cam.z);
      return;
    }
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    this.drag.moved = Math.max(this.drag.moved, Math.hypot(dx, dy));
    this.cam.x = this.drag.cx - (dx * dpr) / this.cam.z;
    this.cam.y = this.drag.cy - (dy * dpr) / this.cam.z;
    this.canvas.classList.toggle("drag", this.drag.moved > 4);
  }
  onUp(e) {
    const wasDrag = this.drag && this.drag.moved > 6;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    this.canvas.classList.remove("drag");
    if (this.drag && !wasDrag && this.pointers.size === 0) this.click(e.clientX, e.clientY);
    this.drag = null;
  }

  click(cx, cy) {
    const w = this.toWorld(cx, cy);
    const id = this.roomAtWorld(w.x, w.y);
    if (!id) return;
    if (this.mode === "world" || (this.mode === "explored" && this.app.devOn)) {
      const row = Math.max(0, Math.min(17, Math.floor((w.y - this.layout.rooms[id].y * CH) / TILE)));
      const col = Math.max(0, Math.min(23, Math.floor((w.x - this.layout.rooms[id].x * CW) / TILE)));
      this.close();
      this.app.teleport(id, row, col);
    }
  }

  roomAtWorld(x, y) {
    for (const id of this.floorRooms()) {
      const p = this.layout.rooms[id];
      if (x >= p.x * CW && x < p.x * CW + PW && y >= p.y * CH && y < p.y * CH + PH) return id;
    }
    return null;
  }

  onKey(e) {
    const k = e.key.toLowerCase();
    if (this.fly) { e.preventDefault(); this.stopFlyover(); return; }
    if (k === "escape" || k === "m") { e.preventDefault(); this.close(); return; }
    const i = this.floors.findIndex((f) => f.level === this.floor);
    if (k === "pageup" || k === "]" || k === "e") { e.preventDefault(); if (i < this.floors.length - 1) this.setFloor(this.floors[i + 1].level); }
    if (k === "pagedown" || k === "[" || k === "q") { e.preventDefault(); if (i > 0) this.setFloor(this.floors[i - 1].level); }
    if (k === "+" || k === "=") this.cam.z *= 1.25;
    if (k === "-") this.cam.z /= 1.25;
    if (k === "f" && this.mode === "world") this.startFlyover(0);
    const pan = 60 / this.cam.z;
    if (k === "arrowleft" || k === "a") this.cam.x -= pan;
    if (k === "arrowright" || k === "d") this.cam.x += pan;
    if (k === "arrowup" || k === "w") this.cam.y -= pan;
    if (k === "arrowdown" || k === "s") this.cam.y += pan;
  }

  // ---------- per-room live rendering ----------
  roomView(id) {
    const app = this.app;
    const built = app.builtRoom(id);
    let rv = this.rooms.get(id);
    const st = app.state;
    const revealKey = app.reveal ? JSON.stringify([Object.values(st.items || {}).filter((i) => i.room === id).map((i) => [i.id, i.row, i.col]), Object.values(st.monsters || {}).filter((m) => m.alive && m.room === id).map((m) => [m.id, m.row, m.col])]) : "";
    const key = built.key + "|" + revealKey;
    if (!rv || rv.key !== key) {
      let planes = built.planes;
      if (app.reveal) {
        planes = createPlanes(PW, PH, 8);
        copyPlanes(planes, built.planes);
        for (const it of Object.values(st.items || {})) if (it.room === id && it.row != null) blit(planes, itemBob(it.id, built.dark), it.col * TILE, it.row * TILE);
        for (const m of Object.values(st.monsters || {})) if (m.alive && m.room === id) blit(planes, monsterBob(m.kind, 0, built.dark), m.col * TILE, m.row * TILE);
      }
      const canvas = rv?.canvas || el("canvas", { width: PW, height: PH });
      const ctx = canvas.getContext("2d");
      rv = { key, built, planes, display: new Display(planes), canvas, ctx, image: rv?.image || ctx.createImageData(PW, PH), lastTick: -1 };
      this.rooms.set(id, rv);
    }
    return rv;
  }

  updateRoom(rv, tick) {
    if (rv.lastTick === tick) return;
    rv.lastTick = tick;
    const mood = rv.built.mood;
    let regs;
    if (rv.built.dark) regs = darkLevels(applyCycles(mood.base64, mood.cycles, tick), mood.lamp, [0.72, 0.85, 1.0]);
    else regs = animateTorch(applyCycles(mood.regs, mood.cycles, tick), mood, tick);
    rv.display.render(rv.image, regs, null, { transparent: rv.built.dark ? TRANSPARENT_DARK : TRANSPARENT_NORMAL });
    rv.ctx.putImageData(rv.image, 0, 0);
  }

  // ---------- frame ----------
  frame(t) {
    if (!this.root) return;
    if (this.canvas.width !== Math.round(this.canvas.getBoundingClientRect().width * (devicePixelRatio || 1))) this.resize();
    if (this.fly) { this.stepFlyover(t); this.stepCaption(t); }
    const g = this.ctx, W = this.canvas.width, H = this.canvas.height, cam = this.cam;
    const tick = Math.floor(t / 20);
    g.imageSmoothingEnabled = false;
    g.setTransform(1, 0, 0, 1, 0, 0);
    // backdrop: deep blue with a copper-style vertical gradient and a faint grid
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0a0c1c"); grad.addColorStop(1, "#020208");
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const ox = Math.round(W / 2 - cam.x * cam.z), oy = Math.round(H / 2 - cam.y * cam.z);
    const sx = (x) => ox + x * cam.z, sy = (y) => oy + y * cam.z;
    g.strokeStyle = "rgba(90,110,180,0.07)"; g.lineWidth = 1;
    const step = CW * cam.z;
    if (step > 12) {
      for (let x = ((ox % step) + step) % step; x < W; x += step) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
      for (let y = ((oy % (CH * cam.z)) + CH * cam.z) % (CH * cam.z); y < H; y += CH * cam.z) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
    }
    const ids = this.floorRooms();
    const shown = new Set(ids);
    // links under the rooms
    for (const l of this.layout.links) {
      const a = this.layout.rooms[l.from], b = this.layout.rooms[l.to];
      if (!shown.has(l.from) && !shown.has(l.to)) continue;
      if (l.kind === "stairs") continue;
      if (a.floor !== this.floor || b.floor !== this.floor || !shown.has(l.from) || !shown.has(l.to)) continue;
      const ax = sx(a.x * CW + PW / 2), ay = sy(a.y * CH + PH / 2), bx = sx(b.x * CW + PW / 2), by = sy(b.y * CH + PH / 2);
      if (l.kind === "door") {
        g.fillStyle = "rgba(200,170,110,0.55)";
        const horiz = a.y === b.y;
        const w = horiz ? Math.abs(bx - ax) : 10 * cam.z, h = horiz ? 10 * cam.z : Math.abs(by - ay);
        g.fillRect(Math.min(ax, bx) - (horiz ? 0 : w / 2), Math.min(ay, by) - (horiz ? h / 2 : 0), w, h);
      } else {
        g.save();
        g.strokeStyle = "rgba(255,210,120,0.75)"; g.lineWidth = Math.max(1.5, 3 * cam.z); g.setLineDash([8 * cam.z, 6 * cam.z]);
        g.lineDashOffset = -tick * 0.6;
        g.beginPath(); g.moveTo(ax, ay);
        const mx = (ax + bx) / 2 + (by - ay) * 0.18, my = (ay + by) / 2 - (bx - ax) * 0.18;
        g.quadraticCurveTo(mx, my, bx, by); g.stroke();
        g.restore();
      }
    }
    // rooms
    const vis = [];
    for (const id of ids) {
      const p = this.layout.rooms[id];
      const x0 = sx(p.x * CW), y0 = sy(p.y * CH), w = PW * cam.z, h = PH * cam.z;
      if (x0 > W || y0 > H || x0 + w < 0 || y0 + h < 0) continue;
      vis.push({ id, x0, y0, w, h });
    }
    const throttle = vis.length > 18 ? 2 : 1;
    vis.forEach((v, i) => {
      const rv = this.roomView(v.id);
      if (throttle === 1 || (tick + i) % throttle === 0 || rv.lastTick < 0) this.updateRoom(rv, tick);
      g.drawImage(rv.canvas, Math.round(v.x0), Math.round(v.y0), Math.round(v.w), Math.round(v.h));
    });
    // overlays: stairs, labels, current room
    const cur = this.app.state?.player?.room;
    const fontPx = Math.max(10, Math.min(26, 13 * cam.z));
    g.font = `${Math.round(fontPx)}px Silkscreen, VT323, monospace`;
    g.textBaseline = "top";
    for (const v of vis) {
      const r = this.app.roomById.get(v.id);
      if (cam.z > 0.22 && this.mode !== "flyover") {
        const label = `${v.id} ${roomTitle(r.description)}`;
        g.fillStyle = "rgba(0,0,0,0.6)";
        const tw = g.measureText(label).width;
        g.fillRect(v.x0 + 2, v.y0 + 2, tw + 8, fontPx + 6);
        g.fillStyle = "#f2ecda"; g.fillText(label, v.x0 + 6, v.y0 + 5);
        const stairs = Object.entries(r.exits).filter(([d]) => d === "up" || d === "down");
        stairs.forEach(([d, to], i) => {
          const s = `${d === "up" ? "▲" : "▼"} ${to}`;
          const sw = g.measureText(s).width;
          g.fillStyle = d === "up" ? "rgba(40,90,40,0.85)" : "rgba(90,40,40,0.85)";
          g.fillRect(v.x0 + v.w - sw - 10, v.y0 + 2 + i * (fontPx + 8), sw + 8, fontPx + 6);
          g.fillStyle = "#fff"; g.fillText(s, v.x0 + v.w - sw - 6, v.y0 + 5 + i * (fontPx + 8));
        });
      }
      if (v.id === cur && this.mode !== "flyover") {
        const pulse = 0.5 + 0.5 * Math.sin(t / 180);
        g.strokeStyle = `rgb(255, ${Math.round(180 + 70 * pulse)}, ${Math.round(60 + 120 * pulse)})`;
        g.lineWidth = Math.max(2, 4 * cam.z);
        g.strokeRect(v.x0 - 3, v.y0 - 3, v.w + 6, v.h + 6);
        const p = this.app.state.player;
        const px = v.x0 + (p.col * TILE + 6) * cam.z, py = v.y0 + (p.row * TILE + 6) * cam.z;
        g.fillStyle = "#fff"; g.beginPath(); g.arc(px, py, Math.max(3, 5 * cam.z) * (0.8 + pulse * 0.4), 0, 7); g.fill();
        g.fillStyle = "#3466c0"; g.beginPath(); g.arc(px, py, Math.max(2, 3 * cam.z), 0, 7); g.fill();
      }
    }
    if (!ids.length) { g.fillStyle = "#ccc"; g.font = "20px VT323, monospace"; g.fillText("Nothing explored on this floor yet.", 20, 20); }
  }

  // ---------- flyover ----------
  startFlyover(offset = 0) {
    if (this.mode !== "flyover") {
      // switch the bar into flyover mode
      this.mode = "flyover";
      this.root?.remove();
      this.buildDom();
    }
    this.floors = this.layout.floors;
    const plan = [];
    for (const level of FLY_ORDER) {
      const f = this.layout.floors.find((x) => x.level === level);
      if (!f) continue;
      const rows = new Map();
      for (const id of f.rooms) { const p = this.layout.rooms[id]; if (!rows.has(p.y)) rows.set(p.y, []); rows.get(p.y).push(id); }
      const ys = [...rows.keys()].sort((a, b) => a - b);
      const path = [];
      ys.forEach((y, i) => {
        const r = rows.get(y).sort((a, b) => this.layout.rooms[a].x - this.layout.rooms[b].x);
        path.push(...(i % 2 ? r.reverse() : r));
      });
      plan.push({ level, path });
    }
    const vw = this.canvas.width, vh = this.canvas.height;
    const z = Math.max(1, Math.floor(Math.min(vw / (PW * 1.35), vh / (PH * 1.45)) * 2) / 2);
    this.fly = { plan, fi: 0, start: performance.now() - offset, z, last: null, floorStart: 0, caption: null };
    this.caption?.remove();
    this.caption = el("div", { id: "caption" }, el("div", { class: "wb-window" }, el("div", { class: "wb-title" }, el("span", { class: "wb-close" }), el("span", { class: "wb-name" }, "")), el("div", { class: "wb-body" }, "")));
    this.floorcard?.remove();
    this.floorcard = el("div", { id: "floorcard" }, "");
    document.body.append(this.caption, this.floorcard);
    this.fly.timeline = this.makeTimeline(plan);
  }

  makeTimeline(plan) {
    // per floor: card (1.6s), then per room segment: dwell 1.7s + travel scaled by distance
    const tl = [];
    let t = 0;
    for (const fl of plan) {
      const card = { kind: "card", level: fl.level, t0: t, t1: t + 1800 };
      tl.push(card); t = card.t1;
      for (let i = 0; i < fl.path.length; i++) {
        const id = fl.path[i], next = fl.path[i + 1];
        const a = this.layout.rooms[id], b = next ? this.layout.rooms[next] : null;
        const dist = b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
        const dwell = 1900, travel = b ? 1100 + dist * 420 : 600;
        tl.push({ kind: "room", level: fl.level, id, next, t0: t, t1: t + dwell + travel, dwell, travel, dist });
        t += dwell + travel;
      }
    }
    return { segs: tl, total: t };
  }

  stepFlyover(now) {
    const f = this.fly;
    let t = now - f.start;
    if (t >= f.timeline.total) { f.start = now; t = 0; }
    const seg = f.timeline.segs.find((s) => t >= s.t0 && t < s.t1) || f.timeline.segs[0];
    if (this.floor !== seg.level) { this.floor = seg.level; this.renderTabs(); }
    const center = (id) => { const p = this.layout.rooms[id]; return { x: p.x * CW + PW / 2, y: p.y * CH + PH / 2 }; };
    if (seg.kind === "card") {
      const fl = f.plan.find((p) => p.level === seg.level);
      const c = center(fl.path[0]);
      const u = (t - seg.t0) / (seg.t1 - seg.t0);
      this.cam.x = c.x - 120 * (1 - u); this.cam.y = c.y - 60 * (1 - u);
      this.cam.z = f.z * (0.8 + 0.2 * smooth(u));
      this.floorcard.textContent = floorName(seg.level);
      this.floorcard.style.opacity = u < 0.15 ? u / 0.15 : u > 0.75 ? (1 - u) / 0.25 : 1;
      this.root.style.filter = `brightness(${0.35 + 0.65 * smooth(u)})`;
      this.setCaption(null);
      return;
    }
    this.floorcard.style.opacity = 0;
    this.root.style.filter = "";
    const a = center(seg.id);
    const lt = t - seg.t0;
    let x = a.x, y = a.y, z = f.z;
    // during the dwell, a slow drift across the room; then a smooth glide to the next one
    const drift = Math.min(1, lt / seg.dwell);
    if (seg.next) {
      const b = center(seg.next);
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const dwellOff = 26;
      x = a.x + (dx / len) * dwellOff * (drift - 0.5) * 2;
      y = a.y + (dy / len) * dwellOff * (drift - 0.5) * 2;
      if (lt > seg.dwell) {
        const u = smooth((lt - seg.dwell) / seg.travel);
        const sx = a.x + (dx / len) * dwellOff, sy = a.y + (dy / len) * dwellOff;
        const ex = b.x - (dx / len) * dwellOff, ey = b.y - (dy / len) * dwellOff;
        x = sx + (ex - sx) * u; y = sy + (ey - sy) * u;
        z = f.z * (1 - Math.sin(Math.PI * u) * Math.min(0.3, 0.12 * seg.dist));
      }
    }
    this.cam.x = x; this.cam.y = y; this.cam.z = z;
    // caption follows whichever room is nearest the camera
    const near = seg.next && lt > seg.dwell + seg.travel / 2 ? seg.next : seg.id;
    this.setCaption(near);
  }

  setCaption(id) {
    if (!this.caption) return;
    if (this.fly.caption === id) return;
    this.fly.caption = id;
    this.fly.capAt = performance.now();
    this.fly.capPending = id;
  }

  // captions cross-fade: out for 250 ms, swap the text, then in over 400 ms (driven by the frame loop)
  stepCaption(now) {
    const f = this.fly;
    if (!f || !this.caption) return;
    const dt = now - (f.capAt ?? -1e9);
    if (f.capPending !== undefined && dt >= 250) {
      const id = f.capPending;
      f.capPending = undefined;
      f.capShown = id;
      if (id) {
        const r = this.app.roomById.get(id);
        this.caption.querySelector(".wb-name").textContent = `${floorName(this.layout.rooms[id].floor)} · Room ${id}: ${roomTitle(r.description)}`;
        this.caption.querySelector(".wb-body").textContent = r.description;
      }
    }
    const op = f.capPending !== undefined ? Math.max(0, 1 - dt / 250) * (f.capShown ? 1 : 0) : f.capShown ? Math.min(1, (dt - 250) / 400) : 0;
    this.caption.style.opacity = String(Math.max(0, op));
  }

  stopFlyover() {
    if (!this.fly) return;
    this.fly = null;
    this.caption?.remove(); this.floorcard?.remove();
    this.caption = this.floorcard = null;
    if (this.root) this.root.style.filter = "";
    this.mode = "world";
    const floor = this.floor, cam = { ...this.cam };
    this.root?.remove();
    this.floors = this.layout.floors;
    this.buildDom();
    this.floor = floor; this.renderTabs();
    this.cam = cam;
  }
}

function smooth(u) { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); }
