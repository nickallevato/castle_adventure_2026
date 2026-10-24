// Workbench-style requesters (menus, save slots, death / escape) built from plain DOM.

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
export { el };

export function requester({ title, body = [], buttons = [], layout = "row", onClose, id, low = false }) {
  const host = document.getElementById("overlays");
  const btns = buttons.map((b) =>
    el("button", { class: "wb-btn" + (b.primary ? " primary" : ""), disabled: b.disabled, onclick: () => b.onClick?.(), "data-key": b.key }, b.key ? el("span", { class: "key" }, b.key.toUpperCase()) : null, b.label),
  );
  const win = el("div", { class: "wb-window requester", role: "dialog", "aria-label": title },
    el("div", { class: "wb-title" }, el("span", { class: "wb-close", onclick: () => close() }), el("span", { class: "wb-name" }, title)),
    el("div", { class: "wb-body" }, ...body, el("div", { class: layout }, ...btns)),
  );
  const ov = el("div", { class: "overlay" + (low ? " low" : ""), id }, win);
  ov.addEventListener("pointerdown", (e) => { if (e.target === ov) close(); });
  host.append(ov);
  btns.find((b) => !b.disabled)?.focus({ preventScroll: true });
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    ov.remove();
    onClose?.();
  }
  const onKey = (e) => {
    const k = e.key.toLowerCase();
    const b = buttons.find((x) => x.key && x.key.toLowerCase() === k && !x.disabled);
    if (b) { e.preventDefault(); e.stopPropagation(); b.onClick?.(); }
  };
  ov.addEventListener("keydown", onKey);
  return { el: ov, close, onKey, buttons };
}

export function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
