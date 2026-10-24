// The HTML side panels: room description, action bar, inventory (with pixel-art icons), strength,
// message log and tooltip. Pure DOM; the app feeds it state.

import { itemBob } from "./art/sprite-bobs.js";
import { planesToIndices } from "./amiga/bitplanes.js";
import { moodFor } from "./art/moods.js";
import { to32 } from "./amiga/palette.js";

const $ = (id) => document.getElementById(id);
const BLOCKED_KEYS = new Set(["w", "a", "s", "d", "m", "arrowup", "arrowdown", "arrowleft", "arrowright", "escape", "`"]);

export class Hud {
  constructor({ onAction }) {
    this.onAction = onAction;
    this.logEl = $("log");
    this.actionsEl = $("actions");
    this.invEl = $("inventory");
    this.keymap = new Map();
    this.iconCache = new Map();
    this.lastActionsKey = "";
    this.lastInvKey = "";
  }

  setRoom(title, desc) {
    $("room-title").textContent = title;
    $("room-desc").textContent = desc;
  }

  setStats(st) {
    const p = st.player;
    $("stats").textContent = `Score ${st.score ?? 0} · ${st.treasuresFound ?? 0}/${st.treasuresTotal ?? 0}`;
    $("sb-info").textContent = `Score ${st.score ?? 0}   Treasures ${st.treasuresFound ?? 0}/${st.treasuresTotal ?? 0}`;
    const pct = Math.max(0, Math.min(1, p.strength / Math.max(1, p.maxStrength || 100)));
    $("strength-fill").style.width = `calc(${(pct * 100).toFixed(1)}% - 2px)`;
    $("strength-num").textContent = `${p.strength}/${p.maxStrength ?? 100}`;
    $("strength").classList.toggle("low", pct <= 0.25);
  }

  setActions(actions) {
    const key = JSON.stringify(actions);
    if (key === this.lastActionsKey) return;
    this.lastActionsKey = key;
    this.keymap.clear();
    this.actionsEl.replaceChildren();
    if (!actions.length) {
      const s = document.createElement("span");
      s.className = "empty";
      s.textContent = "Nothing to do here.";
      this.actionsEl.append(s);
      return;
    }
    actions.forEach((a, i) => {
      const b = document.createElement("button");
      b.className = "wb-btn";
      const keys = [];
      const k = a.key && String(a.key).toLowerCase();
      if (k && !BLOCKED_KEYS.has(k) && !this.keymap.has(k)) { this.keymap.set(k, a); keys.push(k.toUpperCase()); }
      if (i < 9) { this.keymap.set(String(i + 1), a); if (!keys.length) keys.push(String(i + 1)); }
      if (keys.length) { const kk = document.createElement("span"); kk.className = "key"; kk.textContent = keys[0]; b.append(kk); }
      b.append(document.createTextNode(a.label || a.verb));
      b.title = keys.length ? `${a.label} (${keys.join(" / ")})` : a.label;
      b.addEventListener("click", () => this.onAction(a));
      this.actionsEl.append(b);
    });
  }

  actionForKey(k) { return this.keymap.get(k.toLowerCase()) || null; }

  setInventory(st) {
    const inv = st.player.inventory || [];
    const key = inv.join(",");
    if (key === this.lastInvKey) return;
    this.lastInvKey = key;
    this.invEl.replaceChildren();
    if (!inv.length) {
      const li = document.createElement("li");
      li.className = "none";
      li.textContent = "Empty-handed.";
      this.invEl.append(li);
      return;
    }
    for (const id of inv) {
      const it = st.items?.[id] || { name: id };
      const li = document.createElement("li");
      if (it.treasure) li.classList.add("treasure");
      li.append(this.icon(id));
      const s = document.createElement("span");
      s.textContent = it.name || id;
      li.append(s);
      li.title = it.treasure ? `${it.name} (treasure)` : it.name;
      this.invEl.append(li);
    }
  }

  // render an item BOB through the sprite registers into a tiny canvas
  icon(id) {
    if (!this.iconCache.has(id)) {
      const bob = itemBob(id);
      const idx = planesToIndices(bob);
      const regs = moodFor(2).regs;
      const c = document.createElement("canvas");
      c.width = 12; c.height = 12;
      const g = c.getContext("2d");
      const img = g.createImageData(12, 12);
      const out = new Uint32Array(img.data.buffer);
      const W = bob.bpr * 8;
      for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
        const m = (bob.mask[y * bob.bpr + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = idx[y * W + x];
        out[y * 12 + x] = m && v !== 19 ? to32(regs[v]) : 0;
      }
      g.putImageData(img, 0, 0);
      this.iconCache.set(id, c);
    }
    const src = this.iconCache.get(id);
    const c = document.createElement("canvas");
    c.width = 12; c.height = 12;
    c.getContext("2d").drawImage(src, 0, 0);
    return c;
  }

  log(text, cls = "") {
    if (!text) return;
    const last = this.logEl.lastElementChild;
    if (last && last.textContent === text) { last.classList.add("again"); return; }
    const p = document.createElement("p");
    if (cls) p.className = cls;
    p.textContent = text;
    this.logEl.append(p);
    while (this.logEl.childElementCount > 300) this.logEl.firstElementChild.remove();
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  clearLog() { this.logEl.replaceChildren(); }

  tooltip(text, x, y) {
    const t = $("tooltip");
    if (!text) { t.hidden = true; return; }
    t.hidden = false;
    t.textContent = text;
    const mon = $("monitor").getBoundingClientRect();
    const w = t.offsetWidth;
    t.style.left = Math.max(4, Math.min(mon.width - w - 4, x - mon.left + 14)) + "px";
    t.style.top = Math.max(4, y - mon.top - 30) + "px";
  }
}
