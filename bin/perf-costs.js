// ---------------------------------------------------------------------------
// What each feature of the WebGL renderer (@braccato/core 2) costs, for
// `create-bl-theme perf`. One entry per feature: what turns it on (`detect`),
// how much it costs and why, and how to make it cheaper.
//
// The costs are provisional ratings, to be replaced by numbers measured with
// braccato's bench (`pnpm bench`). Keep them here, so that is one edit.
//
// `detect(theme)` returns where the theme turns the feature on, as a list of
// short descriptions, or null when it is off. `theme` is what bin/perf.js
// reads from the stylesheet:
//   theme.declared(name | regexp)  every declaration of a custom property
//   theme.value(name)              the last one outside media queries, or undefined
//   theme.setting(key)             a comment setting (`blyrics-key = value;`), or undefined
//   theme.where(declaration)       "`--name: value` on `selector`"
//   theme.clear(colour)            whether a colour is fully transparent
// ---------------------------------------------------------------------------

/** From cheapest to dearest. */
export const COSTS = ["low", "medium", "high"];

const GLOW_DEFAULT = "on by default: `--blyrics-glow-color` defaults to `--blyrics-highlight-color` at 0.5 alpha";
const ZERO = /^(?:0|0?\.0+|0(?:px|r?em|%)|none|blur\(\s*0[a-z]*\s*\))$/i;

/** The declarations of `names` with a value other than what leaves lines as they are. */
function changed(theme, names, neutral) {
  return theme.declared(names).filter((d) => d.value.split(/\s+/).some((v) => !neutral.test(v))).map(theme.where);
}

