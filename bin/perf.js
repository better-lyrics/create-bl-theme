// ---------------------------------------------------------------------------
// `create-bl-theme perf`: which features of the WebGL renderer a theme turns
// on, and what each costs. The features and their costs are in perf-costs.js.
// ---------------------------------------------------------------------------

import { parseRules } from "./css.js";
import { COSTS, FEATURES } from "./perf-costs.js";
import { commentSettings } from "./webgl.js";

/** The theme as the detectors in perf-costs.js read it. */
function readTheme(css) {
  const declarations = parseRules(css).flatMap(({ selector, conditional, conditions, declarations }) =>
    declarations.filter(([name]) => name.startsWith("--")).map(([name, value, important]) => ({ name, value, important, selector, conditional, conditions }))
  );
  const settings = commentSettings(css);
  const matches = (name) => (typeof name === "string" ? (d) => d.name === name : (d) => name.test(d.name));
  return {
    declared: (name) => declarations.filter(matches(name)),
    value: (name) => declarations.filter((d) => d.name === name && !d.conditional).at(-1)?.value,
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
