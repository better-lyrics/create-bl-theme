// ---------------------------------------------------------------------------
// `create-bl-theme perf`: which features of the WebGL renderer a theme turns
// on, and what each costs. The features and their costs are in perf-costs.js.
// ---------------------------------------------------------------------------

import { compareSpecificity, compounds, parseRules, simples, specificity, splitTopLevel } from "./css.js";
import { COSTS, FEATURES } from "./perf-costs.js";
import { commentSettings } from "./webgl.js";

/** Elements always above the lyrics container. */
const ANCESTOR = /^(?::root|html|body|ytmusic-app|ytmusic-app-layout|ytmusic-player-page|#layout|#content|#player-page|#side-panel|#tab-renderer|#blyrics-wrapper)$/;
const SYNC = /^\[data-sync=["']?([\w-]+)["']?\]$/;

/**
 * Where a selector sets what the container reads in every song (of `sync`, when given):
 * { near: 2, specificity } on the container itself, { near: 1 } on an element above it, or null.
 */
function onContainer(selector, sync) {
  let best = null;
  for (const one of splitTopLevel(selector, ",").map((s) => s.trim())) {
    const parts = compounds(one);
    if (parts.length === 0 || parts.some((p) => p.combinator === "+" || p.combinator === "~")) continue;
    if (!parts.slice(0, -1).every((p) => simples(p.compound).every((s) => ANCESTOR.test(s)))) continue;
    const own = simples(parts[parts.length - 1].compound);
    const found = own.every((s) => ANCESTOR.test(s))
      ? { near: 1, specificity: [0, 0, 0] }
      : own.every((s) => /^(?:\*|div|\.blyrics-container|:not\(\[data-no-lyrics[^\]]*\]\))$/.test(s) || (sync && SYNC.exec(s)?.[1] === sync))
        ? { near: 2, specificity: specificity(one) }
        : null;
    if (found && (!best || found.near > best.near || compareSpecificity(found.specificity, best.specificity) > 0)) best = found;
  }
  return best;
}

/** The theme as the detectors in perf-costs.js read it. */
function readTheme(css) {
  const pseudo = (selector) => splitTopLevel(selector, ",").every((one) => /::?(?:before|after)\b|::/.test(one));
  const declarations = parseRules(css).flatMap(({ selector, conditional, conditions, declarations }) =>
    pseudo(selector) ? [] : declarations.filter(([name]) => name.startsWith("--")).map(([name, value, important]) => ({ name, value, important, selector, conditional, conditions }))
  );
  const settings = commentSettings(css);
  const matches = (name) => (typeof name === "string" ? (d) => d.name === name : (d) => name.test(d.name));
  /** The declaration the container ends up with: its own over an ancestor's, then !important, specificity and order. */
  const winning = (name, sync) => {
    let best = null;
    declarations.forEach((d) => {
      const where = d.name === name && !d.conditional ? onContainer(d.selector, sync) : null;
      if (!where) return;
      const next = { d, important: d.important ? 1 : 0, ...where };
      // Ties go to the later declaration.
      const diff = best ? next.near - best.near || next.important - best.important || (next.near === 2 ? compareSpecificity(next.specificity, best.specificity) : 0) : 1;
      if (diff >= 0) best = next;
    });
    return best?.d;
  };
  return {
    declared: (name) => declarations.filter(matches(name)),
    winning,
    conditional: (name, sync) => declarations.filter((d) => d.name === name && d.conditional && onContainer(d.selector, sync)),
    value: (name) => winning(name)?.value,
    setting: (key) => settings.get(key),
    where: (d) => `\`${d.name}: ${d.value.replace(/\s+/g, " ")}\` on \`${d.selector}\`${d.conditional ? ` (in \`${d.conditions.join(" ")}\`)` : ""}`,
    clear: isClear,
  };
}

/** Whether a colour is fully transparent. */
function isClear(colour) {
  const value = colour.trim().toLowerCase();
  if (value === "transparent" || /^#(?:[\da-f]{3}0|[\da-f]{6}00)$/.test(value)) return true;
  // The alpha of rgb()/hsl()/color(), after a slash or as the fourth argument.
  const alpha = /\/\s*([\d.]+%?)\s*\)$/.exec(value)?.[1] ?? /^(?:rgba|hsla)\((?:[^,()]*,){3}\s*([\d.]+%?)\s*\)$/.exec(value)?.[1];
  return alpha !== undefined && Number.parseFloat(alpha) === 0;
}

/**
 * The features `css` turns on, dearest first, each with { id, title, cost, reason, tip, source },
 * `source` saying what turned it on; and the overall cost, the dearest feature's.
 */
export function perfReport(css) {
  const theme = readTheme(css);
  const features = FEATURES.map(({ detect, ...feature }) => ({ ...feature, source: detect(theme) }))
    .filter((feature) => feature.source && feature.source.length > 0)
    .map((feature, order) => ({ ...feature, order }))
    .sort((a, b) => COSTS.indexOf(b.cost) - COSTS.indexOf(a.cost) || a.order - b.order)
    .map(({ order, ...feature }) => feature);
  const overall = features[0]?.cost ?? "low";
  return { features, overall, because: features.filter((f) => f.cost === overall && overall !== "low").map((f) => f.id) };
}
