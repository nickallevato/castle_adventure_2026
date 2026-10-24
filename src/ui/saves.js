// Saves: an autosave (written on every room change) plus 3 manual slots, in localStorage.
// Storage is injectable so this runs in node tests; every access is wrapped in try/catch because
// storage can be missing, full, or blocked (private windows, quotas).

export const SLOTS = 3;
const VERSION = 1;

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

export function defaultStorage() {
  try {
    const s = globalThis.localStorage;
    const probe = "__castle_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return memoryStorage();
  }
}

export function createSaveStore(storage = defaultStorage(), prefix = "castle-adventure") {
  const key = (name) => `${prefix}:${name}`;
  const write = (name, state, meta = {}) => {
    try {
      const rec = { v: VERSION, savedAt: meta.savedAt ?? Date.now(), meta, state };
      storage.setItem(key(name), JSON.stringify(rec));
      return true;
    } catch {
      return false;
    }
  };
  const read = (name) => {
    try {
      const raw = storage.getItem(key(name));
      if (!raw) return null;
      const rec = JSON.parse(raw);
      if (!rec || rec.v !== VERSION || typeof rec.state !== "object") return null;
      return rec;
    } catch {
      return null;
    }
  };
  const slotName = (n) => {
    if (!Number.isInteger(n) || n < 1 || n > SLOTS) throw new RangeError(`save slot must be 1..${SLOTS}`);
    return `slot${n}`;
  };
  return {
    autosave: (state, meta) => write("auto", state, meta),
    loadAutosave: () => read("auto"),
    hasAutosave: () => read("auto") !== null,
    clearAutosave: () => { try { storage.removeItem(key("auto")); } catch { /* ignore */ } },
    save: (n, state, meta) => write(slotName(n), state, meta),
    load: (n) => read(slotName(n)),
    remove: (n) => { try { storage.removeItem(key(slotName(n))); } catch { /* ignore */ } },
    list: () => Array.from({ length: SLOTS }, (_, i) => {
      const r = read(slotName(i + 1));
      return r ? { slot: i + 1, savedAt: r.savedAt, ...r.meta } : null;
    }),
    getSetting: (name, fallback) => { try { const v = storage.getItem(key("set:" + name)); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    setSetting: (name, value) => { try { storage.setItem(key("set:" + name), JSON.stringify(value)); } catch { /* ignore */ } },
  };
}

export { memoryStorage };