/** Where the glow shows: { all, held } with what turns each on, or null when it is off. */
function glow(theme) {
  if (theme.value("--blyrics-animate-highlight-glow") === "0") return null;
  if (ZERO.test(theme.value("--blyrics-highlight-glow-radius-from") ?? "")) return null;
  const colours = theme.declared("--blyrics-glow-color");
  const scope = (d) => (/:not\(\s*\[data-long-word/.test(d.selector) ? "others" : /\[data-long-word/.test(d.selector) ? "held" : "all");
  const of = (kind) => colours.filter((d) => scope(d) === kind);
  const shown = (list) => list.filter((d) => !theme.clear(d.value));
  let base;
  if (of("all").length > 0) base = shown(of("all")).map(theme.where);
  else {
    const highlight = theme.declared("--blyrics-highlight-color");
    base = highlight.length > 0 && shown(highlight).length === 0 ? [] : [GLOW_DEFAULT, ...shown(highlight).map(theme.where)];
  }
  const othersCleared = of("others").length > 0 && shown(of("others")).length === 0;
  if (base.length > 0 && !othersCleared) return { all: [...base, ...shown(of("others")).map(theme.where)] };
  const held = [...(base.length > 0 ? of("others").map(theme.where) : []), ...shown(of("held")).map(theme.where)];
  return base.length > 0 || shown(of("held")).length > 0 ? { held } : null;
}

/** What the letter wave splits into letters: "all", "long", or null when nothing waves. */
function letterWave(theme) {
  if (theme.value("--blyrics-animate-word-wobble") === "0") return null;
  const setting = theme.setting("blyrics-letter-wave")?.toLowerCase();
  if (setting === undefined || setting === "true") return "all";
  return setting === "long" ? "long" : null;
}

export const FEATURES = [
  {
    id: "glow-every-word",
    title: "Glow on every word",
    cost: "high",
    reason: "each glowing word is drawn again and blurred on the GPU every frame while its glow fades, a second or more after it is sung, so several words glow at once",
    tip: "Keep the glow to held words with `.blyrics-word-highlight:not([data-long-word]) { --blyrics-glow-color: transparent; }`, or turn it off with `--blyrics-animate-highlight-glow: 0`.",
    detect: (theme) => glow(theme)?.all ?? null,
  },
  {
    id: "glow-held-words",
    title: "Glow on held words",
    cost: "medium",
    reason: "each held word is drawn again and blurred on the GPU every frame while its glow fades",
    tip: "Turn the glow off with `--blyrics-animate-highlight-glow: 0` if the theme does not need it.",
    detect: (theme) => glow(theme)?.held ?? null,
  },
  {
    id: "letter-wave-every-word",
    title: "Letter wave on every word",
    cost: "medium",
    reason: "every word is split into letters, each moved and drawn on its own while the word is sung",
    tip: "Wave only held words with the comment setting `/* blyrics-letter-wave = long; */`.",
    detect: (theme) => {
      if (letterWave(theme) !== "all") return null;
      const setting = theme.setting("blyrics-letter-wave");
      return [setting === undefined ? "on by default: `blyrics-letter-wave` defaults to `true`" : `\`blyrics-letter-wave = ${setting};\` (comment setting)`];
    },
  },
  {
    id: "letter-wave-held-words",
    title: "Letter wave on held words",
    cost: "low",
    reason: "only held words are split into letters",
    tip: null,
    detect: (theme) => (letterWave(theme) === "long" ? [`\`blyrics-letter-wave = ${theme.setting("blyrics-letter-wave")};\` (comment setting)`] : null),
  },
  {
    id: "letter-wave-glow",
    title: "Letter wave glow",
    cost: "low",
    reason: "it brightens the glow a held word already draws, letter by letter",
    tip: null,
    detect: (theme) => {
      if (!letterWave(theme)) return null;
      const found = changed(theme, "--blyrics-letter-wave-glow", ZERO);
      return found.length ? found : null;
    },
  },
  {
    id: "line-blur",
    title: "Line distance blur",
    cost: "high",
    reason: "each blurred line is drawn again and blurred on the GPU every frame, and lines are large",
    tip: "Blur fewer lines (end the list early with its last value, or 0), or fade them with `--blyrics-line-opacity-*` instead.",
    detect: (theme) => {
      const found = changed(theme, /^--blyrics-line-blur(?:-before|-after)?$/, ZERO);
      return found.length ? found : null;
    },
  },
  {
    id: "hover-blur",
    title: "Hover blur",
    cost: "medium",
    reason: "the line under the mouse is drawn again and blurred on the GPU every frame while it is hovered",
    tip: "Use `--blyrics-line-hover-opacity` instead, or `--blyrics-line-hover-blur: 0` to sharpen the hovered line, which costs nothing.",
    detect: (theme) => {
      const found = changed(theme, "--blyrics-line-hover-blur", ZERO);
      return found.length ? found : null;
    },
  },
  {
    id: "line-filters",
    title: "Line saturation and brightness",
    cost: "low",
    reason: "applied to each line's colours as it is drawn",
    tip: null,
    detect: (theme) => {
      const found = changed(theme, /^--blyrics-line-(?:saturate|brightness)(?:-before|-after)?$/, /^(?:1|100%)$/);
      return found.length ? found : null;
    },
  },
  {
    id: "line-opacity",
    title: "Line distance opacity",
    cost: "low",
    reason: "applied to each line as it is drawn",
    tip: null,
    detect: (theme) => {
      const found = changed(theme, /^--blyrics-line-opacity(?:-before|-after)?$/, /^(?:1|100%)$/);
      return found.length ? found : null;
    },
  },
  {
    id: "browsing-opacity",
    title: "Opacity while browsing",
    cost: "low",
    reason: "applied to each line as it is drawn",
    tip: null,
    detect: (theme) => {
      const found = theme.declared("--blyrics-line-opacity-browsing").map(theme.where);
      return found.length ? found : null;
    },
  },
  {
    id: "hover-look",
    title: "Hover opacity, scale and colour",
    cost: "low",
    reason: "applied to the hovered line as it is drawn",
    tip: null,
    detect: (theme) => {
      const found = theme.declared(/^--blyrics-line-hover-(?:opacity|scale|color)$/).map(theme.where);
      return found.length ? found : null;
    },
  },
  {
    id: "text-shadow",
    title: "Text shadow",
    cost: "low",
    reason: "drawn once into the line's texture, not every frame",
    tip: null,
    detect: (theme) => {
      const found = theme.declared("--blyrics-text-shadow").filter((d) => d.value !== "none").map(theme.where);
      return found.length ? found : null;
    },
  },
  {
    id: "state-shadows",
    title: "Sung and hovered line shadows",
    cost: "low",
    reason: "drawn once into the line's texture; only their opacity changes from frame to frame",
    tip: null,
    detect: (theme) => {
      const found = theme.declared(/^--blyrics-(?:active|line-hover)-text-shadow$/).filter((d) => d.value !== "none").map(theme.where);
      return found.length ? found : null;
    },
  },
  {
    id: "line-boxes",
    title: "Boxes behind lines",
    cost: "low",
    reason: "one quad behind each line that has one",
    tip: null,
    detect: (theme) => {
      const found = theme.declared(/^--blyrics-line-(?:hover-)?(?:bg|border)-color$/).filter((d) => !theme.clear(d.value)).map(theme.where);
      return found.length ? found : null;
    },
  },
  {
    id: "word-wobble",
    title: "Word wobble",
    cost: "low",
    reason: "moves each word as one piece while it is sung",
    tip: null,
    detect: (theme) => (theme.value("--blyrics-animate-word-wobble") === "0" ? null : ["on by default: `--blyrics-animate-word-wobble` defaults to `1`"]),
  },
  {
    id: "syllable-wobble",
    title: "Wobble per syllable",
    cost: "low",
    reason: "moves each syllable as one piece instead of each word",
    tip: null,
    detect: (theme) => {
      if (theme.value("--blyrics-animate-word-wobble") === "0") return null;
      const found = theme.declared("--blyrics-word-wobble-scope").filter((d) => d.value === "syllable").map(theme.where);
      return found.length ? found : null;
    },
  },
  {
    id: "rest-transform",
    title: "Words rising from a rest pose",
    cost: "low",
    reason: "moves each word as one piece until it is sung",
    tip: null,
    detect: (theme) => {
      const found = theme.declared("--blyrics-word-rest-transform").filter((d) => d.value !== "none").map(theme.where);
      return found.length ? found : null;
    },
  },
  {
    id: "image-highlights",
    title: "Image highlights",
    cost: "low",
    reason: "fills the instrumental note with `--blyrics-highlight-image`",
    tip: null,
    detect: (theme) => (theme.setting("blyrics-image-highlights")?.toLowerCase() === "true" ? [`\`blyrics-image-highlights = ${theme.setting("blyrics-image-highlights")};\` (comment setting)`] : null),
  },
  {
    id: "romanized-pill",
    title: "Romanization box",
    cost: "low",
    reason: "one quad behind each romanization, in songs that have them",
    tip: null,
    detect: (theme) => {
      const colours = theme.declared("--blyrics-romanized-bg-color");
      if (colours.length === 0) return ["on by default: `--blyrics-romanized-bg-color` defaults to a translucent white"];
      const found = colours.filter((d) => !theme.clear(d.value)).map(theme.where);
      return found.length ? found : null;
    },
  },
];
