// Dev mode panel: noclip, god, reveal, give item, set strength, teleport, world map, flyover.
import { el } from "./screens.js";
import { ITEM_IDS } from "./art/sprites.js";
import { roomTitle } from "./room-names.js";

export class DevPanel {
  constructor(app) { this.app = app; this.root = null; }

  toggle() { if (this.root) this.hide(); else this.show(); }

  hide() {
    this.root?.remove();
    this.root = null;
    this.app.devOn = false;
    this.app.saves.setSetting("dev", false);
  }

  show() {
    const app = this.app;
    app.devOn = true;
    app.saves.setSetting("dev", true);
    if (this.root) return;
    const st = app.state;
    const items = Object.values(st?.items || {}).map((i) => [i.id, i.name]);
    const itemList = items.length ? items : ITEM_IDS.map((id) => [id, id]);
    this.noclip = el("input", { type: "checkbox", onchange: (e) => { app.game?.dev.setNoclip(e.target.checked); app.state = app.game.getState(); } });
    this.god = el("input", { type: "checkbox", onchange: (e) => { app.game?.dev.setGod(e.target.checked); app.state = app.game.getState(); } });
    this.reveal = el("input", { type: "checkbox", onchange: (e) => app.setReveal(e.target.checked) });
    this.item = el("select", {}, ...itemList.map(([id, name]) => el("option", { value: id }, name)));
    this.str = el("input", { type: "number", min: 0, max: 999, value: st?.player?.strength ?? 100 });
    this.roomSel = el("select", {}, ...app.rooms.map((r) => el("option", { value: r.id }, `${r.id} ${roomTitle(r.description)}`)));
    this.root = el("div", { class: "wb-window", id: "devpanel" },
      el("div", { class: "wb-title" }, el("span", { class: "wb-close", onclick: () => this.hide() }), el("span", { class: "wb-name" }, `Dev mode · ${app.engineKind} engine`)),
      el("div", { class: "wb-body" },
        el("div", { class: "line" }, el("label", {}, this.noclip, "Noclip"), el("label", {}, this.god, "God"), el("label", {}, this.reveal, "Reveal")),
        el("div", { class: "line" }, this.item, el("button", { class: "wb-btn small", onclick: () => app.devGive(this.item.value) }, "Give")),
        el("div", { class: "line" }, el("span", {}, "Strength"), this.str, el("button", { class: "wb-btn small", onclick: () => { app.game?.dev.setStrength(Number(this.str.value)); app.state = app.game.getState(); app.refresh(); } }, "Set")),
        el("div", { class: "line" }, this.roomSel, el("button", { class: "wb-btn small", onclick: () => app.teleport(Number(this.roomSel.value)) }, "Go")),
        el("div", { class: "line" },
          el("button", { class: "wb-btn small", onclick: () => app.map.open({ mode: "world" }) }, "World map"),
          el("button", { class: "wb-btn small", onclick: () => app.map.open({ mode: "flyover" }) }, "Flyover"),
          el("button", { class: "wb-btn small", onclick: () => showGallery(app.room || 3) }, "BOBs")),
        this.hiddenEl = el("div", { class: "slot-meta" }),
      ),
    );
    document.getElementById("side").prepend(this.root);
    this.sync();
  }

  sync() {
    if (!this.root || !this.app.state) return;
    const st = this.app.state;
    this.noclip.checked = !!st.dev?.noclip;
    this.god.checked = !!st.dev?.god;
    this.reveal.checked = !!this.app.reveal;
    if (document.activeElement !== this.str) this.str.value = st.player.strength;
    if (document.activeElement !== this.roomSel) this.roomSel.value = String(st.player.room);
    // reveal also lists items that are hidden inside furniture (they have no position until found)
    const hidden = Object.values(st.items || {}).filter((i) => i.hidden && i.hiddenIn != null);
    this.hiddenEl.textContent = this.app.reveal && hidden.length ? "Hidden: " + hidden.map((i) => `${i.name} (room ${i.hiddenIn})`).join(", ") : "";
  }
}

// A sprite sheet of every BOB, rendered through the game's registers (dev: ?gallery).
import { itemBob, monsterBob, playerBob } from "./art/sprite-bobs.js";
import { makeBob } from "./art/room-builder.js";
import { TILES } from "./art/tiles.js";
import { MONSTERS, ITEMS } from "./art/sprites.js";
import { moodFor, animateTorch } from "./art/moods.js";
import { planesToIndices } from "./amiga/bitplanes.js";
import { to32, applyCycles } from "./amiga/palette.js";

export function showGallery(roomForPalette = 3) {
  const mood = moodFor(roomForPalette);
  const entries = [];
  for (const f of ["south", "north", "west", "east"]) for (const fr of [0, 1]) entries.push([`player ${f} ${fr}`, playerBob(f, fr)]);
  for (const k of Object.keys(MONSTERS)) for (const fr of [0, 1]) entries.push([`${k} ${fr}`, monsterBob(k, fr)]);
  for (const k of Object.keys(ITEMS)) entries.push([k, itemBob(k)]);
  for (const k of Object.keys(TILES)) entries.push([k, makeBob(TILES[k], "tile", false, k)]);
  const S = 5, cell = 12 * S + 8;
  const cols = Math.max(4, Math.floor((innerWidth - 40) / (cell + 90)));
  const cv = el("canvas", { width: cols * (cell + 90), height: Math.ceil(entries.length / cols) * (cell + 6) });
  const g = cv.getContext("2d");
  const draw = (tick) => {
    const regs = animateTorch(applyCycles(mood.regs, mood.cycles, tick), mood, tick);
    g.fillStyle = "#" + regs[16 + 8].toString(16).padStart(6, "0");
    g.fillRect(0, 0, cv.width, cv.height);
    entries.forEach(([name, bob], i) => {
      const x0 = (i % cols) * (cell + 90), y0 = Math.floor(i / cols) * (cell + 6);
      const idx = planesToIndices(bob), W = bob.bpr * 8;
      const img = g.createImageData(bob.width, bob.height);
      const out = new Uint32Array(img.data.buffer);
      for (let y = 0; y < bob.height; y++) for (let x = 0; x < bob.width; x++) {
        const m = bob.mask ? (bob.mask[y * bob.bpr + (x >> 3)] >> (7 - (x & 7))) & 1 : 1;
        out[y * bob.width + x] = m ? to32(regs[idx[y * W + x]]) : 0;
      }
      const tmp = document.createElement("canvas"); tmp.width = bob.width; tmp.height = bob.height;
      tmp.getContext("2d").putImageData(img, 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(tmp, x0 + 4, y0 + 4, bob.width * S, bob.height * S);
      g.fillStyle = "#fff"; g.font = "16px VT323, monospace"; g.fillText(name, x0 + cell + 2, y0 + 30);
    });
  };
  const ov = el("div", { class: "overlay", style: "overflow:auto; align-items:flex-start" }, el("div", { class: "wb-window", style: "margin:12px" }, el("div", { class: "wb-title" }, el("span", { class: "wb-name" }, "BOB gallery")), cv));
  document.getElementById("overlays").append(ov);
  let alive = true;
  const loop = () => { if (!alive) return; draw(Math.floor(performance.now() / 20)); setTimeout(loop, 60); };
  loop();
  ov.addEventListener("click", () => { alive = false; ov.remove(); });
}
