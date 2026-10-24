// Game data extracted from the original files (see tools/). Loaded as JSON modules so the engine
// runs unchanged in node and in the browser.
import ITEMS from "../../data/items.json" with { type: "json" };
import MONSTERS from "../../data/monsters.json" with { type: "json" };
import MESSAGES from "../../data/messages.json" with { type: "json" };
import TILES from "../../data/tiles.json" with { type: "json" };

export { ITEMS, MONSTERS, MESSAGES, TILES };
