// ---------------------------------------------------------------------------
// Theme migration for the WebGL renderer (@braccato/core 2).
//
// The WebGL renderer draws the lyrics on a canvas. The lines still exist in the
// page, laid out but invisible, so a theme's layout (fonts, sizes, padding,
// alignment) and its `--blyrics-*` variables still apply, but nothing paints
// them: rules that style the line elements themselves (opacity, filter,
// transform, colour, shadows, backgrounds, animations) do nothing, and the
// state classes those rules key off (`.blyrics--active`, `.blyrics--animating`,
// `.blyrics--paused`) are never set.
//
// The effects themes build that way most often have variable forms. Fading,
// blurring, desaturating and darkening lines by where they are relative to the
// sung one are lists: `--blyrics-line-opacity[-before|-after]` and the `-blur`,
// `-saturate` and `-brightness` lists beside it, of values for the sung line,
// then 1, 2, 3... lines away. The hovered line, the other lines while the
// reader browses, a word's pose until it is sung, its opacity once sung, and a
// static text shadow each have a variable too. This pass reads the theme's
// rules and writes those variables, which the current DOM renderer ignores, so
// the theme keeps working on both.
//
// The renderer reads the line variables once, from the container, which says
// whether the song is word-synced (`data-sync="richsync"`) or line-synced
// (`synced`). So they are worked out for each, and written under that
// `[data-sync]` where the two differ. The word and shadow variables are read
// from each element, so they go under the theme's own selectors.
//
// It edits someone else's theme, so it writes a value only where the cascade
// settles it: never from a rule for only some screens, views or lines, never
// over a value the author wrote, never past a value it cannot read. Those,
// and everything else, are flagged: with the variable replacement where there
// is one, and as not possible yet where there is none, so the author can ask.
//
// The full mapping is in skills/MIGRATION.md.
// ---------------------------------------------------------------------------

import { argumentsOf, blankComments, compareSpecificity, compounds, expandIs, parseRules, simples, specificity, splitTopLevel } from "./css.js";

export const DISCORD_URL = "https://discord.gg/UsHE3d5fWF";

const BLOCK_BEGIN = "/* create-bl-theme migrate: WebGL renderer (begin) */";
const BLOCK_END = "/* create-bl-theme migrate: WebGL renderer (end) */";
const BLOCK = new RegExp(`${escapeRegExp(BLOCK_BEGIN)}[\\s\\S]*?${escapeRegExp(BLOCK_END)}`);

