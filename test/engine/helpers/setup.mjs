// Shared helpers for the engine tests.
import { createGame } from "../../../src/engine/index.js";
import ROOMS from "../../../data/rooms.json" with { type: "json" };

export { ROOMS };

export function newGame(opts = {}) {
  return createGame({ rooms: ROOMS, seed: 1, ...opts });
}

/** Put the player somewhere (dev teleport) holding the given items. */
export function placed(room, row, col, items = [], opts = {}) {
  const game = newGame(opts);
  for (const id of items) game.dev.giveItem(id);
  game.dev.teleport(room, row, col);
  return game;
}

export const move = (game, dir) => game.act({ type: "move", dir });
export const verb = (game, v, extra = {}) => game.act({ type: "verb", verb: v, ...extra });
export const typed = (game, text) => game.act({ type: "command", text });
export const texts = (events) => events.filter((e) => e.type === "message").map((e) => e.text);
export const said = (events) => texts(events).join(" | ");
export const player = (game) => game.getState().player;
export const pos = (game) => {
  const p = player(game);
  return [p.room, p.row, p.col];
};
