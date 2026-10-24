// Short room titles derived from the original descriptions ("You are in the Throne Room. ..." -> "Throne Room").
export function roomTitle(desc = "") {
  let s = String(desc).replace(/\s+/g, " ").trim();
  const m = s.match(/^You are\s+(in|on|at|below)\s+(.*?)(?:\.|$)/i);
  if (m) s = (m[1].toLowerCase() === "below" ? "Below the " : "") + m[2].replace(/^the\s+/i, "");
  else s = s.split(".")[0];
  s = s.replace(/^(the|a|an)\s+/i, "");
  s = s.replace(/^(top|bottom|center|west end|east end|north end|south end) of\s+(the\s+)?/i, (all, a) => a[0].toUpperCase() + a.slice(1) + " of ");
  s = s.replace(/\b(\w)/g, (c) => c.toUpperCase()).replace(/'S\b/g, "'s").replace(/\bOf\b/g, "of").replace(/\bThe\b/g, "the");
  s = s.replace(/^the /, "").replace(/Cooridor/g, "Corridor").replace(/Anex/g, "Annex").replace(/Batlement/g, "Battlement")
    .replace(/Toture/g, "Torture").replace(/Entrace/g, "Entrance").replace(/Winecellar/i, "Wine Cellar").replace(/the(West|East)/gi, (x, d) => d);
  s = s.replace(/\s+Looking Over.*$/i, "").replace(/Below the the/i, "Below the");
  return s.length > 34 ? s.slice(0, 33) + "…" : s;
}