/** Variables only the DOM renderer read. */
const DEAD_VARIABLES = [
  {
    pattern: /--blyrics-highlight-glow-filter-(?:from|to)\b/g,
    message:
      "`--blyrics-highlight-glow-filter-from/-to` are not read by the WebGL renderer. Set the glow's size with `--blyrics-highlight-glow-radius-from` / `--blyrics-highlight-glow-radius-to` and its colour with `--blyrics-glow-color`.",
  },
  {
    pattern: /--blyrics-line-(?:enter|exit)-transform-(?:from|to)\b/g,
    message:
      "`--blyrics-line-enter/exit-transform-*` are not read by the WebGL renderer. Lines grow and shrink with `--blyrics-active-scale` (sung) and `--blyrics-scale` (the rest), timed by `--blyrics-scale-transition-duration` and `--blyrics-line-enter-easing` / `--blyrics-line-exit-easing`.",
  },
  {
    pattern: /--blyrics-instrumental-(?:wave-path-(?:high|low)|wave-transform-(?:from|to)|fill-transform-(?:from|to)|fill-easing|fill-fade-easing|wave-easing|wave-oscillation-easing)\b/g,
    message:
      "The WebGL renderer draws the instrumental note itself and does not read this variable. Its colours follow the lyric colours; `--blyrics-instrumental-fill-fade-duration`, `--blyrics-instrumental-wave-oscillation-duration` and `--blyrics-animate-instrumental` still apply.",
  },
  {
    pattern: /--blyrics-word-wobble-end-easing\b/g,
    message:
      "`--blyrics-word-wobble-end-easing` is not read by the WebGL renderer; `--blyrics-word-wobble-easing` and `--blyrics-word-wobble-peak-easing` are.",
  },
  {
    pattern: /--blyrics-image-glow-opacity-(?:from|to)\b/g,
    message: "`--blyrics-image-glow-opacity-*` is not read by the WebGL renderer.",
  },
  {
    pattern: /--blyrics-line-scroll-[a-z-]+|--blyrics-lyric-scroll-duration\b/g,
    message:
      "The per-line `--blyrics-line-scroll-*` variables were set by the DOM renderer for its scroll animation; the WebGL renderer glides the view itself. Its timing is `--blyrics-lyric-scroll-timing-function`, `--blyrics-scroll-timing-offset` and `--blyrics-target-scroll-pos-ratio`.",
  },
  {
    pattern: /var\(\s*--blyrics-duration\b/g,
    message:
      "`--blyrics-duration` was set on each word by the DOM renderer for theme transitions to use. The WebGL renderer does not set it, and theme transitions on lyric elements do not run there.",
  },
];

const LYRIC_SUBJECT = /\.blyrics--(?:line|word|letter|active|animating|paused|translated|romanized|instrumental)\b|\.blyrics-word-highlight\b|\.blyrics-background-(?:line|lyric)\b|\.blyrics-line-main\b|\.blyrics-container\s*>\s*(?:div|\*|:is|:not)/;
/** What the lists and hover values stand for, with what a line is when no rule says. */
const KINDS = {
  opacity: { property: "opacity", rest: "1", parse: parseOpacity },
  blur: { property: "filter", rest: "0", parse: parseBlur },
  saturate: { property: "filter", rest: "1", parse: (value) => parseFilterAmount(value, "saturate") },
  brightness: { property: "filter", rest: "1", parse: (value) => parseFilterAmount(value, "brightness") },
};
/** The kinds each line property gives. */
const PROPERTY_KINDS = {
  opacity: ["opacity"],
  filter: ["blur", "saturate", "brightness"],
  transform: ["scale"],
  scale: ["scale"],
  visibility: ["visibility"],
  "pointer-events": ["pointer-events"],
};
/** The sync types a song can have that the renderer draws with the theme's line rules. */
const SYNCS = ["richsync", "synced"];
const OTHER_FILTER = /\b(?:brightness|contrast|saturate|grayscale|sepia|hue-rotate|invert|drop-shadow)\s*\(/;
/** State the renderer applies itself, which variables cannot be scoped by. */
const STATEFUL = /\.blyrics--(?:active|animating|paused)\b|\[data-word-state\b|:hover\b|:focus\b|:focus-within\b|\.blyrics-user-scrolling\b/;

/** `text` without the block an earlier run wrote, its lines kept. What is to be compiled and read. */
export function withoutBlock(text) {
  return text.replace(BLOCK, (block) => block.replace(/[^\n]/g, " "));
}

/**
 * Returns { output, changes, flags, unsupported, settles } for `source`, given the CSS
 * `withoutBlock(source)` compiles to (the source itself for a .css theme). `changes` and `flags`
 * are in the shape migrateSource uses; `settles` lists the codes of migrateSource's flags the
 * written block takes care of.
 */
export function migrateForWebgl(source, css) {
  const changes = [];
  const flags = [];
  const unsupported = [];
  const rules = parseRules(withoutBlock(css));
  const authored = new Set(rules.flatMap((rule) => rule.declarations.map(([name]) => name)));
  const review = (message, where = null) => flags.push({ line: where, code: "review", message });
  // Declarations a written variable stands in for, so section 3 does not report them again.
  const covered = new Set();
  const cover = (selector, property) => covered.add(`${selector}\n${property}`);
  const customs = Object.fromEntries(SYNCS.map((sync) => [sync, customProperties(rules, sync)]));

  // 1. What the renderer reads from the container, worked out for each sync type: the distance
  //    lists, the hovered line, the lines while browsing, the words' rise.
  const words = wordValues(rules, customs, authored, review, cover);
  const perSync = SYNCS.map((sync) => {
    const candidates = lineCandidates(rules, customs[sync], sync, review);
    return [
      ...distanceLists(candidates, authored, review),
      ...hoverValues(candidates, authored, review),
      ...browsingValue(rules, customs[sync], sync, candidates, authored, review, cover),
      ...words.themeWide,
    ];
  });

  // 2. What it reads from each element, under the theme's own selectors.
  const pseudo = pseudoVariables(rules, review);
  const groups = [...themeWide(perSync), ...words.groups, ...textShadows(rules, authored, review, unsupported, cover), ...pseudo.groups];
  const { output, change } = withBlock(source, groups);
  if (change) changes.push(change);

  // 3. What lyric rules do that the renderer cannot see. Read from the compiled CSS, where RICS
  //    nesting is flattened, so each finding names its full selector.
  for (const { selector, declarations } of rules) {
    for (const one of splitTopLevel(selector, ",")) {
      for (const [property, value] of declarations) {
        if (!covered.has(`${one.trim()}\n${property}`)) classify(one.trim(), property, value);
      }
    }
  }
  function classify(selector, property, value) {
    const line = selector;
    if (!LYRIC_SUBJECT.test(selector)) return;
    // The footer and the buttons are ordinary DOM beside the lines.
    if (compounds(selector).some((part) => /^\.blyrics-(?:footer|no-lyrics)|\.blyrics-footer/.test(withoutArguments(part.compound)))) return;
    const pseudo = /::?(?:before|after)\b/.test(selector);
    const word = /\.blyrics--word\b|\.blyrics--letter\b|\.blyrics-word-highlight\b/.test(lastCompound(selector));
    const otherFilter = property === "filter" && OTHER_FILTER.test(value);
    const lineFilter = property === "filter" && /\b(?:contrast|grayscale|sepia|hue-rotate|invert|drop-shadow)\s*\(/.test(value);

    if (compounds(selector).some((part) => isHovered(part.compound)) && /^(?:opacity|filter|transform|scale|color|background|text-shadow)/.test(property)) {
      const line_ = expandIs(selector).map(hoveredLine).find(Boolean);
      if (!line_) {
        unsupported.push({ line, code: "hover", message: "Hover effects other than on the hovered line itself and the opacity of the other lines (for example blurring the other lines while the mouse is over the lyrics) do not show in the WebGL renderer." });
      } else if (otherFilter || !/^(?:opacity|filter|transform|scale)$/.test(property)) {
        unsupported.push({ line, code: "hover", message: `\`${property}\` on a hovered line does not show. The line under the mouse can only change its opacity, blur and scale (\`--blyrics-line-hover-opacity\`, \`-blur\`, \`-scale\`).` });
      }
      return;
    }
    // The DOM renderer's sweep overlay was the word's `::after`; the WebGL renderer draws the sweep
    // itself, so only content a theme adds there is lost.
    if (pseudo) {
      if (property === "content") unsupported.push({ line, code: "pseudo-content", message: "`::before` / `::after` content on lyric elements is not drawn by the WebGL renderer." });
      return;
    }
    switch (property) {
      case "opacity":
      case "filter":
        if (word) {
          if (/^(?:1|100%|none)$/.test(value)) return;
          unsupported.push({ line, code: "word-opacity", message: "Opacity or filters on single words are not drawn. Words are shown in `--blyrics-lyric-inactive-color` until sung and `--blyrics-lyric-active-color` while sung, which can carry an alpha, and sung words in the line being sung fade to `--blyrics-word-past-opacity`." });
        } else if (lineFilter) {
          unsupported.push({ line, code: "line-filter", message: "Line filters other than `blur()`, `saturate()` and `brightness()` are not drawn by the WebGL renderer." });
        } else {
          flags.push({ line, code: "line-opacity", message: "Opacity and filters on lines are not drawn by the WebGL renderer: it fades, blurs, desaturates and darkens lines from `--blyrics-line-opacity[-before|-after]` and the `-blur`, `-saturate` and `-brightness` lists beside it instead (written above where this theme's rules could be read). The rule can stay for the current renderer." });
        }
        return;
      case "transform":
      case "scale":
      case "translate":
      case "rotate":
        flags.push({ line, code: "line-transform", message: "Transforms on lyric elements are not drawn. The sung line's size is `--blyrics-active-scale` and the others' `--blyrics-scale`; words wait in `--blyrics-word-rest-transform` until sung and move with the `--blyrics-word-wobble-transform-*` and `--blyrics-letter-wave-*` variables. Rotations and skews have no equivalent." });
        return;
      case "color":
      case "-webkit-text-fill-color":
        flags.push({ line, code: "color", message: "Colours on lyric elements are read from variables, not `color`: `--blyrics-lyric-inactive-color` (not yet sung), `--blyrics-lyric-active-color` (sung), `--blyrics-glow-color` and `--blyrics-translated-color`. Set them in the same rule to colour these elements; they resolve per element, so selectors such as `[data-agent=\"v2\"]` still work." });
        return;
      case "animation":
      case "animation-name":
      case "transition":
      case "transition-property":
        flags.push({ line, code: "motion", message: "Animations and transitions on lyric elements do not run in the WebGL renderer; it times its own effects. Its timing variables are `--blyrics-scale-transition-duration`, `--blyrics-lyric-highlight-fade-in/out-duration`, `--blyrics-wobble-duration` and the easing variables beside them. A custom keyframe effect has no equivalent." });
        return;
      case "box-shadow":
      case "-webkit-text-stroke":
      case "-webkit-text-stroke-width":
      case "-webkit-text-stroke-color":
      case "outline":
      case "border":
      case "border-color":
      case "background":
      case "background-color":
      case "background-image":
      case "background-clip":
      case "mix-blend-mode":
        unsupported.push({ line, code: "paint", message: `\`${property}\` on lyric elements is not drawn by the WebGL renderer (it paints text, its shadow, the glow and image highlights only).` });
        return;
      case "text-shadow":
        // What textShadows did not take: the sweep overlay's own shadow, or one on another element.
        if (value !== "none") unsupported.push({ line, code: "paint", message: "`text-shadow` here is not drawn by the WebGL renderer. It draws one static shadow under the text of lines, words, translations and romanizations, from `--blyrics-text-shadow`." });
        return;
      case "padding":
      case "padding-top":
      case "padding-bottom":
      case "padding-block":
      case "margin":
      case "margin-top":
      case "margin-bottom":
      case "margin-block":
        if (/\.blyrics--(?:line|word)\b|\.blyrics-container\s*>\s*(?:div|\*)/.test(lastCompound(selector)) || /\.blyrics-container\s*>\s*(?:div|\*)\s*$/.test(selector)) {
          flags.push({ line, code: "line-spacing", message: "The WebGL renderer sets the padding and margin of lines and words itself, so they line up with what it draws. The space around each line is `--blyrics-padding` (set it on `.blyrics-container`, or on lines to vary it)." });
        }
        return;
      case "visibility":
        flags.push({ line, code: "visibility", message: "To hide lines, end an opacity list with 0 (for example `--blyrics-line-opacity-after: 1 0.6 0`)." });
        return;
      case "display":
        if (/^none\b/.test(value)) {
          flags.push({ line, code: "display-none", message: "`display: none` on lyric elements removes them from the layout the renderer measures, so they are neither drawn nor scrolled to. Hide lines with an opacity list instead, unless removing them is the intent." });
        }
        return;
    }
  }

  // 3. Variables only the DOM renderer read, found in the source so each finding has its line.
  const text = blankComments(withoutBlock(source));
  for (const dead of DEAD_VARIABLES) {
    for (const m of text.matchAll(dead.pattern)) flags.push({ line: `L${lineOf(text, m.index)}`, code: "dead-var", message: dead.message });
  }

  return { output, changes, flags: group(flags), unsupported: group(unsupported), settles: pseudo.settles };
}

// -- The block -------------------------------------------------------------

/** `groups` is [{ selector, declarations }], in the order they are to be written. */
function withBlock(source, groups) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const existing = BLOCK.exec(source);
  const at = existing ? lineOf(source, existing.index) : 0;
  if (groups.length === 0) {
    if (!existing) return { output: source, change: null };
    const before = source.slice(0, existing.index).trimEnd();
    const after = source.slice(existing.index + existing[0].length).trimStart();
    return {
      output: `${before}${newline}${after ? `${newline}${after}` : ""}`,
      change: { line: at, code: "distance-lists", message: "Removed the block an earlier migrate wrote: the theme's rules no longer give values for it." },
    };
  }
  const block = [
    BLOCK_BEGIN,
    "/* This theme's rules as the WebGL renderer reads them: lines fade, blur and dim by their",
    "   distance from the sung line, the line under the mouse takes the hover values, and words and",
    "   their shadows take the variables below. The current renderer ignores these and keeps using",
    "   the rules. */",
    ...groups.flatMap(({ selector, declarations }) => [`${selector} {`, ...declarations.map((d) => `  ${d}`), "}"]),
    BLOCK_END,
  ].join(newline);
  if (existing?.[0] === block) return { output: source, change: null };
  // In place, so what the author added after the block stays after it.
  const output = existing ? source.replace(BLOCK, () => block) : `${source.trimEnd()}${newline}${newline}${block}${newline}`;
  const names = [...new Set(groups.flatMap(({ declarations }) => declarations.map((d) => d.split(":")[0])))];
  const hover = (name) => name.includes("-hover-") || name.endsWith("-browsing");
  const lines = names.some((name) => name.startsWith("--blyrics-line-") && !hover(name));
  const words = names.some((name) => name.startsWith("--blyrics-word-"));
  const checks = [lines && "the fade", names.some(hover) && "the hover", words && "the words"].filter(Boolean);
  return {
    output,
    change: {
      line: lineOf(output, output.indexOf(BLOCK_BEGIN)),
      code: "distance-lists",
      message: `${existing ? "Updated" : "Added"} ${names.join(", ")} from the theme's rules.${checks.length ? ` Watch a synced song to check ${checks.join(", ").replace(/, ([^,]*)$/, " and $1")} match.` : ""}`,
    },
  };
}

/** One group of theme-wide values when both sync types give the same, else one under each. */
function themeWide(perSync) {
  const [first] = perSync;
  if (perSync.every((list) => list.join("\n") === first.join("\n"))) return first.length ? [{ selector: ".blyrics-container", declarations: first }] : [];
  return SYNCS.map((sync, i) => ({ selector: `.blyrics-container[data-sync="${sync}"]`, declarations: perSync[i] })).filter((g) => g.declarations.length > 0);
}

// -- Which lines a selector picks ------------------------------------------

const STATE = /^\.blyrics--(?:active|animating)$/;
/** Elements of the page that are always above the lyrics. */
const PAGE = /^(?:\*|html|body|div|:root|ytmusic-app|ytmusic-app-layout|ytmusic-player-page|#layout|#content|#player-page|#side-panel|#tab-renderer|#blyrics-wrapper|\[page-type=["']?MUSIC_PAGE_TYPE_TRACK_LYRICS["']?\])$/;
/** What is never true of the lyrics at rest, so `:not()` of it always holds. */
const NOT_AT_REST = /^(?:\.blyrics-user-scrolling|:hover|:focus-within|\[data-sync=["']?none["']?\]|\[data-no-lyrics[^\]]*\]|\[data-loader-visible=["']?true["']?\]|\[data-layout[^\]]*\])$/;
/** States the renderer handles itself: the reader scrolling, unsynced lyrics, no lyrics. */
const RENDERER_STATE = /^(?:\.blyrics-user-scrolling|\[data-sync=["']?none["']?\]|\[data-no-lyrics[^\]]*\])$/;
/** What a line never is, or too few are to matter. */
const NOT_A_LINE = /^(?:p|:hover|:empty|\.blyrics-footer|\.blyrics-credits|\.blyrics-no-lyrics-button-container|\.blyrics--translated|\.blyrics--romanized|\.blyrics--instrumental|\[data-instrumental[^\]]*\])$/;
/** A rule that covers only some screens, views or lines, which a list for every line cannot say. */
const SCOPED = { scoped: true };

/** Whether the compound itself, not an argument of its `:not()` or `:has()`, is being hovered. */
function isHovered(compound) {
  return simples(compound).some((simple) => simple === ":hover" || argumentsOf(simple, "is")?.some(isHovered));
}

function withoutArguments(compound) {
  return simples(compound).filter((simple) => !simple.includes("(")).join("");
}

function isSung(compound) {
  return simples(compound).some((simple) => STATE.test(simple));
}

function isPlainLine(compound) {
  return simples(compound).every((simple) => STATE.test(simple) || /^(?:div|\*|\.blyrics--line)$/.test(simple));
}

const SYNC = /^\[data-sync=["']?([\w-]+)["']?\]$/;

/** Whether a container compound can hold for a song of this sync type. */
function syncHolds(compound, sync) {
  return simples(compound).every((simple) => {
    const own = SYNC.exec(simple);
    if (own) return own[1] === sync;
    return !(argumentsOf(simple, "not") ?? []).some((arg) => SYNC.exec(arg)?.[1] === sync);
  });
}

/** The sync type a selector's container asks for, "" for any; null when it is for none the lists cover. */
function syncOf(selector) {
  const asked = compounds(selector).flatMap((part) => simples(part.compound).map((simple) => SYNC.exec(simple)?.[1]).filter(Boolean));
  if (asked.length === 0) return "";
  return asked.every((sync) => sync === asked[0]) && SYNCS.includes(asked[0]) ? asked[0] : null;
}

/** Whether a container compound holds for every song at rest, once its `[data-sync]` holds. */
function isContainerAtRest(compound) {
  return simples(compound).every((simple) => {
    if (/^(?:div|\.blyrics-container|\[data-sync\]|\[data-loader-visible=["']?false["']?\])$/.test(simple) || SYNC.test(simple)) return true;
    const not = argumentsOf(simple, "not");
    if (not) return not.flatMap((arg) => expandIs(arg)).every((arg) => compounds(arg).length === 1 && simples(arg).some((s) => NOT_AT_REST.test(s) || SYNC.test(s)));
    return argumentsOf(simple, "has")?.some((arg) => {
      const parts = compounds(arg);
      return parts.length === 1 && parts[0].combinator !== "+" && parts[0].combinator !== "~" && isSung(arg) && isPlainLine(arg);
    }) ?? false;
  });
}

/** What a line compound asks of its line, or null when only some lines would pass. */
function lineConditions(compound) {
  const out = { sung: false, notSung: false, notBefore: false, notAfter: false, before: null };
  for (const simple of simples(compound)) {
    if (STATE.test(simple)) out.sung = true;
    else if (/^(?:div|\*|\.blyrics--line|\[data-line-number\])$/.test(simple)) continue;
    else if (simple.startsWith(":not(")) {
      for (const arg of argumentsOf(simple, "not").flatMap((a) => expandIs(a))) {
        const parts = compounds(arg);
        const own = simples(arg);
        if (parts.length === 1 && own.some((s) => NOT_A_LINE.test(s))) continue;
        if (parts.length === 1 && isSung(arg) && isPlainLine(arg)) out.notSung = true;
        else if (parts.length === 2 && parts[1].combinator === "~" && isSung(parts[0].compound) && parts.every((p) => isPlainLine(p.compound))) out.notAfter = true;
        else if (own.length === 1 && own[0].startsWith(":has(")) {
          const chain = beforeChain(own[0]);
          if (!chain || chain[0] !== 1 || chain[1] !== Infinity) return null;
          out.notBefore = true;
        } else return null;
      }
    } else if (simple.startsWith(":has(") && !out.before) {
      out.before = beforeChain(simple);
      if (!out.before) return null;
    } else return null;
  }
  return out;
}

/** The distances before the sung line that `:has(+ … + .blyrics--active)` picks, or null. */
function beforeChain(simple) {
  const alternatives = argumentsOf(simple, "has").flatMap((arg) => expandIs(arg));
  let range = null;
  for (const arg of alternatives) {
    const parts = compounds(arg);
    const siblings = parts.every((p) => (p.combinator === "+" || p.combinator === "~") && isPlainLine(p.compound));
    if (!siblings || !isSung(parts[parts.length - 1].compound)) return null;
    const found = [parts.length, parts.some((p) => p.combinator === "~") ? Infinity : parts.length];
    if (range && (range[0] !== found[0] || range[1] !== found[1])) return null;
    range = found;
  }
  return range;
}

/**
 * The lines a selector picks relative to the sung line in a song of this sync type, as distance
 * ranges on each side (0 is the sung line itself); SCOPED when it picks only some; null when it is
 * no rule about lines at rest in such a song.
 */
function lineRole(selector, sync) {
  const parts = compounds(selector);
  if (parts.length === 0) return null;
  const all = parts.map((part) => simples(part.compound));
  const subject = all[all.length - 1];
  if (subject.some((s) => /^::?(?:before|after)$/.test(s) || s.startsWith("::"))) return null;

  // A line is `.blyrics--line`, a child of the container, or a sibling of either.
  let first = parts.length - 1;
  while (first > 0 && (parts[first].combinator === "+" || parts[first].combinator === "~")) first--;
  const lineish =
    all[first].some((s) => s === ".blyrics--line" || STATE.test(s)) ||
    (first > 0 && parts[first].combinator === ">" && all[first - 1].includes(".blyrics-container"));
  const isLine = subject.includes(".blyrics--line") || (/^(?:div|\*|:|\.blyrics--(?:active|animating)|\[)/.test(subject[0]) && lineish);
  if (!isLine) return null;
  // The footer, the loader and the credits sit beside the lines.
  if (subject.some((s) => s.startsWith(".blyrics") && !/^\.blyrics--(?:line|active|animating|paused|instrumental)$/.test(s))) return null;

  if (all.flat().some((s) => RENDERER_STATE.test(s))) return null;
  if (parts.some((part) => isHovered(part.compound))) return null;

  for (let i = 0; i < first; i++) {
    if (all[i].includes(".blyrics-container") && !syncHolds(parts[i].compound, sync)) return null;
  }
  for (let i = 0; i < first; i++) {
    if (parts[i].combinator === "+" || parts[i].combinator === "~") return SCOPED;
    const fits = all[i].includes(".blyrics-container") ? isContainerAtRest(parts[i].compound) : all[i].every((s) => PAGE.test(s));
    if (!fits) return SCOPED;
  }
  const chain = parts.slice(first).map((part) => ({ ...part, ...lineConditions(part.compound) }));
  if (chain.some((part) => part.sung === undefined)) return SCOPED;
  const last = chain[chain.length - 1];

  if (last.sung) return chain.length > 1 || last.before || last.notSung ? SCOPED : { before: [0, 0], after: [0, 0] };
  if (chain.length > 1) {
    // The sung line, then siblings down to this one: each step is at least a line further.
    if (!chain[0].sung || chain[0].notSung || chain[0].before || chain.slice(1).some((part) => part.sung || part.before)) return SCOPED;
    const steps = chain.length - 1;
    const open = chain.slice(1).some((part) => part.combinator === "~");
    return last.notAfter ? SCOPED : { before: null, after: [steps, open ? Infinity : steps] };
  }
  if (last.before) return last.notBefore ? SCOPED : { before: last.before, after: null };
  // Every line, or every line but the sung one, or but those on one side of it.
  const from = last.notSung ? 1 : 0;
  return { before: last.notBefore ? null : [from, Infinity], after: last.notAfter ? null : [from, Infinity] };
}

/**
 * The selector without the `:hover` on its subject, when that is a line, or null. The container is
 * hovered whenever a line is, so a `:hover` on it says nothing more.
 */
function hoveredLine(selector) {
  const parts = compounds(selector).map((part, i, all) => {
    const own = simples(part.compound);
    return i < all.length - 1 && own.includes(".blyrics-container") ? { ...part, compound: own.filter((s) => s !== ":hover").join("") } : part;
  });
  if (parts.length === 0 || parts.slice(0, -1).some((part) => isHovered(part.compound))) return null;
  const subject = simples(parts[parts.length - 1].compound);
  if (!subject.includes(":hover")) return null;
  const rest = subject.filter((s) => s !== ":hover").join("") || "*";
  const without = joinCompounds([...parts.slice(0, -1), { combinator: parts[parts.length - 1].combinator, compound: rest }]);
  return SYNCS.some((sync) => lineRole(without, sync)) ? without : null;
}

function joinCompounds(parts) {
  return parts.map((part) => `${part.combinator} ${part.compound}`.trim()).join(" ");
}

// -- The cascade on lines --------------------------------------------------

/**
 * Every opacity, filter and scale a rule gives lines in a song of this sync type, with where it
 * applies and what it weighs.
 */
function lineCandidates(rules, customs, sync, review) {
  const out = { opacity: [], blur: [], saturate: [], brightness: [], scale: [], visibility: [], "pointer-events": [] };
  let order = 0;
  for (const { selector, conditional, declarations } of rules) {
    for (const [property, raw, important] of declarations) {
      order++;
      const kinds = PROPERTY_KINDS[property];
      if (!kinds) continue;
      const hit = property === "visibility" || property === "pointer-events"; // whether a line can be hovered at all
      const value = resolve(raw, customs);
      for (const original of splitTopLevel(selector, ",").map((s) => s.trim())) {
        for (const one of expandIs(original)) {
          const hovered = hoveredLine(one);
          if (hit && hovered) continue;
          // At rest the renderer scales lines itself; only a transform that beats a hover matters.
          if (kinds[0] === "scale" && !hovered && !important) continue;
          const role = lineRole(hovered ?? one, sync);
          if (!role) continue;
          if (role.scoped || conditional) {
            if (!hit && (kinds[0] !== "scale" || hovered)) {
              review(
                "These opacity, filter or hover rules apply to only some screens, views or lines, so they were left out of the generated values, which apply to every line. Set the variables under a selector or media query of your own if they matter.",
                original
              );
            }
            continue;
          }
          for (const kind of kinds) {
            const parsed = hit ? value : kind === "scale" ? (property === "scale" ? parseScaleNumber(value) : parseScale(value)) : KINDS[kind].parse(value);
            out[kind].push({ ...role, hovered: !!hovered, value: parsed, raw: `${property}: ${raw}`, selector: original, important, specificity: specificity(original), order });
          }
        }
      }
    }
  }
  return out;
}

function winner(candidates) {
  let best = null;
  for (const c of candidates) {
    if (!best || (c.important !== best.important ? c.important : compareSpecificity(c.specificity, best.specificity) >= 0)) best = c;
  }
  return best;
}

/** The winning candidate (null for none) for the sung line, then 1, 2, 3... lines to one side. */
function cascade(candidates, side, reach) {
  const out = [];
  for (let d = 0; d <= reach; d++) out.push(winner(candidates.filter((c) => c[side] && d >= c[side][0] && d <= c[side][1])));
  return out;
}

/** One past the furthest distance any candidate tells apart. */
function reachOf(candidates) {
  const edges = candidates.flatMap((c) => [c.before, c.after].filter(Boolean).flatMap(([from, to]) => [from, to === Infinity ? from : to]));
  return Math.max(0, ...edges) + 1;
}

function distanceLists(candidates, authored, review) {
  const lists = {};
  for (const [kind, { rest }] of Object.entries(KINDS)) {
    const resting = candidates[kind].filter((c) => !c.hovered);
    if (resting.length === 0) continue;
    const reach = reachOf(resting);
    const won = { before: cascade(resting, "before", reach), after: cascade(resting, "after", reach) };
    const unreadable = [...won.before, ...won.after].find((c) => c && c.value === null);
    if (unreadable) {
      const lists = KINDS[kind].property === "filter" ? "--blyrics-line-blur, -saturate or -brightness list" : `--blyrics-line-${kind} list`;
      review(`Could not read \`${unreadable.raw}\`, so no ${lists} was written; set it by hand.`, unreadable.selector);
      continue;
    }
    lists[kind] = {};
    for (const side of ["before", "after"]) lists[kind][side] = trimTail(won[side].map((c) => c?.value ?? rest));
  }

  if (lists.opacity) {
    // A sung line the rules make invisible means the theme shows lyrics some other way (through
    // per-word rules, say), which the renderer cannot draw; the lists would only hide everything.
    if (Number(lists.opacity.after[0]) < 0.05) {
      review("This theme's line rules leave even the sung line transparent, so it shows lyrics through per-word or other rules the WebGL renderer does not draw. No distance lists were written: decide how lines should look with `--blyrics-line-opacity` / `--blyrics-line-blur` by hand.");
      return [];
    }
    // Past the point where lines are fully transparent, their filters do not matter.
    for (const side of ["before", "after"]) {
      const { [side]: opacity } = lists.opacity;
      if (opacity[opacity.length - 1] !== "0") continue;
      for (const kind of ["blur", "saturate", "brightness"]) {
        if (lists[kind]) lists[kind][side] = trimTail(lists[kind][side].slice(0, opacity.length - 1));
      }
    }
  }

  const out = [];
  for (const [kind, { before, after }] of Object.entries(lists)) {
    const name = `--blyrics-line-${kind}`;
    const plain = (list) => list.length === 1 && list[0] === KINDS[kind].rest;
    if (plain(before) && plain(after)) continue;
    if ([name, `${name}-before`, `${name}-after`].some((n) => authored.has(n))) {
      review(`The theme already sets ${name} lists, so they were left as written.`);
    } else if (before.join(" ") === after.join(" ")) {
      out.push(`${name}: ${after.join(" ")};`);
    } else {
      if (!plain(before)) out.push(`${name}-before: ${before.join(" ")};`);
      if (!plain(after)) out.push(`${name}-after: ${after.join(" ")};`);
    }
  }
  return out;
}

/** A hover value is written when a hovered line ends up the same wherever it is. */
function hoverValues(candidates, authored, review) {
  const out = [];
  for (const kind of ["opacity", "blur", "scale"]) {
    const all = candidates[kind];
    if (!all.some((c) => c.hovered)) continue;
    const reach = reachOf(all);
    const won = [...cascade(all, "before", reach), ...cascade(all, "after", reach)];
    if (!won.some((c) => c?.hovered)) continue; // It never wins, so it does nothing today.
    const name = `--blyrics-line-hover-${kind}`;
    if (authored.has(name)) {
      review(`The theme already sets ${name}, so it was left as written.`);
      continue;
    }
    // With no rule, opacity and blur are what they are at rest; scale is the renderer's own.
    const values = new Set(won.map((c) => (c ? c.value : (KINDS[kind]?.rest ?? null))));
    const [value] = values;
    if (values.size === 1 && value !== null) {
      if (kind === "opacity" && value !== "0" && someLinesCannotBeHovered(candidates)) {
        review(`The theme hides some lines from the mouse with visibility or pointer-events, and ${name} would show those when hovered, so it was not written; set it by hand if that is fine.`);
        continue;
      }
      out.push(`${name}: ${value};`);
    } else {
      review(`The theme's hover ${kind} differs from line to line or could not be read, and ${name} applies to whichever line is hovered, so it was not written; set it by hand.`, all.find((c) => c.hovered).selector);
    }
  }
  return out;
}

function someLinesCannotBeHovered(candidates) {
  for (const [kind, hidden] of [["visibility", /^(?:hidden|collapse)$/], ["pointer-events", /^none$/]]) {
    const set = candidates[kind];
    if (set.length === 0) continue;
    const reach = reachOf(set);
    if ([...cascade(set, "before", reach), ...cascade(set, "after", reach)].some((c) => c && hidden.test(c.value))) return true;
  }
  return false;
}

function trimTail(list) {
  const out = [...list];
  while (out.length > 1 && out[out.length - 1] === out[out.length - 2]) out.pop();
  return out;
}

// -- The other lines while the reader browses -------------------------------

/**
 * `--blyrics-line-opacity-browsing`, from a rule for the lines other than the sung and hovered ones
 * while the mouse is over the lyrics or the reader scrolls.
 */
function browsingValue(rules, customs, sync, candidates, authored, review, cover) {
  const found = [];
  let order = 0;
  for (const { selector, conditional, declarations } of rules) {
    for (const [property, raw, important] of declarations) {
      order++;
      if (property !== "opacity") continue;
      for (const original of splitTopLevel(selector, ",").map((s) => s.trim())) {
        const alternatives = expandIs(original).map((one) => browsedLines(one, sync));
        if (!alternatives.includes(true) || alternatives.includes(false)) continue;
        cover(original, property);
        if (conditional) {
          review("This rule for the other lines while the mouse is over the lyrics applies to only some screens, so --blyrics-line-opacity-browsing was not written for it. Set it under a media query of your own if it matters.", original);
          continue;
        }
        found.push({ value: parseOpacity(resolve(raw, customs)), raw: `${property}: ${raw}`, selector: original, important, specificity: specificity(original), order });
      }
    }
  }
  if (found.length === 0) return [];
  const name = "--blyrics-line-opacity-browsing";
  const won = winner(found);
  if (authored.has(name)) {
    review(`The theme already sets ${name}, so it was left as written.`);
    return [];
  }
  if (won.value === null) {
    review(`Could not read \`${won.raw}\`, so ${name} was not written; set it by hand.`, won.selector);
    return [];
  }
  // A line rule that outweighs it on some lines keeps those lines as they are in the theme.
  const others = candidates.opacity.filter((c) => !c.hovered && [c.before, c.after].some((range) => range && range[1] >= 1));
  const beaten = others.find((c) => c.important !== won.important ? c.important : compareSpecificity(c.specificity, won.specificity) > 0 || (compareSpecificity(c.specificity, won.specificity) === 0 && c.order > won.order));
  if (beaten) {
    review(`Other line rules outweigh the theme's rule for the lines while the mouse is over the lyrics on some lines, and ${name} applies to every line but the sung and hovered ones, so it was not written; set it by hand.`, won.selector);
    return [];
  }
  return [`${name}: ${won.value};`];
}

/**
 * Whether a selector picks every line but the sung and hovered ones while the container is hovered
 * or scrolled: true or false, or null when its container is for the other sync type.
 */
function browsedLines(selector, sync) {
  const parts = compounds(selector);
  if (parts.length < 2) return false;
  const subject = parts[parts.length - 1];
  const container = parts[parts.length - 2];
  const own = simples(container.compound);
  if (!own.includes(".blyrics-container") || !own.some((s) => s === ":hover" || s === ".blyrics-user-scrolling")) return false;
  if (!parts.slice(0, -2).every((part) => simples(part.compound).every((s) => PAGE.test(s)))) return false;
  if (!syncHolds(container.compound, sync)) return null;
  if (!isContainerAtRest(own.filter((s) => s !== ":hover" && s !== ".blyrics-user-scrolling").join(""))) return false;
  const line = simples(subject.compound);
  if (subject.combinator !== ">" && !line.includes(".blyrics--line")) return false;
  // `:not(:hover)` passes lineConditions, which leaves out lines that are never hovered at rest.
  if (!line.some((s) => argumentsOf(s, "not")?.includes(":hover"))) return false;
  const conditions = lineConditions(subject.compound);
  return !!conditions && conditions.notSung && !conditions.sung && !conditions.before && !conditions.notBefore && !conditions.notAfter;
}

// -- Words ----------------------------------------------------------------

const WORD_STATE = /^\[data-word-state=["']?(\w+)["']?\]$/;
/** A line none of whose words is still to come: Spicy for YTM's background line once sung. */
const ALL_WORDS_PAST = /^:not\(:has\(\.blyrics--word:not\(\[data-word-state=["']?past["']?\]\)\)\)$/;
const NOT_UPCOMING = /^:not\(\[data-word-state=["']?upcoming["']?\]\)$/;

/**
 * The selector for the words a word rule picks, without the line and word states the renderer
 * applies itself, and the word state it asked for ("" for none, "sung" for active or past); null
 * when it picks words by more than that.
 */
function wordScope(selector) {
  const parts = compounds(selector);
  if (parts.length === 0) return null;
  let state = "";
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const subject = i === parts.length - 1;
    // A sibling of the sung line is a line around it, which the renderer's word states do not know.
    if (parts[i].combinator === "+" || parts[i].combinator === "~") return null;
    if (!subject && simples(parts[i].compound).includes(".blyrics-container") && isContainerAtRest(parts[i].compound)) {
      out.push({ ...parts[i], compound: withoutRestingState(parts[i].compound) });
      continue;
    }
    const kept = [];
    for (const simple of simples(parts[i].compound)) {
      const asked = WORD_STATE.exec(simple)?.[1] ?? (ALL_WORDS_PAST.test(simple) ? "past" : NOT_UPCOMING.test(simple) || (subject && simple === ".blyrics--animating") ? "sung" : null);
      if (subject && asked) {
        if (state) return null;
        state = asked;
        continue;
      }
      // The line being sung, which is where the renderer applies these, or it and the lines after it.
      if (!subject && (STATE.test(simple) || (simple.startsWith(":has(") && /data-word-state|blyrics--(?:active|animating)/.test(simple)) || isSungOrAfter(simple))) continue;
      if (STATEFUL.test(simple) || /^::?(?:before|after)$|^::/.test(simple)) return null;
      kept.push(simple);
    }
    out.push({ combinator: parts[i].combinator, compound: kept.join("") || ".blyrics--line" });
  }
  return { selector: plainSelector(joinCompounds(out)), state };
}

/** Whether an `:is()` picks the sung line and maybe lines after it: `:is(.blyrics--active, .blyrics--active + .blyrics--line)`. */
function isSungOrAfter(simple) {
  const args = argumentsOf(simple, "is") ?? argumentsOf(simple, "where");
  if (!args?.some((arg) => STATE.test(arg))) return false;
  return args.every((arg) => {
    const parts = compounds(arg);
    return isSung(parts[0].compound) && isPlainLine(parts[0].compound) && parts.slice(1).every((p) => (p.combinator === "+" || p.combinator === "~") && isPlainLine(p.compound));
  });
}

/**
 * `selector` without the old engine's `span` between a line and its words, which matches nothing
 * now: `.blyrics--line > span > .blyrics--word` meant every word.
 */
function plainSelector(selector) {
  const parts = compounds(selector);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (i < parts.length - 1 && i > 0 && parts[i].compound === "span") {
      parts[i + 1] = { ...parts[i + 1], combinator: " " };
      continue;
    }
    out.push(parts[i]);
  }
  return joinCompounds(out);
}

/** The custom properties a theme sets on the line being sung, over those the container inherits. */
function sungLineCustoms(rules, base, sync) {
  const out = new Map(base);
  for (const { selector, conditional, declarations } of rules) {
    if (conditional || !splitTopLevel(selector, ",").some((one) => isSungLine(one.trim(), sync))) continue;
    for (const [name, value] of declarations) if (name.startsWith("--")) out.set(name, value);
  }
  return out;
}

function isSungLine(selector, sync) {
  const parts = compounds(selector);
  const last = parts[parts.length - 1];
  const own = simples(last?.compound ?? "");
  if (!last || last.combinator === "+" || last.combinator === "~") return false;
  if (!own.some((s) => STATE.test(s)) || !own.every((s) => STATE.test(s) || /^(?:div|\.blyrics--line)$/.test(s) || s.startsWith(":has("))) return false;
  return parts.slice(0, -1).every((part) => {
    const container = simples(part.compound);
    return container.includes(".blyrics-container") ? syncHolds(part.compound, sync) && isContainerAtRest(part.compound) : container.every((s) => PAGE.test(s));
  });
}

/**
 * A word's opacity once sung and its pose until sung, under the theme's word selectors; and the
 * rise from that pose, read from the container.
 */
function wordValues(rules, customs, authored, review, cover) {
  const sung = Object.fromEntries(SYNCS.map((sync) => [sync, sungLineCustoms(rules, customs[sync], sync)]));
  /** A value as every song the selector is for resolves it, or null. */
  const valueFor = (selector, raw, parse, within = customs) => {
    const sync = syncOf(selector);
    if (sync === null) return null;
    const values = new Set((sync ? [sync] : SYNCS).map((s) => parse(resolve(raw, within[s]))));
    return values.size === 1 ? [...values][0] : null;
  };
  const past = [];
  const poses = [];
  const rises = [];
  let moves = false;
  for (const { selector, conditional, declarations } of rules) {
    const own = Object.fromEntries(declarations.map(([property, value, important]) => [property, { value, important }]));
    for (const original of splitTopLevel(selector, ",").map((s) => s.trim())) {
      for (const one of expandIs(original)) {
        // Unsynced lyrics have no sung words.
        const scope = syncOf(one) === null ? null : wordScope(one);
        if (!scope) continue;
        const subject = simples(lastCompound(scope.selector));
        const word = subject.includes(".blyrics--word") || subject.includes(".blyrics-line-synced-word");
        // Past words, in the line being sung.
        if (own.opacity && scope.state === "past" && (word || /^\.blyrics-(?:background-line|word-group|line-main)$/.test(subject[0]))) {
          cover(original, "opacity");
          if (conditional) {
            review("This rule for sung words applies to only some screens, so --blyrics-word-past-opacity was not written for it. Set it under a media query of your own if it matters.", original);
            continue;
          }
          past.push({ selector: scope.selector, important: own.opacity.important, raw: `opacity: ${own.opacity.value}`, original, value: valueFor(one, own.opacity.value, parseOpacity, sung) });
        }
        if (!word) continue;
        // Sung words going back to where they belong, by a still transform or an animation.
        if (scope.state === "sung" || scope.state === "active" || scope.state === "past") {
          const still = ["transform", "translate", "scale"].filter((p) => own[p]);
          if (still.length && still.every((p) => (p === "transform" ? isStill(parseMotion(own[p].value) ?? "x(1)") : /^(?:none|0|1|0 0|1 1)$/.test(own[p].value)))) {
            moves = true;
            for (const p of still) cover(original, p);
          } else if ((own.animation && own.animation.value !== "none") || (own["animation-name"] && own["animation-name"].value !== "none")) {
            moves = true;
          }
          continue;
        }
        // Words waiting to be sung.
        if (scope.state !== "" && scope.state !== "upcoming") continue;
        if (!own.transform && !own.translate && !own.scale) continue;
        const raw = [own.translate && `translate: ${own.translate.value}`, own.scale && `scale: ${own.scale.value}`, own.transform && `transform: ${own.transform.value}`].filter(Boolean).join("; ");
        const value = valueFor(one, raw, (resolved) => {
          const props = Object.fromEntries(resolved.split(/;\s*/).map((d) => [d.slice(0, d.indexOf(":")), d.slice(d.indexOf(":") + 1).trim()]));
          const transform = props.transform ? parseMotion(props.transform) : "";
          const individual = [props.translate, props.scale].every((v) => v === undefined || v === "none" || v.split(/\s+/).every((arg) => MOTION_LENGTH.test(arg) || MOTION_NUMBER.test(arg)))
            ? individualTransforms(props.translate, props.scale)
            : null;
          if (transform === null || individual === null) return null;
          const pose = [individual, transform === "none" ? "" : transform].filter(Boolean).join(" ") || "none";
          return pose.replace(/(?<![\w.])-?(?:\d+(?:\.\d+)?|\.\d+)/g, (n) => trimNumber(Number(n)));
        });
        poses.push({ selector: scope.selector, important: [own.transform, own.translate, own.scale].some((d) => d?.important), value, raw, original, conditional, properties: ["transform", "translate", "scale"].filter((p) => own[p]) });
        if (own.transition) rises.push({ value: own.transition.value, original });
      }
    }
  }

  const groups = [];
  const themeWide = [];
  const write = (name, found, describe) => {
    if (found.length === 0) return;
    if (authored.has(name)) {
      review(`The theme already sets ${name}, so it was left as written.`);
      return;
    }
    const unreadable = found.find((f) => f.value === null);
    if (unreadable) {
      review(`Could not read \`${unreadable.raw}\` for ${describe}, so ${name} was not written; set it by hand.`, unreadable.original);
      return;
    }
    for (const f of found) groups.push({ selector: f.selector, declarations: [`${name}: ${f.value}${f.important ? " !important" : ""};`] });
  };
  // Sung words that stay as they are need nothing.
  if (past.some((p) => p.value !== "1")) write("--blyrics-word-past-opacity", dedupe(past), "the sung words");

  // A pose only means something when the theme moves the words out of it as they are sung.
  const posed = poses.filter((p) => !p.conditional);
  if (moves && posed.some((p) => p.value === null || !isStill(p.value))) {
    for (const p of poses) {
      for (const property of p.properties) cover(p.original, property);
      if (p.conditional) review("This rule for words waiting to be sung applies to only some screens, so --blyrics-word-rest-transform was not written for it. Set it under a media query of your own if it matters.", p.original);
    }
    const before = groups.length;
    write("--blyrics-word-rest-transform", dedupe(posed), "the words waiting to be sung");
    if (groups.length > before) themeWide.push(...riseValues(rises, cover));
  }
  return { groups, themeWide };
}

/** One entry per selector, the last of each, in the order the cascade would meet them. */
function dedupe(found) {
  const out = [];
  for (const f of found) {
    const at = out.findIndex((o) => o.selector === f.selector && o.important === f.important);
    if (at >= 0) out.splice(at, 1);
    out.push(f);
  }
  return out;
}

/**
 * `--blyrics-word-rise-extra-duration` and `--blyrics-word-rise-easing` from the transitions that
 * raise the words: `transform calc(var(--blyrics-duration) + 200ms) ease` is the renderer's own.
 */
function riseValues(rises, cover) {
  const extras = new Set();
  const easings = new Set();
  for (const { value, original } of rises) {
    const transition = splitTopLevel(value, ",").map((t) => t.trim()).find((t) => /^(?:transform|all)\b/.test(t));
    if (!transition) continue;
    const parts = splitTopLevel(transition, " ").map((t) => t.trim()).filter(Boolean);
    const m = /^calc\(\s*var\(\s*--blyrics-duration\b[^)]*\)\s*\+\s*(\d+(?:\.\d+)?)(ms|s)\s*\)$/.exec(parts[1] ?? "");
    if (!m) continue;
    extras.add(m[2] === "s" ? Number(m[1]) : Number(m[1]) / 1000);
    const easing = parts.slice(2).find((t) => /^(?:ease|ease-in|ease-out|ease-in-out|linear|cubic-bezier\(.*\)|steps\(.*\))$/.test(t));
    easings.add(easing ?? "ease");
    cover(original, "transition");
  }
  const out = [];
  if (extras.size === 1 && [...extras][0] !== 0.2) out.push(`--blyrics-word-rise-extra-duration: ${trimNumber([...extras][0])}s;`);
  if (easings.size === 1 && [...easings][0] !== "ease") out.push(`--blyrics-word-rise-easing: ${[...easings][0]};`);
  return out;
}

// -- Shadows and the sweep overlay's variables ----------------------------

/**
 * Whether a selector depends on state the renderer applies itself. A container that always holds
 * while a song plays, such as `.blyrics-container:has(.blyrics--active)`, does not.
 */
function isStateful(selector) {
  return STATEFUL.test(withoutRestingState(selector));
}

/**
 * `selector` with what a container compound asks that always holds while a song plays taken out:
 * `.blyrics-container:has(.blyrics--active)` is `.blyrics-container`. The renderer's own elements
 * never carry the state classes, so a selector that kept them would match nothing there.
 */
function withoutRestingState(selector) {
  const parts = compounds(selector).map((part) => {
    const own = simples(part.compound);
    if (!own.includes(".blyrics-container") || !isContainerAtRest(part.compound)) return part;
    const kept = own.filter((s) => s === ".blyrics-container" || s === "div" || SYNC.test(s) || (argumentsOf(s, "not") ?? [""]).every((arg) => SYNC.test(arg)));
    return { ...part, compound: kept.join("") };
  });
  return joinCompounds(parts);
}

const STATE_SHADOW = "A text shadow that changes when a line or word is sung or hovered does not show: the WebGL renderer draws `--blyrics-text-shadow` the same in every state.";

/** Elements whose text the renderer draws, which a text shadow reaches. */
const SHADOWED = /^(?:\.blyrics--(?:line|word|translated|romanized)|\.blyrics-(?:container|line-main|bidi-run|word-group|background-line|background-lyric|content-line|line-synced-word))$/;
/** The DOM renderer's copy of the text for the sweep, which the WebGL renderer does not draw. */
const OVERLAY = /^\.blyrics-(?:highlight-run|word-highlight|sweep-text)$/;

/** `--blyrics-text-shadow` from each static `text-shadow` on lyric text, under the same selector. */
function textShadows(rules, authored, review, unsupported, cover) {
  const out = [];
  const name = "--blyrics-text-shadow";
  for (const { selector, conditional, declarations } of rules) {
    for (const [property, raw, important] of declarations) {
      if (property !== "text-shadow") continue;
      for (const original of splitTopLevel(selector, ",").map((s) => s.trim())) {
        const parts = compounds(original);
        const subject = simples(parts[parts.length - 1]?.compound ?? "");
        if (subject.some((s) => /^::?(?:before|after)$|^::/.test(s))) continue;
        // The sweep's copy of the text is not drawn, so neither is its shadow; one that changes with
        // state is reported with the others that do.
        if (parts.some((part) => simples(part.compound).some((s) => OVERLAY.test(s)))) {
          if (raw === "none" || isStateful(original)) cover(original, property);
          if (raw !== "none" && isStateful(original)) unsupported.push({ line: original, code: "state-shadow", message: STATE_SHADOW });
          continue;
        }
        const line = parts.length > 1 && parts[parts.length - 1].combinator === ">" && simples(parts[parts.length - 2].compound).includes(".blyrics-container");
        if (!subject.some((s) => SHADOWED.test(s)) && !line) continue;
        cover(original, property);
        if (isStateful(original)) {
          unsupported.push({ line: original, code: "state-shadow", message: STATE_SHADOW });
        } else if (conditional) {
          review(`This text shadow applies to only some screens, so ${name} was not written for it. Set it under a media query of your own if it matters.`, original);
        } else if (authored.has(name)) {
          review(`The theme already sets ${name}, so it was left as written.`);
        } else {
          out.push({ selector: plainSelector(withoutRestingState(original)), declarations: [`${name}: ${raw}${important ? " !important" : ""};`] });
        }
      }
    }
  }
  return out;
}

/**
 * `--blyrics-*` variables a theme set on `.blyrics--word::after`, the DOM renderer's sweep overlay,
 * copied onto the word, where the WebGL renderer reads them. The copies also reach the long-word
 * `.blyrics-word-highlight`, which is what the old engine's flag about them asked for.
 */
function pseudoVariables(rules, review) {
  const groups = [];
  let skipped = false;
  for (const { selector, conditional, declarations } of rules) {
    const variables = declarations.filter(([name]) => name.startsWith("--blyrics-"));
    if (variables.length === 0) continue;
    for (const original of splitTopLevel(selector, ",").map((s) => s.trim())) {
      const parts = compounds(original);
      const own = simples(parts[parts.length - 1]?.compound ?? "");
      if (!own.some((s) => /^::?after$/.test(s)) || !own.some((s) => s === ".blyrics--word" || s === ".blyrics-line-synced-word")) continue;
      const target = joinCompounds([...parts.slice(0, -1), { ...parts[parts.length - 1], compound: own.filter((s) => !/^::?after$/.test(s)).join("") }]);
      if (conditional || isStateful(target)) {
        skipped = true;
        review("These variables are set on a word's `::after` only on some screens or in some state, so they were not copied onto the word, where the WebGL renderer reads them. Set them on `.blyrics--word` by hand if they matter.", original);
        continue;
      }
      groups.push({ selector: plainSelector(withoutRestingState(target)), declarations: variables.map(([name, value, important]) => `${name}: ${value}${important ? " !important" : ""};`) });
    }
  }
  return { groups, settles: groups.length > 0 && !skipped ? ["var-on-pseudo"] : [] };
}

// -- Values ----------------------------------------------------------------

/**
 * The theme's own custom properties as the container inherits them in a song of this sync type,
 * where they always hold.
 */
function customProperties(rules, sync) {
  const found = new Map();
  rules.forEach(({ selector, conditional, declarations }, order) => {
    if (conditional) return;
    for (const one of splitTopLevel(selector, ",").map((s) => s.trim())) {
      // The nearer element's value is the inherited one, whatever the specificity.
      const near = { ":root": 1, html: 1, body: 2, "*": 3 }[one] ?? (isContainer(one, sync) ? 3 : 0);
      if (!near) continue;
      for (const [name, value, important] of declarations) {
        if (!name.startsWith("--")) continue;
        const next = { value, near, important, specificity: specificity(one), order };
        const held = found.get(name);
        if (!held || near > held.near || (near === held.near && winner([held, next]) === next)) found.set(name, next);
      }
    }
  });
  return new Map([...found].map(([name, { value }]) => [name, value]));
}

/** Whether a selector picks the container itself, at rest, in a song of this sync type. */
function isContainer(selector, sync) {
  const parts = compounds(selector);
  const last = parts[parts.length - 1];
  if (!last || !simples(last.compound).includes(".blyrics-container")) return false;
  return syncHolds(last.compound, sync) && isContainerAtRest(last.compound) && parts.slice(0, -1).every((part) => simples(part.compound).every((s) => PAGE.test(s)));
}

/** `value` with the theme's custom properties filled in and `calc()` over plain numbers worked out. */
function resolve(value, customs) {
  let v = value;
  for (let depth = 0; depth < 8 && v.includes("var(") && v.length < 2000; depth++) {
    v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (m, name, fallback) => customs.get(name) ?? fallback?.trim() ?? m);
  }
  return evaluateCalc(v.trim());
}

/**
 * Each `calc()` in `text` that adds, subtracts, multiplies and divides numbers (or lengths of one
 * unit) replaced by its result. What it cannot work out is left as written.
 */
function evaluateCalc(text) {
  let out = text;
  for (let at = out.lastIndexOf("calc("); at >= 0; at = out.lastIndexOf("calc(", at - 1)) {
    if (at > 0 && /[\w-]/.test(out[at - 1])) continue;
    let depth = 0;
    let end = -1;
    for (let i = at + 4; i < out.length; i++) {
      if (out[i] === "(") depth++;
      else if (out[i] === ")" && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) break;
    const result = calcValue(out.slice(at + 5, end));
    if (result !== null) out = `${out.slice(0, at)}${result}${out.slice(end + 1)}`;
    if (at === 0) break;
  }
  return out;
}

function calcValue(expression) {
  const tokens = expression.match(/[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?(?:[a-z]+|%)?|[-+*/()]|\S+/gi) ?? [];
  // A sign glued to a number is subtraction or addition when a value comes before it.
  for (let i = 1; i < tokens.length; i++) {
    if (/^[-+]\d|^[-+]\./.test(tokens[i]) && (/[\d%a-z)]$/i.test(tokens[i - 1]))) tokens.splice(i, 1, tokens[i][0], tokens[i].slice(1));
  }
  let i = 0;
  const number = (token) => {
    const m = /^([-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?)([a-z]+|%)?$/i.exec(token ?? "");
    return m ? { n: Number(m[1]), unit: m[2] ?? "" } : null;
  };
  const factor = () => {
    if (tokens[i] === "(") {
      i++;
      const inner = sum();
      if (tokens[i++] !== ")") return null;
      return inner;
    }
    return number(tokens[i++]);
  };
  const product = () => {
    let left = factor();
    while (left && (tokens[i] === "*" || tokens[i] === "/")) {
      const op = tokens[i++];
      const right = factor();
      if (!right) return null;
      if (op === "*" && left.unit && right.unit) return null;
      if (op === "/" && (right.unit || right.n === 0)) return null;
      left = op === "*" ? { n: left.n * right.n, unit: left.unit || right.unit } : { n: left.n / right.n, unit: left.unit };
    }
    return left;
  };
  const sum = () => {
    let left = product();
    while (left && (tokens[i] === "+" || tokens[i] === "-")) {
      const op = tokens[i++];
      const right = product();
      if (!right || left.unit !== right.unit) return null;
      left = { n: op === "+" ? left.n + right.n : left.n - right.n, unit: left.unit };
    }
    return left;
  };
  const result = sum();
  if (!result || i !== tokens.length || !Number.isFinite(result.n)) return null;
  return `${trimNumber(result.n)}${result.unit}`;
}

function parseOpacity(value) {
  const m = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(%?)$/.exec(value);
  return m ? trimNumber(Math.min(1, Math.max(0, Number(m[1]) / (m[2] ? 100 : 1)))) : null;
}

function parseBlur(value) {
  if (value === "none") return "0";
  if (/\b(?:var|calc|min|max|clamp)\(/.test(value)) return null;
  // A filter without a blur leaves the line sharp.
  if (!/\bblur\(/.test(value)) return /^[a-z-]+\(/.test(value) ? "0" : null;
  const m = /\bblur\(\s*(\d+(?:\.\d+)?|\.\d+)([a-z]*)\s*\)/.exec(value);
  if (!m) return /\bblur\(\s*\)/.test(value) ? "0" : null;
  const n = Number(m[1]);
  if (n === 0) return "0";
  // The renderer's lists take px and rem; an em blur depends on the line's font size.
  if (m[2] !== "px" && m[2] !== "rem") return null;
  return `${trimNumber(n)}${m[2]}`;
}

/** The amount of a `saturate()` or `brightness()` in a filter, as a number: 1 when it has none. */
function parseFilterAmount(value, name) {
  if (value === "none") return "1";
  if (/\b(?:var|calc|min|max|clamp)\(/.test(value) || !/^[a-z-]+\(/.test(value)) return null;
  const all = [...value.matchAll(new RegExp(`\\b${name}\\(\\s*([^()]*?)\\s*\\)`, "g"))];
  // Two of them multiply; one the lists can say, two are rare enough to leave.
  if (all.length > 1) return null;
  if (all.length === 0) return "1";
  const m = /^(\d+(?:\.\d+)?|\.\d+)(%?)$/.exec(all[0][1]);
  if (!all[0][1]) return "1";
  return m ? trimNumber(Number(m[1]) / (m[2] ? 100 : 1)) : null;
}

const MOTION_LENGTH = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|r?em)$|^-?0$/;
const MOTION_NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

/**
 * A transform the renderer's word poses take, translations in px or em and scales, as written;
 * "none" for none, null for anything else.
 */
function parseMotion(value) {
  if (value === "none") return "none";
  const functions = [...value.matchAll(/([a-zA-Z]+)\(([^()]*)\)/g)];
  if (functions.length === 0 || value.replace(/([a-zA-Z]+)\(([^()]*)\)/g, "").trim()) return null;
  for (const [, name, args] of functions) {
    const list = args.split(",").map((arg) => arg.trim());
    const fits = { translate: [MOTION_LENGTH, 2], translateX: [MOTION_LENGTH, 1], translateY: [MOTION_LENGTH, 1], scale: [MOTION_NUMBER, 2], scaleX: [MOTION_NUMBER, 1], scaleY: [MOTION_NUMBER, 1] }[name];
    if (!fits || list.length > fits[1] || !list.every((arg) => fits[0].test(arg))) return null;
  }
  return functions.map(([whole]) => whole.replace(/\s+/g, " ")).join(" ");
}

/** Whether a pose from parseMotion leaves the word where it is. */
function isStill(motion) {
  if (motion === "none") return true;
  return [...motion.matchAll(/([a-zA-Z]+)\(([^()]*)\)/g)].every(([, name, args]) =>
    args.split(",").every((arg) => Number.parseFloat(arg) === (name.startsWith("scale") ? 1 : 0))
  );
}

/** The `translate` and `scale` properties as transform functions, in the order they apply. */
function individualTransforms(translate, scale) {
  const out = [];
  if (translate && translate !== "none") {
    const [x, y = "0"] = translate.split(/\s+/);
    out.push(y === "0" ? `translateX(${x})` : x === "0" ? `translateY(${y})` : `translate(${x}, ${y})`);
  }
  if (scale && scale !== "none") {
    const [x, y = x] = scale.split(/\s+/);
    out.push(y === x ? `scale(${x})` : `scale(${x}, ${y})`);
  }
  return out.join(" ");
}

/** The uniform scale of a transform made only of `scale(n)`, `none` meaning 1. */
function parseScale(value) {
  if (value === "none") return "1";
  const m = /^scale\(\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
  if (!m || (m[2] !== undefined && m[2] !== m[1])) return null;
  return parseScaleNumber(m[1]);
}

function parseScaleNumber(value) {
  if (value === "none") return "1";
  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ? trimNumber(Number(value)) : null;
}

function trimNumber(n) {
  return String(Math.round(n * 1000) / 1000);
}

// -- Bookkeeping ----------------------------------------------------------

function lastCompound(selector) {
  const parts = compounds(selector);
  return parts.length ? parts[parts.length - 1].compound : "";
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

/** One entry per message, listing everywhere it applies: source lines (`L12`) or selectors. */
function group(items) {
  const byMessage = new Map();
  for (const item of items) {
    const entry = byMessage.get(item.message) ?? { code: item.code, message: item.message, where: [] };
    if (item.line && !entry.where.includes(item.line)) entry.where.push(item.line);
    byMessage.set(item.message, entry);
  }
  return [...byMessage.values()];
}
