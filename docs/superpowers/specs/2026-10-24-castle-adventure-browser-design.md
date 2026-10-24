# Castle Adventure in the browser: design

## Intent

Play Kevin Bales' *Castle Adventure* (1984/85, DOS freeware) in a modern browser. It should be faithful
to the original castle, puzzles and text, drawn as Amiga-era pixel art with Mark Ferrari-style color cycling (not
ASCII), with a few modern conveniences and a dev mode for exploring the whole world. Keep it nice and
simple.

## Goals

- All 83 rooms, with layouts, descriptions and exits taken from the original `original/CASTLE.RAN`
  (already extracted to `data/rooms.json` by `tools/extract-rooms.mjs`).
- Game behavior (items, monsters, combat, puzzles, scoring, escaping) matches the original.
- Amiga / Mark Ferrari color-cycling look (user's choice, which replaced an earlier storybook-map pick),
  produced by emulating the real Amiga AGA (A1200/A4000) display model rather than imitating it:
  - a PAL lowres 320x256 screen, integer-scaled, no smoothing.
  - 8 bitplanes (256 colors), stored planar like chip RAM (40 bytes/row, MSB = leftmost pixel). A
    pixel's color index is assembled from one bit per plane.
  - a blitter-style masked (cookie-cut) blit of planar tiles and BOB sprites into the planes.
  - 256 color registers, each 24-bit (AGA). User chose 256 colors over OCS 32.
  - a copper list (WAIT line / MOVE register) evaluated per scanline, for gradients and bars, the
    split to the status-strip palette, and area mood.
  - DeluxePaint-style color cycling: register rotation over ranges, stepped on a 50 Hz vblank. Room
    changes fade the registers smoothly.
  - a 24x18 room of 12x12 tiles = a 288x216 playfield at the top, with a ~40-line status strip below.
  - Ferrari-style moody dithered art with cycling water, torchlight, magic, treasure glints and lamp
    halos, all within those constraints.
  - The QoL panels are HTML around the screen in Workbench-style chrome.
  The emulation lives in `src/ui/amiga/`.
- Modern conveniences (see below).
- Dev mode, including a flyover of the whole world (see below).
- Runs from a plain static server. No build step and no runtime dependencies.

## Non-goals

- No rebalancing and no new content. Puzzles and score work like the original.
- No ASCII rendering mode.
- No typed text parser. Actions are buttons and keys.
- No backend, accounts or multiplayer.

## Sources

- `original/CASTLE.RAN`: the room data (layout documented in `tools/extract-rooms.mjs`).
- `original/CASTLE.EXE`: compiled BASIC. All game messages are stored here as plain strings
  (`strings -n 6`). **Use these for all in-game text.**
- Seed7 remake (GPL-2) at
  `/tmp/claude-1000/-home-na-projects-castles2/2a978e65-519f-4e56-9586-39f59f09c1ff/scratchpad/seed7/castle.sd7`
  (plus `castle.dat`). It's a complete, readable reimplementation. **Use it as a behavioral reference
  only.** Write original code, and don't translate it line by line or copy its text. Item and monster
  starting positions, strengths and puzzle rules can be learned from it. Its `castle.dat` is a
  hand-annotated version of the original maps that separates ambiguous glyphs (beds, wood, stone). Use it
  to understand what a glyph means, then encode our own semantic tiles.

## Modern conveniences (Claude's call; the user wanted it simple)

1. Arrow keys or WASD to move. There's an on-screen d-pad on touch screens.
2. Context action bar. Instead of guessing commands, the game shows buttons for whatever you can do
   right now (take the item you're standing on or next to, use or drop items you're carrying, and so on).
   Each button also has a keyboard shortcut.
3. Inventory panel with item names. A treasure counter shows found / total and score.
4. Strength bar.
5. Message log with scrollback, not just the last line.
6. Hovering or tapping a tile or sprite shows what it is ("Big Bush", "Ugly Ogre").
7. Autosave on every room change, plus 3 manual save slots. "Continue" on the title screen.
8. Explored-rooms map (M key). It shows only rooms you've visited, uses the same layout as the dev
   world map, and highlights your current room.
9. The game pauses when the tab is hidden or a menu is open.

## Dev mode

Toggle it with the backtick key, or open it with `?dev` in the URL. It shows a dev panel with:

- **Noclip:** walk through walls.
- **God mode:** monsters do no damage.
- **Reveal:** shows every item and monster (at its current position), including on the world map.
- **Give item** (pick from a list), **set strength**.
- **World map:** all 83 rooms drawn with the same color-cycling renderer (live cycling), laid out spatially from their exits, with
  one layer per floor (up and down exits change floor). You can pan and zoom, and click a room to
  teleport there.
- **Flyover:** an animated camera glides smoothly across every room in the world map, floor by floor,
  with each room's name or description shown as it passes. Any key or click stops it.

## Architecture

Plain ES modules. `index.html` loads `src/main.js`.

```
data/rooms.json        original rooms (generated, don't hand-edit)
data/*.json            additional game data from the engine builder (items, monsters, tiles, text)
original/              the original game files
tools/                 extraction scripts, static server
src/engine/            game rules: pure JS, no DOM, runs in node     (engine builder)
src/ui/                rendering, input, HUD, saves, maps, dev panel (UI builder)
src/main.js            wires engine + UI                              (UI builder)
test/engine/           node --test                                    (engine builder)
test/ui/               node --test for pure UI logic (layout, saves)  (UI builder)
```

`npm test` runs `node --test test/`. `npm start` serves the folder (`tools/serve.mjs`).

## Engine contract

The two builders work in parallel against this interface. Changing it means updating this section.

```js
import { createGame } from "./src/engine/index.js";

const game = createGame({ rooms, seed });  // rooms = parsed data/rooms.json; seed makes randomness deterministic
// optional extras: highScore: { name, points } (shown on the courtyard wall), monsterStepMs (default 500)

game.getState()          // -> State. A plain JSON object (deep copy or frozen). Fully serializable.
game.load(state)         // restore a saved State
game.act(action)         // -> Event[]  player input
game.tick(ms)            // -> Event[]  advance real time (monster movement, attacks)
game.availableActions()  // -> [{ id, verb, item?, target?, label, key? }]  what the action bar shows right now
game.tileGrid(roomId)    // -> string[18][24] semantic tile ids for the room's *current* state
game.describe(roomId, row, col) // -> string|null  name for a hover tooltip (tile, item or monster)
game.dev                 // { setNoclip(b), setGod(b), teleport(roomId, row?, col?), giveItem(itemId), setStrength(n) }
                         // teleport and giveItem return Event[] like act()
```

Actions:

```js
{ type: "move", dir: "north" | "south" | "east" | "west" }
                                // also "northeast" | "northwest" | "southeast" | "southwest":
                                // the original moved in 8 directions on the numeric keypad
{ type: "verb", verb, item? }   // verb ids come from availableActions(); engine documents the full list
{ type: "verb", verb, target }  // target = something that isn't an item: a furniture noun ("desk",
                                // "statue", "door", "gate", "wall"...), a monster id or kind, "down"
{ type: "verb", verb: "say", text }
{ type: "command", text }       // the original's typed two-word parser, e.g. "GET FLASK", "INV"
```

Verbs (`act({type:"verb"})`): `look` (also `search`, `examine`; with no item or target it repeats the
room description), `take` (`get`), `drop` (`throw`), `fill`, `wear`, `play`, `wave`, `rub` (`clean`),
`say`, `unlock` (`open`), `lock` (`close`), `drink`, `pour`, `eat`, `read`, `jump` (`leep`), `climb`,
`mirror`, `pet`, `kill`, `show`, `inventory`, and `use` (not an original verb: does the natural thing
with an item, e.g. play the harp, wave the wand, read the book). `take` on a visible item next to you
picks it up, as running into it does; hidden items are taken from beside the furniture they're in,
the way the original's GET worked. Every answer is the original's text from CASTLE.EXE.

Timing: monsters in your room take one step (or attack, if next to you) every `monsterStepMs`
(500 ms). The original stepped them every 200 idle keyboard polls; its fights were balanced for a
held key repeating about 10 times a second, so the UI should not send moves much faster than that.

State (fields the UI relies on; the engine may add more):

```js
{
  status: "title" | "playing" | "dead" | "escaped",
  player:   { room, row, col, facing, strength, maxStrength, inventory: [itemId] },
  score, treasuresFound, treasuresTotal,
  items:    { [itemId]: { id, name, treasure: bool, room: number|null, row, col } },   // room null = carried or not yet placed
  monsters: { [monsterId]: { id, kind, name, room, row, col, strength, alive } },
  visited:  [roomId],
  dev:      { noclip, god },
}
```

Engine additions to State (the UI may use them, never needs to): `player.lastMove {dr, dc}` (you
drop things toward the cell you last moved to, as in the original); on items `hidden`,
`hiddenIn` and `revealed` (hidden items have `room: null` until taken; `revealed` turns true once
you've looked at the furniture hiding them); `flags { cellarLocked, dungeonLocked, flaskFull,
drankWater }`; `prevRoom`, `mods` (puzzle map changes on the current room), `clockMs`, `rng`,
`turn`, `version`. Monster notes: a killed monster stays where it fell with `alive: false` (the
original left the body on screen); the fairy, the vampire and an unlocked door have `room: null`
while they're gone; the doors are four `door` monsters, one per door cell.

Events: `{type:"message", text}`, `{type:"roomChanged", from, to}`, `{type:"took", item}`,
`{type:"dropped", item}`, `{type:"hit", by, target, damage}`, `{type:"died"}`, `{type:"escaped"}`, `{type:"scored", points}`.
The UI should ignore event types it doesn't recognize.

Engine additions to events: `message` also has `lines` (the original's short panel lines) and, for
the room description sent on every room change, `kind: "description"`; `roomChanged` has
`description`; `scored` has `score` (the new total; `points` is the change, and can be negative when a
treasure leaves the courtyard); `hit` has `missed: true` on a miss (`damage` can be negative: the
original's damage roll could heal); new: `{type:"killed", monster}`, `{type:"gameOver", status, score}`,
`{type:"filled", item}`, `{type:"unlocked"|"locked", room}`, `{type:"mapChanged", room}` (a puzzle
redrew the room; call `tileGrid` again), `{type:"monsterLeft", monster}` (fairy or vampire).

Score works as in the original: 50 per treasure carried or lying in the courtyard, 100 per monster
killed, 100 for escaping; 1550 is perfect. `treasuresFound` counts the treasures carried or in the
courtyard.

Coordinates: `row` 0–17, `col` 0–23. Walking off the room edge through an opening takes the exit in
that direction. Stepping on a stair tile takes the up or down exit.

`data/rooms.json` rooms also carry `descriptionLines` (the original's five 25-column lines). The
original stores 125 characters of description per room, not 120, so the last words of a few rooms
were cut off before; `description` is those lines joined with spaces.

### Semantic tile ids (`tileGrid`)

`floor, wall, wall_color1, wall_color2, gate, stairs_up, stairs_down, bush_small, bush_big, stone,
wood, line_h, line_v, corner_tl, corner_tr, corner_bl, corner_br, railing, statue, fountain, water,
chain, gray, bed_left, bed_right, bed_top, bed_bottom, bed_white, bed_red, bed_blue, bed_purple,
bed_yellow, letter_k, letter_b`

The renderer draws all of these. Anything unknown is drawn as `stone`.

### Item and monster ids

Items: `book, crystal_ball, glasses, helmet, key, lamp, magic_wand, sword, wine_flask, crown, diamond,
goblet, goldbar, harp, holy_cross, hourglass, jade_figurine, large_gem, necklace, ruby, scepter,
silver_bars`

Monster kinds: `demon, ogre, spider_big, spider_small, snake, bat, vampire, fairy, door`. Several
monsters can share a kind, and ids are unique per monster.

## Testing

- Engine: unit tests, plus a scripted playthrough that collects every treasure and escapes, so the
  game can be shown to be winnable.
- UI: unit tests for the world layout (no two rooms on a floor overlap, every room placed) and for
  saves. Rendering is checked by headless screenshots, using
  `~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell --headless --no-sandbox --screenshot=out.png --window-size=1280,900 URL`.

## Licensing note

The original game is freeware (and listed as public domain in places). The Seed7 remake is GPL-2. This
project uses it only as a reference, so the code here stays the project's own.
