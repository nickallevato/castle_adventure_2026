// The copper: a per-frame list of WAIT(line) / MOVE(register, value) instructions, evaluated in display
// order. MOVEs before the first WAIT take effect at the top of the frame. A WAIT blocks until the beam
// reaches that line; the MOVEs after it then take effect from that line down (until changed again).
// Registers are the 256 AGA color registers (bank select is modelled simply as a register index 0-255),
// values 24-bit RGB.

export class CopperList {
  constructor() { this.ins = []; }
  wait(line) { this.ins.push({ op: "wait", line }); return this; }
  move(reg, value) { this.ins.push({ op: "move", reg, value: value & 0xffffff }); return this; }
  /** Convenience: WAIT(line) then MOVE each [reg, value] pair. */
  at(line, pairs) {
    this.wait(line);
    for (const [r, v] of pairs) this.move(r, v);
    return this;
  }
  end() { this.ins.push({ op: "wait", line: 0xffff }); return this; }
}

/**
 * Run the copper list over `height` scanlines, starting from the base registers (after cycling).
 * onLine(line, regs, changed) is called for every line; `changed` is null when nothing changed at the
 * start of that line, "all" on line 0, or the list of register numbers written (so callers only update
 * those entries of their lookup).
 */
export function runCopper(list, baseRegs, height, onLine) {
  const regs = baseRegs.slice();
  const ins = list ? list.ins || list : [];
  let pc = 0;
  for (let line = 0; line < height; line++) {
    let changed = line === 0 ? "all" : null;
    while (pc < ins.length) {
      const i = ins[pc];
      if (i.op === "wait") {
        if (i.line > line) break;
        pc++;
      } else {
        if (regs[i.reg] !== i.value) {
          if (changed !== "all") (changed ||= []).push(i.reg);
          regs[i.reg] = i.value;
        }
        pc++;
      }
    }
    onLine(line, regs, changed);
  }
  return regs;
}

/** The register file as the beam sees it on one line (for tests and tools). */
export function regsAtLine(list, baseRegs, line) {
  let out = null;
  runCopper(list, baseRegs, line + 1, (l, regs) => { if (l === line) out = regs.slice(); });
  return out;
}

/** Copper gradient helper: MOVE `reg` every `step` lines from color a to color b between y0 and y1. */
export function copperGradient(list, reg, y0, y1, a, b, step, lerp) {
  for (let y = y0; y < y1; y += step) {
    const t = (y - y0) / Math.max(1, y1 - y0 - step);
    list.wait(y).move(reg, lerp(a, b, Math.min(1, t)));
  }
  return list;
}

/**
 * Collects MOVEs keyed by line in any order and emits a proper copper list (WAITs ascending),
 * like writing a copper list by hand top to bottom.
 */
export class CopperBuilder {
  constructor() { this.moves = []; this.n = 0; }
  move(line, reg, value) { this.moves.push({ line: Math.max(0, line | 0), reg, value, n: this.n++ }); return this; }
  gradient(reg, y0, y1, a, b, step, lerp) {
    for (let y = y0; y < y1; y += step) {
      const t = (y - y0) / Math.max(1, y1 - y0 - step);
      this.move(y, reg, lerp(a, b, Math.min(1, t)));
    }
    return this;
  }
  build() {
    const list = new CopperList();
    const ms = this.moves.slice().sort((a, b) => a.line - b.line || a.n - b.n);
    let cur = -1;
    for (const m of ms) {
      if (m.line !== cur) { if (m.line > 0) list.wait(m.line); cur = m.line; }
      list.move(m.reg, m.value);
    }
    return list.end();
  }
}
