// Turns the original's message lines (data/messages.json) into message events.
import { MESSAGES } from "./data.js";

/** The original lines of a message with its placeholders filled in. */
export function lines(key, vars = {}) {
  const template = MESSAGES[key];
  if (!template) throw new Error(`unknown message ${key}`);
  return template.map((line) => line.replace(/\{([A-Z])\}/g, (_, k) => String(vars[k] ?? "")));
}

/**
 * Message events for a block of original lines. The original wraps sentences over short panel
 * lines and uses an empty line to separate thoughts, so each run of lines between empty lines
 * becomes one event whose text is those lines joined. `lines` keeps the original layout.
 */
export function messageEvents(block, { separate = false } = {}) {
  const events = [];
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const text = group.map((l) => l.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
    if (text) events.push({ type: "message", text, lines: group });
    group = [];
  };
  for (const line of block) {
    if (separate) {
      group.push(line);
      flush();
    } else if (line.trim() === "") flush();
    else group.push(line);
  }
  flush();
  return events;
}

/** BASIC prints a non-negative number with a leading space. */
export const basicNumber = (n) => (n >= 0 ? ` ${n}` : String(n));
