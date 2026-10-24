// Entry point: load the rooms, pick the engine (the real one in src/engine/ when it loads, else the
// mock), and start the UI.
import { App } from "./ui/app.js";

const params = new URLSearchParams(location.search);

async function loadEngine(rooms) {
  if (params.get("engine") !== "mock") {
    try {
      const mod = await import("./engine/index.js");
      if (typeof mod.createGame !== "function") throw new Error("src/engine/index.js has no createGame export");
      const probe = mod.createGame({ rooms, seed: 1 });
      const st = probe.getState();
      if (!st?.player || typeof probe.tileGrid !== "function") throw new Error("engine state is missing the player");
      console.info("[castle] engine: real (src/engine/index.js)");
      return { createGame: mod.createGame, kind: "real" };
    } catch (e) {
      console.info(`[castle] real engine unavailable (${e.message}); falling back to the mock engine`);
    }
  }
  const mock = await import("./ui/mock-engine.js");
  console.info("[castle] engine: mock (src/ui/mock-engine.js)");
  return { createGame: mock.createGame, kind: "mock" };
}

async function boot() {
  const rooms = await (await fetch("data/rooms.json")).json();
  const engine = await loadEngine(rooms);
  const app = new App({ createGame: engine.createGame, engineKind: engine.kind, rooms, params });
  window.castle = app; // handy in the console
  app.start();
}

boot().catch((e) => {
  console.error("[castle] failed to start", e);
  document.body.insertAdjacentHTML("beforeend", `<pre style="color:#fff;padding:16px">Castle Adventure failed to start:\n${String(e && e.stack || e)}</pre>`);
});
