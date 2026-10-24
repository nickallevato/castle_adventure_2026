// Builds data/messages.json: every message the engine prints, in the original's own lines.
//
// The original shows a message as up to 7 short lines in a side panel. Each entry below is that
// list of lines, exactly as CASTLE.EXE prints them, including its typos and odd spacing.
// Placeholders are filled in by the engine:
//   {N}  the noun the player used, in capitals as the original parser saw it (e.g. "WAND")
//   {M}  a monster's short name in capitals (the last word of its name, e.g. "OGRE")
//   {T}  text the player said
//   {I}  an inventory line (glyph and item name)
//   {S}  a number, printed BASIC-style with a leading space for positives
// Every literal piece of every line is checked against the string table in CASTLE.EXE, so the
// file can't drift from the original wording.
//
// Usage: node tools/build-messages.mjs [data/exe-strings.json] [data/messages.json]
// (run tools/extract-exe.mjs first)

import { readFileSync, writeFileSync } from "node:fs";

const [stringsPath = "data/exe-strings.json", out = "data/messages.json"] = process.argv.slice(2);

const M = {
  // --- moving around ------------------------------------------------------------------------
  tooDark: ["It's too dark", "to go that way!"],
  puffSorcerer: ["There is a puff", "of smoke & you", "appear in the", "Sorcerers room!"],
  gateLocked: ["The Gate is", "locked."],
  doorLocked: ["The Door is", "locked."],
  vampireBlocks: ["The Vampire", "is blocking", "your way. He", "can't be hurt."],
  fairyBlocks: ["The Fairy", "is blocking", "your way. He", "can't be hurt."],
  cantCarry: [" Can't carry", " any more!"],
  trap: ["You have sprung", "a Trap!! The", "room has filled", "with water and", "you drowned!"],

  // --- fighting -----------------------------------------------------------------------------
  monsterStruck: ["The {M}", "Struck you!"],
  helmetHelped: ["", "The Helmet", "helped."],
  monsterKilledYou: ["The {M}", "has Killed you!"],
  noWeapon: ["You have no", "Weapon!"],
  youStruck: ["You struck", "the {M}!"],
  youKilled: ["You Killed", "the {M}!"],

  // --- LOOK / SEARCH / EXAMINE --------------------------------------------------------------
  lookDontHaveIt: [" You Don't", " Have it!"],
  "look.lamp": [" It's lit", " Magically"],
  "look.necklace": [" On the back", " it says:", "", "Protection from", "Traps."],
  "look.book": [" It is titled", "  `The Gate'"],
  "look.magic_wand": [" It looks", " Magical!"],
  "look.sword": [" It looks", " Sharp!"],
  "look.key": [" It looks Old!"],
  "look.glasses": [" They're", " Bifocals"],
  "look.crystal_ball": ["In the Cyrstal", "Ball....", "", " You see a man", "in a winding",
    "passage,waving", "a Wand."],
  "look.helmet": [" It looks", " Tough!"],
  "look.flaskEmpty": [" It's empty."],
  "look.flaskFull": [" It's filled", " with water."],
  "look.gold": [" It's made of", " Gold!"],
  "look.expensive": [" It looks", " Expensive!"],
  "look.theyExpensive": [" They look", " Expensive!"],
  "look.tableStone": [" It's made of", " Stone."],
  "look.tableBlood": [" It's covered", " with Blood!"],
  "look.noTable": [" I don't see", " a Table."],
  "look.deskFlask": [" There is a", " Wine Flask", " on top."],
  "look.deskGlasses": [" There is a", " Pair of Eye", " Glasses on", " Top."],
  "look.deskKey": [" There is a", " Key on top"],
  "look.deskWood": [" It's made", " of Wood."],
  "look.noDesk": [" I don't see", " a desk!"],
  "look.bedsRed": [" They're Red."],
  "look.bedsBlue": [" They're Blue."],
  "look.bedsOld": [" They're Old."],
  "look.bedOld": [" It's Old."],
  "look.bedRed": [" It's Red."],
  "look.bedBlue": [" It's Blue."],
  "look.bedPurple": [" It's Purple."],
  "look.bedYellow": [" It's Yellow."],
  "look.noBeds": [" I don't see", " any Beds."],
  "look.noBed": [" I don't see", " a Bed."],
  "look.shelfBook": ["There's a book", "on it."],
  "look.shelvesBook": ["There's a book", "on one."],
  "look.shelvesWood": [" They're made", " of wood."],
  "look.noShelf": [" I don't see", " one."],
  "look.noShelves": [" I don't see", " any."],
  "look.stairsUp": [" The Staircase", " leads up."],
  "look.stairsDown": [" The Staircase", " leads down."],
  "look.stairsBoth": [" The Staircase", " leads both", " up & Down."],
  "look.noStairs": [" I don't see", " any stairs!"],
  "look.noStaircase": [" I don't see", " a staircase!"],
  "look.throne": [" The throne is", " made of stone."],
  "look.noThrone": [" I don't see", " A throne!"],
  "look.fountain": ["The fountain", "is filled", "with water.But", "you can't see", "In it."],
  "look.noFountain": [" I don't see", " A fountain!"],
  "look.statueNecklace": [" The statue is", " wearing a", " Necklace"],
  "look.statue": [" The Statue", " looks like", " The King!"],
  "look.noStatue": [" I don't see", " A Statue!"],
  "look.mirror": [" It looks", " Magical!"],
  "look.noMirror": [" I don't see", " A Mirror!"],
  "look.barrels": [" They look", " Old!"],
  "look.barrel": [" It looks", " Old!"],
  "look.noBarrels": [" I don't see", " any Barrels!"],
  "look.noBarrel": [" I don't see", " a Barrel!"],
  "look.chains": [" They look", " Magical!"],
  "look.chain": [" It looks", " Magical!"],
  "look.noChains": [" I don't see", " any Chains!"],
  "look.noChain": [" I don't see", " a Chain!"],
  "look.kevin": ["The Wall Says:", "Kevin Bales", "was Here!"],
  "look.colors": ["The walls are", "many Colors!"],
  "look.grayStone": ["The {N}S", "are made of", "Gray Stone."],
  "look.highScore": ["Writing on the", "wall says...", "", "{T}", "{S}"],
  "look.noHighScore": ["Writing on the", "wall says...", "", " No high score"],
  "look.gardenGem": [" There is a", " BIG Gem in ", " the Garden", " Fountain!"],
  "look.garden": ["The Garden", "Has A Fountain", "in the middle."],
  "look.noGarden": [" I Don't see", " A Garden!"],
  "look.balcony": ["The balcony is", "made of stone."],
  "look.noBalcony": ["I don't see", "a Balcony!"],
  "look.strong": [" It looks", " very Strong."],
  "look.monsterMean": ["The {M}", "looks Mean!"],
  "look.monsterDead": ["The {M}", "looks Dead!"],
  "look.fairy": [" The {M}", " looks pretty", " but unhappy."],
  "look.unknown": ["I can't see", "a {N},", "and I don't", "have a", "{N}!"],

  // --- DROP / THROW -------------------------------------------------------------------------
  dropDone: [" Done."],
  dropBlocked: [" Something is", " in the way!"],
  dropDontHave: ["You don't have", "a {N}"],

  // --- GET / TAKE / FILL --------------------------------------------------------------------
  getBlood: ["Yuc!!"],
  getItYourself: [" Get it", " Yourself!"],
  getAlreadyHave: [" You already", " have it!"],
  getDontSee: [" I don't see", " a {N}"],
  getCantReach: [" I can't", " reach it!"],
  getDone: ["Done."],
  getTooHeavy: ["{N}", "are too heavy!"],
  getTooHeavyNone: ["{N}", "are too heavy!", "and I don't", "see any!"],
  getChains: [" They're", " Connected to", " the wall."],
  getBarrelsEmpty: [" The Barrels", " are empty."],
  getNoContainer: ["You don't have", "a Container!"],
  getFlaskFull: ["The flask is", "full!"],
  getMonster: ["I don't think", "that would be", "very safe!"],
  impossible: ["Impossible!!"],

  // --- INV ----------------------------------------------------------------------------------
  inventoryTitle: ["- Inventory -"],
  inventoryNothing: ["", "   Nothing."],

  // --- WEAR / PLAY / WAVE / RUB / SAY -------------------------------------------------------
  dontHaveA: ["You don't have", "a {N}!"],
  dontHaveIt: [" You don't", " have it!"],
  wearIt: ["Ok.", "I'm wearing it."],
  wearCrown: [" The crown is", " too Heavy!"],
  wearThem: [" Ok.", " I'm wearing", " them."],
  wearDifficult: ["That could be", "Difficult!"],
  playHorrible: ["The {N}", "makes Horrible", "music!!"],
  playHarp: ["The Harp makes", "Beautiful", "Music!"],
  fairyLeaves: ["The fairy", "likes the music", "and leaves!"],
  vampireGone: ["The vampire", "sees the holy", "cross and", "disappears!"],
  waveSilly: ["You look awful", "Silly waving", "that {N}"],
  waveNothing: ["As you wave the", "{N}....", "", "  Nothing", "  Happens!"],
  waveSecret: ["As you wave the", "{N}....", "", "  There is a", "*Puff* of smoke", "Revealing a",
    "Secret passage!"],
  waveScepterGate: ["As you wave the", "scepter...", "", "The Gate opens", "by itself!"],
  rubLamp: [" There's no", " Genii in this", " Lamp!"],
  rubCleaner: ["The {N}", "is cleaner now."],
  say: ["\"{T}\""],
  sayFunny: ["\"{T}\"", "", "The {M}", "looks at you", "Funny!"],

  // --- LOCK / UNLOCK / OPEN / CLOSE ---------------------------------------------------------
  noKey: [" You don't", " have a Key!"],
  noGate: [" I don't see", " a Gate!"],
  gateMagic: [" The Gate", " is locked", " Magically."],
  gateAlreadyLocked: [" The Gate", " is already", " locked!"],
  noDoor: ["I don't see", "a door!"],
  lockDone: ["Done."],

  // --- EAT / READ / JUMP / CLIMB / MIRROR ---------------------------------------------------
  eat: [" I'm not", " hungry!"],
  readWhat: [" You can't", " read That!"],
  readNoBook: [" You don't", " have a book!"],
  readBlurry: [" You can't see", " well enough.", " It's all", " Blurry."],
  readBook: ["The book reads:", "", "  Wave Scepter"],
  jumpUnsafe: [" I don't think", " it's safe to", " Jump here!"],
  jumped: ["I Jumped.", "", "This is boring."],
  climb: ["I don't need", "to climb."],
  mirror: [" The wicked", "witch never", "lived here!!"],

  // --- DRINK / POUR -------------------------------------------------------------------------
  drinkNoneOf: ["You don't have", "any {N}!"],
  drinkGood: ["That was good!", "I feel much", "better now!"],
  drinkGoodAgain: ["That was good."],
  pourNone: [" You don't", " have any."],
  pourNothing: ["You don't", "have any."],
  pour: ["You pour the", "water & it", "spills on", "the ground."],
  pourGoblet: ["You pour the", "water & it", "spills on", "the ground.", "The goblet had",
    "a hole in it!"],

  // --- PET / KILL / SHOW --------------------------------------------------------------------
  petMonster: ["I don't think", "that would be", "advisable!"],
  petWhat: ["I can't pet", "a {N}!"],
  killMonster: ["Do it yourself!"],
  killWhat: ["I can't kill", "a {N}!"],
  showDontHave: ["I don't have", "a {N}."],
  showFunny: ["", "", "The {M}", "looks at you", "Funny!"],
  showNobody: ["There's not", "anyone to", "show it to!"],

  // --- parser, end of game, title -----------------------------------------------------------
  what: ["What???"],
  quit: ["You've ended the game!"],
  escaped: ["You've Escaped the Castle!"],
  failed: ["You're have failed to Escape!"],
  collected: ["You have collected these Treasues..."],
  killed: ["You have killed these Monsters......"],
  none: ["NONE"],
  score: ["Your Score:{S}"], // BASIC prints a number with a leading space
  perfect: ["    PERFECT!"],
  perfectIs: ["   (1550 is perfect)"],
  title: ["┌──────────────────┐", "│ Castle Adventure │", "│  By Kevin Bales  │",
    "└──────────────────┘"],
  instructions: [
    "   You are trapped in a deserted Castle", "and you must escape. It is rumored that",
    "the  castle is  full of treasures.  Can", "you find them all?                     ",
    " Use the cursor keypad to move your man", "around the rooms.  To pick up a visible",
    "item,  just run into it.  To pick up an", "item not displayed  on  the screen, use",
    "the command  GET.  To  attack  monsters", "just  run  into  them,  but only if you",
    "have a weapon.The computer accepts most", "two word commands. There are 83 rooms &",
    "13 treasures.  To  see the High Score ,", "look at the wall in the courtyard.     ",
    " one hint:Look at everything carefully!",
  ],
};

// The EXE's string table, as extracted by tools/extract-exe.mjs.
const strings = JSON.parse(readFileSync(stringsPath, "utf8")).map((s) => s.text);

const problems = [];
for (const [key, lines] of Object.entries(M))
  for (const line of lines)
    for (const piece of line.split(/\{[A-Z]\}/))
      if (piece && !strings.some((s) => s.includes(piece)) && piece !== '"')
        problems.push(`${key}: ${JSON.stringify(piece)} is not in CASTLE.EXE`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
writeFileSync(out, JSON.stringify(M, null, 1) + "\n");
console.log(`wrote ${Object.keys(M).length} messages to ${out}, all text verified against ${stringsPath}`);
