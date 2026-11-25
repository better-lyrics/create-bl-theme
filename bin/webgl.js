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
// then 1, 2, 3... lines away. The hovered line and its colour, the other lines
// while the reader browses, a word's pose until it is sung, its opacity once
// sung, a static text shadow, the romanization's background, the instrumental
// icon and its pulse, and the no-lyrics message and its icon each have a
// variable too, and a cap on the letters of a held word has a comment setting.
// This pass reads the theme's rules and writes those, which the current DOM
// renderer ignores, so the theme keeps working on both.
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

import { argumentsOf, blankComments, compareSpecificity, compounds, expandIs, parseKeyframes, parseRules, simples, specificity, splitTopLevel } from "./css.js";

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
      "The WebGL renderer draws the instrumental note itself and does not read this variable. `--blyrics-instrumental-icon` picks the note, the dots or a character, and its colours follow the lyric colours; `--blyrics-instrumental-fill-fade-duration`, `--blyrics-instrumental-wave-oscillation-duration` and `--blyrics-animate-instrumental` still apply.",
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
  const keyframes = parseKeyframes(withoutBlock(css));

  // 1. What the renderer reads from the container, worked out for each sync type: the distance
  //    lists, the hovered line, the lines while browsing, the words' rise.
  const words = wordValues(rules, customs, authored, review, cover);
  const instrumental = instrumentalValues(rules, keyframes, authored, review, cover);
  const boxes = lineBoxes(rules, customs, authored, review, unsupported, cover);
  const perSync = SYNCS.map((sync) => {
    const candidates = lineCandidates(rules, customs[sync], sync, review);
    return [
      ...distanceLists(candidates, authored, review),
      ...hoverValues(candidates, authored, review),
      ...hoverColor(rules, customs[sync], sync, authored, review, unsupported, cover),
      ...hoverBoxes(rules, customs[sync], sync, boxes, authored, review, unsupported, cover),
      ...browsingValue(rules, customs[sync], sync, candidates, authored, review, cover),
      ...words.themeWide,
      ...instrumental,
    ];
  });

  // 2. What it reads from each element, under the theme's own selectors.
  const pseudo = pseudoVariables(rules, review);
  const noLyrics = noLyricsValues(rules, authored, review, cover);
  const settings = letterSettings(rules, keyframes, commentSettings(withoutBlock(css)), authored, review, cover);
  const groups = [
    ...withContainer(themeWide(perSync), noLyrics.container),
    ...words.groups,
    ...textShadows(rules, authored, review, unsupported, cover),
    ...romanizedBackgrounds(rules, authored, review, unsupported, cover),
    ...boxes.groups,
    ...pseudo.groups,
    ...noLyrics.groups,
  ];
  const { output, change } = withBlock(source, groups, settings);
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

    if (compounds(selector).some((part) => isHovered(part.compound)) && /^(?:opacity|filter|transform|scale|color|background|text-shadow|outline$|outline-color$|border$|border-color$|box-shadow$)/.test(property)) {
      if (/^(?:outline|outline-color|border|border-color|box-shadow)$/.test(property) && drawsNothing(value)) return;
      if (/^background/.test(property) && (drawsNothing(value) || backgroundFill(property, value) === "transparent")) return;
      const line_ = expandIs(selector).map(hoveredLine).find(Boolean);
      if (!line_) {
        unsupported.push({ line, code: "hover", message: "Hover effects other than on the hovered line itself and the opacity of the other lines (for example blurring the other lines while the mouse is over the lyrics) do not show in the WebGL renderer." });
      } else if (otherFilter || !/^(?:opacity|filter|transform|scale)$/.test(property)) {
        unsupported.push({ line, code: "hover", message: `\`${property}\` on a hovered line does not show. The line under the mouse can only change its opacity, blur, scale, the colour of its words before they are sung, its text shadow and the solid box behind it (\`--blyrics-line-hover-opacity\`, \`-blur\`, \`-scale\`, \`-color\`, \`-text-shadow\`, \`-bg-color\` and \`-border-color\`).` });
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
        flags.push({ line, code: "motion", message: "Animations and transitions on lyric elements do not run in the WebGL renderer; it times its own effects. Its timing variables are `--blyrics-scale-transition-duration`, `--blyrics-lyric-highlight-fade-in/out-duration`, `--blyrics-wobble-duration` (stretched with the word by `--blyrics-word-wobble-duration-ratio`, and per syllable with `--blyrics-word-wobble-scope: syllable`) and the easing variables beside them, which take `linear()` curves. A custom keyframe effect has no equivalent." });
        return;
      case "background":
      case "background-color":
        // What draws nothing is not lost.
        if (drawsNothing(value) || backgroundFill(property, value) === "transparent") return;
        unsupported.push({
          line,
          code: "paint",
          message: simples(lastCompound(selector)).includes(".blyrics--romanized")
            ? `\`${property}\` on romanizations is drawn only as a colour, from \`--blyrics-romanized-bg-color\` (the rounded box behind them); an image or gradient is not drawn by the WebGL renderer.`
            : `\`${property}\` on lyric elements is not drawn by the WebGL renderer ${PAINTS}.`,
        });
        return;
      case "box-shadow":
      case "-webkit-text-stroke":
      case "-webkit-text-stroke-width":
      case "-webkit-text-stroke-color":
      case "outline":
      case "border":
      case "border-color":
      case "background-image":
      case "background-clip":
      case "mix-blend-mode":
        if (drawsNothing(value)) return;
        unsupported.push({ line, code: "paint", message: `\`${property}\` on lyric elements is not drawn by the WebGL renderer ${PAINTS}.` });
        return;
      case "text-shadow":
        // What textShadows did not take: the sweep overlay's own shadow, or one on another element.
        if (value !== "none") unsupported.push({ line, code: "paint", message: "`text-shadow` here is not drawn by the WebGL renderer. It draws shadows under the text of lines, words, translations and romanizations only, from `--blyrics-text-shadow`, `--blyrics-active-text-shadow` (the sung line) and `--blyrics-line-hover-text-shadow` (the line under the mouse)." });
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

/**
 * `groups` is [{ selector, declarations }], in the order they are to be written; `settings` the
 * comment settings (`blyrics-key = value`) to write before them.
 */
function withBlock(source, groups, settings = []) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const existing = BLOCK.exec(source);
  const at = existing ? lineOf(source, existing.index) : 0;
  if (groups.length === 0 && settings.length === 0) {
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
    "   distance from the sung line, the line under the mouse takes the hover values, and words,",
    "   their shadows, the instrumental icon and the no-lyrics message take the variables below.",
    "   The current renderer ignores these and keeps using the rules. */",
    ...settings.map((setting) => `/* ${setting}; */`),
    ...groups.flatMap(({ selector, declarations }) => [`${selector} {`, ...declarations.map((d) => `  ${d}`), "}"]),
    BLOCK_END,
  ].join(newline);
  if (existing?.[0] === block) return { output: source, change: null };
  // In place, so what the author added after the block stays after it.
  const output = existing ? source.replace(BLOCK, () => block) : `${source.trimEnd()}${newline}${newline}${block}${newline}`;
  const names = [...new Set(groups.flatMap(({ declarations }) => declarations.map((d) => d.split(":")[0]).filter((name) => name.startsWith("--"))))];
  const and = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list.join(""));
  // Real properties, on the renderer's own elements: the no-lyrics icon and message.
  const styled = groups
    .map(({ selector, declarations }) => [selector, declarations.map((d) => d.split(":")[0]).filter((name) => !name.startsWith("--"))])
    .filter(([, properties]) => properties.length > 0)
    .map(([selector, properties]) => `${and(properties)} on \`${selector}\``);
  const hover = (name) => name.includes("-hover-") || name.endsWith("-browsing");
  const box = (name) => /^--blyrics-line-(?:hover-)?(?:bg|border)-/.test(name);
  const lines = names.some((name) => name.startsWith("--blyrics-line-") && !hover(name) && !box(name));
  const words = names.some((name) => name.startsWith("--blyrics-word-"));
  const instrumental = names.some((name) => name.startsWith("--blyrics-instrumental-"));
  const checks = [lines && "the fade", names.some(box) && "the boxes behind lines", names.some(hover) && "the hover", (words || settings.length > 0) && "the words", instrumental && "the instrumental icon"].filter(Boolean);
  const listed = [names.join(", "), settings.length && `the comment setting${settings.length > 1 ? "s" : ""} ${settings.map((setting) => `\`${setting}\``).join(", ")}`].filter(Boolean);
  return {
    output,
    change: {
      line: lineOf(output, output.indexOf(BLOCK_BEGIN)),
      code: "distance-lists",
      message:
        `${existing ? "Updated" : "Added"} ${and(listed)} from the theme's rules${styled.length ? `, and ${and(styled)}` : ""}.` +
        (checks.length ? ` Watch a synced song to check ${and(checks)} match.` : "") +
        (names.some((name) => name.startsWith("--blyrics-no-lyrics-")) ? " Open a song without lyrics to check the message." : ""),
    },
  };
}

/** `groups` with `declarations` added to its `.blyrics-container` group, which comes first. */
function withContainer(groups, declarations) {
  if (declarations.length === 0) return groups;
  const at = groups.findIndex((g) => g.selector === ".blyrics-container");
  if (at < 0) return [{ selector: ".blyrics-container", declarations }, ...groups];
  return groups.map((g, i) => (i === at ? { ...g, declarations: [...g.declarations, ...declarations] } : g));
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
const LAYOUT = /^\[data-(?:layout|no-lyrics)\b[^\]]*\]$/;

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

// -- The colour of the hovered line ----------------------------------------

/** What colours a hovered line's words before they are sung. */
const HOVER_COLOR = ["color", "-webkit-text-fill-color", "--blyrics-lyric-inactive-color"];
/** Other colours a theme sets under `:hover`, which do not change on hover in the renderer. */
const OTHER_HOVER_COLOR = /^--blyrics-(?:lyric-active-color|glow-color|translated-color|text-color|lyric-inactive-color)$/;
const BEATEN = { beaten: true };

/**
 * What a selector under a hovered line styles: { line, layer }, `line` being the hovered line's
 * selector without the `:hover`, and `layer` "line" (the line itself), "word" (its words) or "other"
 * (something else in it, such as background vocals); null when no line is hovered.
 */
function hoverTarget(selector) {
  const parts = compounds(selector);
  const at = parts.findLastIndex((part) => isHovered(part.compound));
  if (at < 0) return null;
  const line = hoveredLine(joinCompounds(parts.slice(0, at + 1)));
  if (!line) return null;
  // The old engine's `span` between a line and its words matches nothing now.
  const rest = parts.slice(at + 1).filter((part, i, all) => i === all.length - 1 || part.compound !== "span");
  if (rest.length === 0) return { line, layer: "line" };
  const subject = simples(rest[0].compound);
  const word = rest.length === 1 && /^[ >]$/.test(rest[0].combinator) && subject.every((s) => s === ".blyrics--word" || s === ".blyrics-line-synced-word");
  return { line, layer: word ? "word" : "other" };
}

/**
 * `--blyrics-line-hover-color`, from the colour a theme gives a hovered line's words before they are
 * sung: `color` on the line or its words, or `--blyrics-lyric-inactive-color` on either, under
 * `:hover`. It applies to whichever line is hovered, so it is written when every line but the sung
 * one ends up the same; the sung line differing is noted.
 */
function hoverColor(rules, customs, sync, authored, review, unsupported, cover) {
  const name = "--blyrics-line-hover-color";
  const candidates = [];
  let order = 0;
  for (const { selector, conditional, declarations } of rules) {
    for (const [property, raw, important] of declarations) {
      order++;
      const colour = HOVER_COLOR.includes(property);
      if (!colour && !OTHER_HOVER_COLOR.test(property)) continue;
      for (const original of splitTopLevel(selector, ",").map((s) => s.trim())) {
        for (const one of expandIs(original)) {
          const target = hoverTarget(one);
          // A rule for lines at rest that outweighs the hover rule keeps those lines as they are.
          if (!target) {
            const role = property === "--blyrics-lyric-inactive-color" && !conditional ? lineRole(one, sync) : null;
            if (role && !role.scoped) candidates.push({ ...role, layer: "line", property, hovered: false, important, specificity: specificity(one), order });
            continue;
          }
          const role = lineRole(target.line, sync);
          if (!role) continue;
          if (!colour || target.layer === "other") {
            if (property.startsWith("--")) {
              unsupported.push({ line: original, code: "hover", message: "Only the colour of the hovered line's words before they are sung changes on hover in the WebGL renderer, from `--blyrics-line-hover-color`. Other colours set under `:hover` (the sung part, the glow, background vocals, translations) stay as they are." });
            }
            continue;
          }
          cover(original, property);
          if (role.scoped || conditional) {
            review(`This hover colour applies to only some screens, views or lines, so ${name} was not written for it. Set it under a selector or media query of your own if it matters.`, original);
            continue;
          }
          candidates.push({ ...role, layer: target.layer, property, hovered: true, value: cssColor(resolve(raw, customs)), raw: `${property}: ${raw}`, selector: original, important, specificity: specificity(one), order });
        }
      }
    }
  }
  if (!candidates.some((c) => c.hovered)) return [];
  if (authored.has(name)) {
    review(`The theme already sets ${name}, so it was left as written.`);
    return [];
  }
  const first = candidates.find((c) => c.hovered).selector;

  /** The hover colours that win on a line, the words' over the line's own; BEATEN where a rule at rest wins. */
  const at = (side, d) => {
    for (const layer of ["word", "line"]) {
      const found = [];
      for (const property of HOVER_COLOR) {
        const set = candidates.filter((c) => c.layer === layer && c.property === property && c[side] && d >= c[side][0] && d <= c[side][1]);
        if (!set.some((c) => c.hovered)) continue;
        const won = winner(set);
        found.push(won.hovered ? won : BEATEN);
      }
      if (found.length > 0) return found;
    }
    return [];
  };
  const reach = reachOf(candidates);
  const others = ["before", "after"].flatMap((side) => Array.from({ length: reach }, (_, i) => at(side, i + 1)));
  const unreadable = others.flat().find((c) => c !== BEATEN && c.value === null);
  if (unreadable) {
    review(`Could not read \`${unreadable.raw}\` on the hovered line as a colour, so ${name} was not written; set it by hand.`, unreadable.selector);
    return [];
  }
  const values = new Set(others.map((found) => (found.length === 0 || found.includes(BEATEN) ? null : found.map((c) => c.value).join("\n"))));
  const [value] = values;
  if (values.size !== 1 || value === null || value.includes("\n")) {
    review(`The theme's hover colour differs from line to line, and ${name} applies to whichever line is hovered, so it was not written; set it by hand.`, first);
    return [];
  }
  const sung = at("after", 0).find((c) => c === BEATEN || c.value !== value);
  if (sung) {
    review(`The line being sung has a hover colour of its own${sung.raw ? ` (\`${sung.raw}\`)` : ""}, and ${name} applies to whichever line is hovered, so the sung line takes the other lines' hover colour; check it.`, sung.selector ?? first);
  }
  return [`${name}: ${value};`];
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
    if (groups.length > before) themeWide.push(...riseValues(rises, authored, cover));
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
function riseValues(rises, authored, cover) {
  const extras = new Set();
  const easings = new Set();
  for (const { value, original } of rises) {
    const transition = splitTopLevel(value, ",").map((t) => t.trim()).find((t) => /^(?:transform|all)\b/.test(t));
    if (!transition) continue;
    const parts = splitTopLevel(transition, " ").map((t) => t.trim()).filter(Boolean);
    const m = /^calc\(\s*var\(\s*--blyrics-duration\b[^)]*\)\s*\+\s*(\d+(?:\.\d+)?)(ms|s)\s*\)$/.exec(parts[1] ?? "");
    if (!m) continue;
    extras.add(m[2] === "s" ? Number(m[1]) : Number(m[1]) / 1000);
    const easing = parts.slice(2).find((t) => /^(?:ease|ease-in|ease-out|ease-in-out|linear|(?:cubic-bezier|steps|linear)\(.*\))$/.test(t));
    easings.add(easing ?? "ease");
    cover(original, "transition");
  }
  const out = [];
  if (extras.size === 1 && [...extras][0] !== 0.2 && !authored.has("--blyrics-word-rise-extra-duration")) out.push(`--blyrics-word-rise-extra-duration: ${trimNumber([...extras][0])}s;`);
  if (easings.size === 1 && [...easings][0] !== "ease" && !authored.has("--blyrics-word-rise-easing")) out.push(`--blyrics-word-rise-easing: ${[...easings][0]};`);
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
    // What the renderer's layout container carries too: the sync type, the stage view, no lyrics.
    const carried = (s) => SYNC.test(s) || LAYOUT.test(s);
    const kept = own.filter((s) => s === ".blyrics-container" || s === "div" || carried(s) || (argumentsOf(s, "not") ?? [""]).every(carried));
    return { ...part, compound: kept.join("") };
  });
  return joinCompounds(parts);
}

const STATE_SHADOW = "A text shadow that changes when a single word is sung, while the reader scrolls or while the mouse is over the lyrics does not show. The WebGL renderer draws `--blyrics-text-shadow`, with `--blyrics-active-text-shadow` on the line being sung and `--blyrics-line-hover-text-shadow` on the line under the mouse.";

/** Elements whose text the renderer draws, which a text shadow reaches. */
const SHADOWED = /^(?:\.blyrics--(?:line|word|translated|romanized)|\.blyrics-(?:container|line-main|bidi-run|word-group|background-line|background-lyric|content-line|line-synced-word))$/;
/** The DOM renderer's copy of the text for the sweep, which the WebGL renderer does not draw. */
const OVERLAY = /^\.blyrics-(?:highlight-run|word-highlight|sweep-text)$/;
/** Text inside a line, which inherits a line's shadow variables. */
const IN_LINE = /^\.blyrics(?:--(?:word|translated|romanized)|-(?:line-main|bidi-run|word-group|background-line|background-lyric|content-line|line-synced-word))$/;
const inLine = (selector) => simples(lastCompound(selector)).some((s) => IN_LINE.test(s));
/** The rows of a line, and the words and runs in them. */
const ROW = /^\.blyrics(?:--(?:translated|romanized)|-(?:line-main|background-line|content-line))$/;
const WORDISH = /^\.blyrics(?:--word|-(?:bidi-run|word-group|background-lyric|line-synced-word))$/;
const SHADOW_NAMES = { rest: "--blyrics-text-shadow", active: "--blyrics-active-text-shadow", hover: "--blyrics-line-hover-text-shadow" };

/**
 * The state a text shadow's selector is for: { state, selector } with the selector it is to be
 * written under, the state being "rest", "active" (the line being sung) or "hover" (the line under
 * the mouse); { state: "sung-hover" } for the sung line only while hovered; null for any other.
 */
function shadowState(selector) {
  if (!isStateful(selector)) return { state: "rest", selector: plainSelector(withoutRestingState(selector)) };
  const found = new Set(
    expandIs(selector).map((one) => {
      let parts = compounds(one);
      let state = "active";
      const at = parts.findLastIndex((part) => isHovered(part.compound));
      if (at >= 0) {
        const line = hoveredLine(joinCompounds(parts.slice(0, at + 1)));
        if (!line) return null;
        parts = [...compounds(line), ...parts.slice(at + 1)];
        state = "hover";
      }
      let sung = false;
      let word = false;
      parts = parts.map((part) => {
        const own = simples(part.compound);
        const kept = own.filter((s) => !STATE.test(s));
        if (kept.length === own.length) return part;
        // A sung word is a word state, which shadows are not told apart by.
        word ||= own.some((s) => /^\.blyrics(?:--word|--letter|-line-synced-word)$/.test(s));
        sung = true;
        return { ...part, compound: kept.join("") || ".blyrics--line" };
      });
      const rest = joinCompounds(parts);
      if (word || isStateful(rest) || (state === "active" && !sung)) return null;
      return JSON.stringify(state === "hover" && sung ? { state: "sung-hover" } : { state, selector: plainSelector(withoutRestingState(rest)) });
    })
  );
  return found.size === 1 && !found.has(null) ? JSON.parse([...found][0]) : null;
}

/**
 * `--blyrics-text-shadow` from each static `text-shadow` on lyric text, under the same selector,
 * and `--blyrics-active-text-shadow` / `--blyrics-line-hover-text-shadow` from those on the sung or
 * hovered line and its text, under the selector without the state.
 */
function textShadows(rules, authored, review, unsupported, cover) {
  const out = [];
  const stated = [];
  let order = 0;
  for (const { selector, conditional, declarations } of rules) {
    for (const [property, raw, important] of declarations) {
      order++;
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
        const where = shadowState(original);
        const name = SHADOW_NAMES[where?.state];
        if (!where) {
          unsupported.push({ line: original, code: "state-shadow", message: STATE_SHADOW });
        } else if (where.state === "sung-hover") {
          review("This text shadow is for the line being sung only while the mouse is over it. `--blyrics-line-hover-text-shadow` applies to whichever line is under the mouse, so it was not written; set it on the lines by hand if every hovered line may take it.", original);
        } else if (conditional) {
          review(`This text shadow applies to only some screens, so ${name} was not written for it. Set it under a media query of your own if it matters.`, original);
        } else if (authored.has(name)) {
          review(`The theme already sets ${name}, so it was left as written.`);
        } else if (where.state === "rest") {
          stated.push({ ...where, raw, important, specificity: specificity(original), order, original });
          out.push({ selector: where.selector, declarations: [`${name}: ${raw}${important ? " !important" : ""};`] });
        } else {
          stated.push({ ...where, raw, important, specificity: specificity(original), order, original });
        }
      }
    }
  }
  // One shadow a state on each selector: the one the cascade gives the line in that state.
  const won = new Map();
  for (const entry of stated.filter((e) => e.state !== "rest")) {
    const key = `${entry.state}\n${entry.selector}`;
    if (!won.has(key) || winner([won.get(key), entry]) === entry) won.set(key, entry);
  }
  for (const entry of [...won.values()].sort((a, b) => a.order - b.order)) {
    const name = SHADOW_NAMES[entry.state];
    // A shadow at rest the cascade puts over this one keeps the line as it is in that state too.
    const beaten = stated.find((e) => e.state === "rest" && e.selector === entry.selector && winner([entry, e].sort((a, b) => a.order - b.order)) === e);
    if (beaten) {
      review(`The theme's text shadow at rest (\`${beaten.raw}\`) outweighs this one, so ${name} was not written; check which the line should take.`, entry.original);
      continue;
    }
    out.push({ selector: entry.selector, declarations: [`${name}: ${entry.raw}${entry.important ? " !important" : ""};`] });
  }
  // Text inside a line or row with a shadow of its own keeps it in every state in the DOM renderer,
  // but would inherit the line's state shadow: pin that text's state shadow to its own.
  const textOf = (selector) => simples(lastCompound(selector)).filter((s) => IN_LINE.test(s));
  const rests = new Map();
  for (const e of stated.filter((e) => e.state === "rest" && inLine(e.selector))) rests.set(e.selector, [...(rests.get(e.selector) ?? []), e]);
  const pinned = new Set();
  for (const entry of [...won.values()].sort((a, b) => a.order - b.order)) {
    const name = SHADOW_NAMES[entry.state];
    const row = textOf(entry.selector).find((s) => ROW.test(s));
    // Words and runs have nothing below them; a row, its words and runs only.
    if ((textOf(entry.selector).length > 0 && !row) || authored.has(name)) continue;
    for (const [selector, list] of rests) {
      const text = textOf(selector);
      if (row) {
        const above = compounds(selector).slice(0, -1).flatMap((part) => simples(part.compound));
        // Words named without a row are the main row's.
        const inside = above.includes(row) || (row === ".blyrics-line-main" && !above.some((s) => ROW.test(s)));
        if (!text.some((s) => WORDISH.test(s)) || !inside) continue;
      }
      // A state shadow the theme gives that text itself is written already.
      const key = `${entry.state}\n${selector}`;
      if (pinned.has(key) || [...won.values()].some((w) => w.state === entry.state && textOf(w.selector).some((s) => text.includes(s)))) continue;
      pinned.add(key);
      const rest = winner(list);
      out.push({ selector, declarations: [`${name}: ${rest.raw}${rest.important ? " !important" : ""};`] });
    }
  }
  return out;
}

/**
 * `--blyrics-romanized-bg-color` from each static `background` or `background-color` on a
 * romanization, under the same selector.
 */
function romanizedBackgrounds(rules, authored, review, unsupported, cover) {
  const found = [];
  const name = "--blyrics-romanized-bg-color";
  for (const { selector, conditional, declarations } of rules) {
    for (const [property, raw, important] of declarations) {
      if (property !== "background" && property !== "background-color") continue;
      for (const original of splitTopLevel(selector, ",").map((s) => s.trim())) {
        const subject = simples(lastCompound(original));
        if (!subject.includes(".blyrics--romanized") || subject.some((s) => /^::?(?:before|after)$|^::/.test(s))) continue;
        const value = backgroundFill(property, raw);
        // An image stays reported as not drawn.
        if (value === undefined) continue;
        cover(original, property);
        if (isStateful(original)) {
          if (value !== "transparent") unsupported.push({ line: original, code: "state-background", message: `A romanization background that changes when a line or word is sung or hovered does not show: the WebGL renderer draws ${name} the same in every state.` });
        } else if (conditional) {
          review(`This romanization background applies to only some screens, so ${name} was not written for it. Set it under a media query of your own if it matters.`, original);
        } else if (authored.has(name)) {
          review(`The theme already sets ${name}, so it was left as written.`);
        } else if (value === null) {
          review(`Could not read \`${property}: ${raw}\` on the romanization as a colour, so ${name} was not written; set it by hand.`, original);
        } else {
          found.push({ selector: plainSelector(withoutRestingState(original)), important, value });
        }
      }
    }
  }
  return dedupe(found).map((f) => ({ selector: f.selector, declarations: [`${name}: ${f.value}${f.important ? " !important" : ""};`] }));
}

// -- Boxes behind lines -----------------------------------------------------

/** The properties that paint a box behind a line, and which of its two parts each paints. */
const BOX_PROPERTIES = { background: "bg", "background-color": "bg", outline: "border", border: "border" };
/** On a hovered line, the colour longhands too: a border drawn transparent at rest and coloured on hover. */
const HOVER_BOX_PROPERTIES = { ...BOX_PROPERTIES, "border-color": "border", "outline-color": "border" };
const BOX_NAMES = { bg: "--blyrics-line-bg-color", border: "--blyrics-line-border-color" };
const HOVER_BOX_NAMES = { bg: "--blyrics-line-hover-bg-color", border: "--blyrics-line-hover-border-color" };
const BORDER_STYLE = /^(?:none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset|auto)$/i;
const BORDER_WIDTH = { thin: "1px", medium: "3px", thick: "5px" };
const ONLY_SOLID = "Only a solid colour is drawn behind a line, from `--blyrics-line-bg-color`, with a solid border or outline from `--blyrics-line-border-color` and `--blyrics-line-border-width`. A gradient, an image or another border style is not drawn by the WebGL renderer.";
const STATE_BOX = "A box behind a line that changes when the line is sung, while the reader scrolls or while the mouse is over the lyrics does not show. The WebGL renderer draws `--blyrics-line-bg-color` and `--blyrics-line-border-color` the same in every state but one, the line under the mouse (`--blyrics-line-hover-bg-color` and `--blyrics-line-hover-border-color`).";

/**
 * Whether a selector paints a box behind lines: { selector } to write it under, { hover: true } for
 * the line under the mouse, { stateful: true } for a state the renderer cannot scope by; null when
 * its subject is no line.
 */
function boxScope(selector) {
  const parts = compounds(selector);
  const last = parts[parts.length - 1];
  if (!last || syncOf(selector) === null) return null;
  const subject = simples(last.compound);
  if (subject.some((s) => s.startsWith("::") || PSEUDO.test(s))) return null;
  if (subject.some((s) => s.startsWith(".blyrics") && !/^\.blyrics--(?:line|active|animating|paused|instrumental)$/.test(s))) return null;
  const child = parts.length > 1 && last.combinator === ">" && simples(parts[parts.length - 2].compound).includes(".blyrics-container");
  if (!subject.includes(".blyrics--line") && !subject.some((s) => STATE.test(s)) && !child) return null;
  if (expandIs(selector).every((one) => hoverTarget(one)?.layer === "line")) return { hover: true };
  if (isStateful(selector)) return { stateful: true };
  return { selector: plainSelector(withoutRestingState(selector)) };
}

/**
 * What a box property paints, read with `customs`: { color, width } to write (width null for a fill),
 * "transparent" when it draws nothing, undefined when it draws what the box cannot (an image, a
 * dashed border), null when it cannot be read. A colour given as one variable is written as that
 * variable, so it keeps following the theme.
 */
function boxValue(property, raw, customs) {
  if (drawsNothing(raw)) return "transparent";
  if (property === "background" || property === "background-color") {
    const fill = backgroundFill(property, resolve(raw, customs));
    if (fill === undefined || fill === null || fill === "transparent") return fill;
    if (/\bvar\(/.test(fill)) return null;
    return { color: /^var\([^()]*\)$/.test(raw) ? raw : fill, width: null };
  }
  if (property === "border-color" || property === "outline-color") {
    const colour = resolve(raw, customs);
    if (/\bvar\(/.test(colour) || cssColor(colour) === null) return null;
    return colour.toLowerCase() === "transparent" ? "transparent" : { color: /^var\([^()]*\)$/.test(raw) ? raw : colour, width: null };
  }
  const parts = borderParts(raw, customs);
  if (!parts) return null;
  const { style, width, color } = parts;
  if (style === "none" || style === "hidden" || /^0(?:\.0+)?[a-z]*$/.test(width.value) || color?.value.toLowerCase() === "transparent") return "transparent";
  if (style !== "solid") return undefined;
  // No colour is currentColor, which is the element's own text colour.
  if (!color) return null;
  return { color: /^var\([^()]*\)$/.test(color.raw) ? color.raw : color.value, width: /^var\(/.test(width.raw) ? width.raw : width.value };
}

/** The style, width and colour tokens ({ raw, value }) of a border or outline shorthand, or null. */
function borderParts(raw, customs) {
  const split = (text) => splitTopLevel(text, " ").map((t) => t.trim()).filter(Boolean);
  let tokens = split(raw).map((token) => ({ raw: token, value: resolve(token, customs) }));
  // A variable that stands for more than one part of the shorthand is read whole.
  if (tokens.some((t) => split(t.value).length > 1)) tokens = split(resolve(raw, customs)).map((value) => ({ raw: value, value }));
  let style = "none";
  let width = { raw: "3px", value: "3px" };
  let color = null;
  for (const token of tokens) {
    const value = token.value.toLowerCase();
    if (/\bvar\(/.test(value)) return null;
    if (BORDER_STYLE.test(value)) style = value;
    else if (BORDER_WIDTH[value]) width = { raw: BORDER_WIDTH[value], value: BORDER_WIDTH[value] };
    else if (/^(?:\d+(?:\.\d+)?|\.\d+)[a-z]+$|^0$/.test(value)) width = token;
    else if (cssColor(token.value) !== null) color = token;
    else return null;
  }
  return { style, width, color };
}

/**
 * The border or outline a line draws at rest that a hover colour longhand colours: the weightiest
 * `shorthand` of the rest boxes, when it has a visible style and a width. Its width, to write;
 * { solid: false } when it is not solid, { scoped: true } when only some lines have it.
 */
function restBorder(boxes, shorthand, customs, sync) {
  const set = boxes.filter((b) => b.property === shorthand);
  const won = set.length ? winner(set) : null;
  const parts = won && borderParts(won.raw, customs);
  if (!parts || parts.style === "none" || parts.style === "hidden" || /^0(?:\.0+)?[a-z]*$/.test(parts.width.value)) return null;
  if (parts.style !== "solid") return { solid: false };
  const role = lineRole(won.original, sync);
  if (/\[/.test(won.original) || !role || role.scoped) return { scoped: true };
  return { entry: won, width: /^var\(/.test(parts.width.raw) ? parts.width.raw : parts.width.value };
}

/** A value as every song the selector is for reads it, or null when they differ. */
function readValue(selector, read, customs) {
  const sync = syncOf(selector);
  const key = (value) => (value === undefined ? "undefined" : JSON.stringify(value));
  const values = new Set((sync ? [sync] : SYNCS).map((s) => key(read(customs[s]))));
  return values.size === 1 ? ([...values][0] === "undefined" ? undefined : JSON.parse([...values][0])) : null;
}

/**
 * `--blyrics-line-bg-color`, `--blyrics-line-border-color` and `--blyrics-line-border-width` from
 * each static `background`, `outline` or `border` on a line, under the same selector. The box's
 * corner radius is the line's own `border-radius`, which stays as written.
 */
function lineBoxes(rules, customs, authored, review, unsupported, cover) {
  const found = [];
  let order = 0;
  for (const { selector, conditional, declarations } of rules) {
    for (const [property, raw, important] of declarations) {
      order++;
      const kind = BOX_PROPERTIES[property];
      if (!kind) continue;
      for (const original of splitTopLevel(selector, ",").map((s) => s.trim())) {
        const where = boxScope(original);
        if (!where || where.hover) continue;
        cover(original, property);
        const value = readValue(original, (within) => boxValue(property, raw, within), customs);
        if (value === undefined) unsupported.push({ line: original, code: "line-box", message: ONLY_SOLID });
        else if (where.stateful) {
          if (value !== "transparent") unsupported.push({ line: original, code: "state-box", message: STATE_BOX });
        } else if (conditional) {
          review("This box behind lines applies to only some screens, so --blyrics-line-bg-color and --blyrics-line-border-color were not written for it. Set them under a media query of your own if it matters.", original);
        } else {
          found.push({ kind, property, selector: where.selector, original, raw, value, important, specificity: specificity(original), order });
        }
      }
    }
  }

  // What the cascade gives each selector: the last of the weightiest for each property, with
  // `background` and `background-color` as one.
  const won = new Map();
  for (const entry of found) {
    const key = `${entry.selector}\n${entry.kind === "bg" ? entry.kind : entry.property}`;
    if (!won.has(key) || winner([won.get(key), entry]) === entry) won.set(key, entry);
  }
  const drawn = (kind) => [...won.values()].some((e) => e.kind === kind && e.value && typeof e.value === "object");
  const bySelector = new Map();
  for (const entry of [...won.values()].sort((a, b) => a.order - b.order)) {
    const name = BOX_NAMES[entry.kind];
    if (authored.has(name) || (entry.kind === "border" && authored.has("--blyrics-line-border-width"))) {
      review(`The theme already sets ${name}, so it was left as written.`);
      continue;
    }
    if (entry.value === null) {
      review(`Could not read \`${entry.property}: ${entry.raw}\` on the line as a solid colour, so ${name} was not written; set it by hand.`, entry.original);
      continue;
    }
    // Clearing a box matters only where another rule draws one.
    if (entry.value === "transparent" && !drawn(entry.kind)) continue;
    const declarations = bySelector.get(entry.selector) ?? new Map();
    const other = declarations.get(name);
    if (entry.kind === "border" && other && other.property !== entry.property && other.value !== "transparent") {
      // A border and an outline are both drawn; the renderer draws one.
      if (entry.value === "transparent") continue;
      review(`This line has both a border and an outline, and the WebGL renderer draws one, so ${name} takes the ${entry.property}; check it.`, entry.original);
    }
    declarations.set(name, entry);
    bySelector.set(entry.selector, declarations);
  }
  const important = (entry) => (entry.important ? " !important" : "");
  const groups = [...bySelector].map(([selector, declarations]) => ({
    selector,
    declarations: [...declarations].flatMap(([name, entry]) => {
      if (entry.value === "transparent") return [`${name}: transparent${important(entry)};`];
      return [`${name}: ${entry.value.color}${important(entry)};`, ...(entry.value.width ? [`--blyrics-line-border-width: ${entry.value.width}${important(entry)};`] : [])];
    }),
  }));
  return { groups, found };
}

/** `--blyrics-line-border-width` under the rest border's selector, when the line boxes lack it. */
function writeWidth(groups, { entry, width }, authored) {
  const name = "--blyrics-line-border-width";
  if (authored.has(name)) return;
  const declaration = `${name}: ${width}${entry.important ? " !important" : ""};`;
  const group = groups.find((g) => g.selector === entry.selector);
  if (!group) groups.push({ selector: entry.selector, declarations: [declaration] });
  else if (!group.declarations.some((d) => d.startsWith(`${name}:`))) group.declarations.push(declaration);
}

/**
 * `--blyrics-line-hover-bg-color` and `--blyrics-line-hover-border-color`, from the box a
 * `.blyrics--line:hover` rule draws. They apply to whichever line is hovered, so they are written
 * when every line ends up the same, as the other hover values are.
 */
function hoverBoxes(rules, customs, sync, { found: boxes, groups }, authored, review, unsupported, cover) {
  const candidates = { bg: [], border: [] };
  let order = 0;
  for (const { selector, conditional, declarations } of rules) {
    for (const [property, raw, important] of declarations) {
      order++;
      const kind = HOVER_BOX_PROPERTIES[property];
      if (!kind) continue;
      for (const original of splitTopLevel(selector, ",").map((s) => s.trim())) {
        if (!boxScope(original)?.hover) continue;
        // Alternatives for the other sync type pick no line here.
        const roles = expandIs(original).map((one) => lineRole(hoverTarget(one).line, sync)).filter(Boolean);
        if (roles.length === 0) continue;
        cover(original, property);
        const value = boxValue(property, raw, customs);
        if (value === undefined) {
          unsupported.push({ line: original, code: "line-box", message: ONLY_SOLID });
        } else if (conditional || roles.some((role) => role.scoped)) {
          review(`This box behind the hovered line applies to only some screens, views or lines, so ${HOVER_BOX_NAMES[kind]} was not written for it. Set it under a selector or media query of your own if it matters.`, original);
        } else if (/^(?:border|outline)-color$/.test(property) && value && typeof value === "object") {
          // A colour longhand colours the border the line has at rest, as wide as that one.
          const shorthand = property.slice(0, -"-color".length);
          const rest = restBorder(boxes, shorthand, customs, sync);
          if (!rest) {
            review(`\`${property}\` on the hovered line colours ${shorthand === "outline" ? "an" : "a"} ${shorthand} the line does not draw at rest, so ${HOVER_BOX_NAMES[kind]} was not written for it; set it by hand if the hovered line should get one.`, original);
            continue;
          }
          if (rest.solid === false) {
            review(ONLY_SOLID, original);
            continue;
          }
          if (rest.scoped) {
            review(`\`${property}\` on the hovered line colours a ${shorthand} only some lines draw at rest, and ${HOVER_BOX_NAMES[kind]} applies to whichever line is hovered, so it was not written; set it by hand.`, original);
            continue;
          }
          writeWidth(groups, rest, authored);
          for (const role of roles) candidates[kind].push({ ...role, property, value: { ...value, width: rest.width }, raw, selector: original, important, specificity: specificity(original), order });
        } else {
          for (const role of roles) candidates[kind].push({ ...role, property, value, raw, selector: original, important, specificity: specificity(original), order });
        }
      }
    }
  }

  const out = [];
  for (const [kind, all] of Object.entries(candidates)) {
    if (all.length === 0) continue;
    const name = HOVER_BOX_NAMES[kind];
    if (authored.has(name)) {
      review(`The theme already sets ${name}, so it was left as written.`);
      continue;
    }
    const reach = reachOf(all);
    const won = [...cascade(all, "before", reach), ...cascade(all, "after", reach)];
    const values = new Set(won.map((c) => (c ? JSON.stringify(c.value) : "none")));
    const [value] = [...values].map((v) => (v === "none" ? undefined : JSON.parse(v)));
    const first = all[0].selector;
    if (values.size !== 1 || value === undefined) {
      review(`The theme's hover box differs from line to line, and ${name} applies to whichever line is hovered, so it was not written; set it by hand.`, first);
      continue;
    }
    if (value === null) {
      review(`Could not read \`${all[0].property}: ${all[0].raw}\` on the hovered line as a solid colour, so ${name} was not written; set it by hand.`, first);
      continue;
    }
    // A box at rest that outweighs the hover rule keeps those lines as they are.
    const hover = winner(all);
    const beaten = boxes.find((b) => b.kind === kind && b.value && typeof b.value === "object" && (b.important !== hover.important ? b.important : compareSpecificity(b.specificity, hover.specificity) > 0));
    if (beaten) {
      review(`The theme's box behind ${beaten.selector} outweighs its hover box, and ${name} applies to whichever line is hovered, so it was not written; set it by hand.`, first);
      continue;
    }
    if (value === "transparent") {
      // Clearing the box on hover matters only where a line has one.
      if (boxes.some((b) => b.kind === kind && b.value && typeof b.value === "object")) out.push(`${name}: transparent;`);
      continue;
    }
    if (value.width && value.width !== "1px" && !/-color$/.test(hover.property)) {
      review(`The hovered line's ${hover.property} is ${value.width} wide. The WebGL renderer draws it as wide as the line's own border, \`--blyrics-line-border-width\` (1px unless set); check it.`, first);
    }
    out.push(`${name}: ${value.color};`);
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
  let reviewed = false;
  // What the theme sets on the word itself, which a copy from its `::after` would override.
  const onWord = new Set();
  for (const { selector, declarations } of rules) {
    const word = splitTopLevel(selector, ",").some((one) => {
      const own = simples(lastCompound(one.trim()));
      return own.some((s) => s === ".blyrics--word" || s === ".blyrics-line-synced-word") && !own.some((s) => PSEUDO.test(s) || s.startsWith("::")) && !isStateful(one.trim());
    });
    if (word) for (const [name] of declarations) onWord.add(name);
  }
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
      const copied = variables.filter(([name]) => !onWord.has(name));
      if (copied.length < variables.length) {
        reviewed = true;
        review(`The theme sets ${variables.filter(([name]) => onWord.has(name)).map(([name]) => name).join(", ")} on the word itself too, so the word's \`::after\` value was not copied onto the word, where it would replace the word's own on both renderers. Check which the word should take.`, original);
      }
      if (copied.length) groups.push({ selector: plainSelector(withoutRestingState(target)), declarations: copied.map(([name, value, important]) => `${name}: ${value}${important ? " !important" : ""};`) });
    }
  }
  // The old engine's note says to set them on the word, which a review above already weighs.
  return { groups, settles: (groups.length > 0 || reviewed) && !skipped ? ["var-on-pseudo"] : [] };
}

// -- The instrumental icon and the no-lyrics message ----------------------

const CSS_STRING = /^(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')$/;
const PSEUDO = /^::?(before|after)$/;
const EMPTY_LINE = ":has(.blyrics-bidi-run:empty)";
const NO_LYRICS = /^\[data-no-lyrics=["']?true["']?\]$/;
const NO_LYRICS_LINE = '.blyrics-container[data-no-lyrics="true"] .blyrics--line';
/** Font sizes and weights that depend on the element's parent, which is not the same once moved. */
const RELATIVE_FONT = /\d(?:em|ex|ch|lh|%)(?![a-z])|\bvar\(|^(?:larger|smaller|bolder|lighter|inherit)$/;

/** The text of a CSS string, or null when `value` is not one. */
function cssString(value) {
  return CSS_STRING.test(value) ? value.slice(1, -1) : null;
}

/**
 * Whether a selector is an instrumental line's `::before` or `::after`, or the empty line's
 * (`.blyrics--line:has(.blyrics-bidi-run:empty) .blyrics-line-main::before`), which themes draw
 * their own note on. Returns { state, scoped }: the state is "rest", "sung" (the line being sung),
 * or "other" (paused, or the reader browsing); scoped when it is for only some lines or views.
 */
function instrumentalPseudo(selector) {
  const parts = compounds(selector);
  const subject = simples(parts[parts.length - 1]?.compound ?? "");
  if (!subject.some((s) => PSEUDO.test(s))) return null;
  let at = parts.length - 1;
  let scoped = false;
  if (!subject.includes(".blyrics--instrumental")) {
    if (!subject.includes(".blyrics-line-main") || at === 0 || !/^[ >]$/.test(parts[at].combinator)) return null;
    at--;
    if (!simples(parts[at].compound).includes(EMPTY_LINE)) return null;
    scoped = subject.some((s) => s !== ".blyrics-line-main" && !PSEUDO.test(s));
  }
  const own = simples(parts[at].compound);
  const ancestors = parts.slice(0, at);
  if (own.includes(".blyrics--paused") || ancestors.some((part) => simples(part.compound).some((s) => s === ":hover" || s === ".blyrics-user-scrolling"))) {
    return { state: "other", scoped };
  }
  const plain = own.every((s) => PSEUDO.test(s) || STATE.test(s) || s === EMPTY_LINE || /^(?:div|\.blyrics--line|\.blyrics--instrumental)$/.test(s));
  const resting = syncOf(selector) === "" && ancestors.every((part) => {
    const container = simples(part.compound);
    return container.includes(".blyrics-container") ? isContainerAtRest(part.compound) : container.every((s) => PAGE.test(s));
  });
  return { state: own.some((s) => STATE.test(s)) ? "sung" : "rest", scoped: scoped || !plain || !resting };
}

/** Whether a rule masks its box into a row of round dots: Apple Music's instrumental. */
function isDotsMask(own) {
  const mask = ["mask", "-webkit-mask", "mask-image", "-webkit-mask-image"].map((p) => own[p]).filter(Boolean);
  const repeat = ["mask", "-webkit-mask", "mask-repeat", "-webkit-mask-repeat"].map((p) => own[p]).filter(Boolean);
  return mask.some((v) => /\bradial-gradient\(/.test(v)) && repeat.some((v) => /\brepeat-x\b/.test(v));
}

/**
 * `--blyrics-instrumental-icon` from the content a theme draws on the instrumental line's
 * `::before` / `::after`, and the pulse from the animation it runs there while the line is sung.
 * Read from the container, so they are written there.
 */
function instrumentalValues(rules, keyframes, authored, review, cover) {
  const icons = [];
  const animated = [];
  const hides = [];
  for (const { selector, conditional, declarations } of rules) {
    const own = Object.fromEntries(declarations.map(([property, value]) => [property, value]));
    for (const original of splitTopLevel(selector, ",").map((s) => s.trim())) {
      if (/^none\b/.test(own.display ?? "") && simples(lastCompound(original)).includes(".blyrics--instrumental-icon")) hides.push(original);
      for (const one of expandIs(original)) {
        const where = instrumentalPseudo(one);
        if (!where || where.state === "other") continue;
        if (where.state === "rest" && own.content !== undefined) {
          if (conditional || where.scoped) {
            review("This instrumental note applies to only some screens, views or lines, so --blyrics-instrumental-icon was not written for it. Set it under a selector or media query of your own if it matters.", original);
          } else if (!/^none\b/.test(own.display ?? "")) {
            icons.push({ raw: own.content, dots: isDotsMask(own), original });
          }
        }
        if (where.state === "sung" && !conditional && !where.scoped && (own.animation || own["animation-name"])) animated.push({ own, original });
      }
    }
  }

  const out = [];
  const name = "--blyrics-instrumental-icon";
  // Nothing drawn: `content: none` or `normal`.
  const drawn = icons.filter((icon) => !/^(?:none|normal)$/.test(icon.raw));
  if (drawn.length === 0) return out;
  const values = drawn.map((icon) => {
    const text = cssString(icon.raw);
    if (text === null) return null;
    return text === "" ? (icon.dots ? "dots" : "") : icon.raw;
  });
  const unreadable = drawn.find((_, i) => values[i] === null);
  const empty = drawn.find((_, i) => values[i] === "");
  if (unreadable) {
    review(`Could not read \`content: ${unreadable.raw}\` on the instrumental line, so ${name} was not written; set it to a CSS string by hand.`, unreadable.original);
    return out;
  }
  if (empty) {
    review(`This draws something on the instrumental line other than text, which the WebGL renderer does not draw. Its ${name} takes \`note\` (the default), \`dots\` (Apple Music's three dots, lit one after another) or a CSS string such as \`"♫"\`: if this is the three dots, set \`${name}: dots\` on \`.blyrics-container\`.`, empty.original);
    return out;
  }
  if (new Set(values).size > 1) {
    review(`The theme draws different notes on instrumental lines (${[...new Set(values)].join(", ")}), and ${name} is one for the whole song, so it was not written; set it by hand.`, drawn[0].original);
    return out;
  }
  if (authored.has(name)) {
    review(`The theme already sets ${name}, so it was left as written.`);
  } else {
    out.push(`${name}: ${values[0]};`);
    for (const icon of drawn) cover(icon.original, "content");
    // The DOM renderer's note, which the WebGL renderer replaces with this one.
    for (const hide of hides) cover(hide, "display");
  }
  return [...out, ...pulseValues(animated, keyframes, values[0] === "dots", authored, review)];
}

/**
 * `--blyrics-instrumental-pulse-scale` and `-duration` from the keyframes the sung instrumental
 * line's note runs: the scale furthest from 1, once a period.
 */
function pulseValues(animated, keyframes, dots, authored, review) {
  const pulses = [];
  for (const { own, original } of animated) {
    for (const animation of animationsOf(own)) {
      const frames = keyframes.get(animation.name);
      if (!frames) continue;
      const { scale, ends, others } = keyframeScale(frames, dots);
      // The dots light up by themselves: a keyframe that slides their fill across is theirs.
      if (others.length > 0) {
        review(
          scale === null
            ? `The \`${animation.name}\` animation on the instrumental note (${others.join(", ")}) does not run in the WebGL renderer. Only a pulsing scale carries over, as --blyrics-instrumental-pulse-scale.`
            : `Only the scale of the \`${animation.name}\` animation on the instrumental note carries over, as --blyrics-instrumental-pulse-scale; the rest of it (${others.join(", ")}) does not run in the WebGL renderer.`,
          original
        );
      }
      if (scale === null) continue;
      if (!ends || !animation.infinite || animation.seconds === null) {
        review(`The \`${animation.name}\` animation on the instrumental note does not swell and come back once a period, forever, which is what the WebGL renderer's pulse does, so --blyrics-instrumental-pulse-scale was not written; set it by hand.`, original);
        continue;
      }
      pulses.push({ scale, seconds: animation.seconds, original });
    }
  }
  if (pulses.length === 0) return [];
  const found = new Set(pulses.map((p) => `${p.scale} ${p.seconds}`));
  if (found.size > 1) {
    review("The instrumental note pulses differently in different rules, and the WebGL renderer's pulse is one for the whole song, so --blyrics-instrumental-pulse-scale was not written; set it by hand.", pulses[0].original);
    return [];
  }
  const out = [];
  const { scale, seconds } = pulses[0];
  for (const [name, value, rest] of [["--blyrics-instrumental-pulse-scale", scale, "1"], ["--blyrics-instrumental-pulse-duration", `${seconds}s`, "1.5s"]]) {
    if (authored.has(name)) review(`The theme already sets ${name}, so it was left as written.`);
    else if (value !== rest) out.push(`${name}: ${value};`);
  }
  return out;
}

/** The animations a rule runs: [{ name, seconds, infinite }], from the shorthand or the longhands. */
function animationsOf(own) {
  const list = (value) => (value ? splitTopLevel(value, ",").map((v) => v.trim()) : []);
  const seconds = (token) => {
    const m = /^(\d*\.?\d+)(ms|s)$/.exec(token ?? "");
    return m ? trimNumber(Number(m[1]) / (m[2] === "ms" ? 1000 : 1)) : null;
  };
  const out = list(own.animation)
    .filter((one) => one !== "none")
    .map((one) => {
      const tokens = splitTopLevel(one, " ").map((t) => t.trim()).filter(Boolean);
      const name = tokens.find((t) => /^[a-z_-][\w-]*$/i.test(t) && !ANIMATION_KEYWORD.test(t)) ?? "";
      return { name, seconds: seconds(tokens.find((t) => seconds(t) !== null)), infinite: tokens.includes("infinite") };
    });
  // Longhands set after the shorthand win, entry by entry.
  list(own["animation-name"]).forEach((name, i) => (out[i] = { seconds: null, infinite: false, ...out[i], name }));
  list(own["animation-duration"]).forEach((d, i) => out[i] && (out[i].seconds = seconds(d)));
  list(own["animation-iteration-count"]).forEach((n, i) => out[i] && (out[i].infinite = n === "infinite"));
  return out.filter((a) => a.name && a.name !== "none");
}

const ANIMATION_KEYWORD = /^(?:infinite|normal|reverse|alternate|alternate-reverse|none|forwards|backwards|both|running|paused|linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|initial|inherit|unset)$/;

/**
 * What a keyframe rule scales to: the scale furthest from 1 (null for none), whether it starts and
 * ends unscaled, and the other properties it animates.
 */
function keyframeScale(frames, dots) {
  let scale = null;
  let ends = true;
  const others = new Set();
  const consider = (value, stops) => {
    if (value === null) return false;
    const n = Number(value);
    if (scale === null || Math.abs(n - 1) > Math.abs(Number(scale) - 1)) scale = value;
    if (n !== 1 && stops.some((stop) => /^(?:from|to|0%|100%)$/.test(stop))) ends = false;
    return true;
  };
  for (const { selector, declarations } of frames) {
    const stops = splitTopLevel(selector, ",").map((s) => s.trim());
    for (const [property, value] of declarations) {
      if (property === "transform" && consider(scaleOf(value), stops)) continue;
      if (property === "scale" && consider(scaleNumber(value), stops)) continue;
      if (/^(?:transform-origin|animation-timing-function)$/.test(property)) continue;
      if (dots && /^background-position/.test(property)) continue;
      others.add(property);
    }
  }
  // Held at 1 throughout, it does not pulse.
  return { scale: scale === "1" ? null : scale, ends, others: [...others] };
}

/** A transform made only of a uniform `scale()`, `none` meaning 1, as a number; else null. */
function scaleOf(value) {
  if (value === "none") return "1";
  const m = /^scale\(\s*([^,()]+?)\s*(?:,\s*([^,()]+?)\s*)?\)$/.exec(value);
  if (!m || (m[2] !== undefined && m[2] !== m[1])) return null;
  return scaleNumber(m[1]);
}

/** A uniform scale, a number or a percentage, as a number; else null. */
function scaleNumber(value) {
  if (value === "none") return "1";
  const [x, y = x] = value.split(/\s+/);
  const m = /^(\d*\.?\d+)(%?)$/.exec(x);
  return m && y === x ? trimNumber(Number(m[1]) / (m[2] ? 100 : 1)) : null;
}

/**
 * Whether a selector is the line the renderer shows when there are no lyrics, or its `::before` /
 * `::after`: "line", "before", "after", or null.
 */
function noLyricsPart(selector) {
  const parts = compounds(selector);
  if (parts.length < 2 || !/^[ >]$/.test(parts[parts.length - 1].combinator)) return null;
  const subject = simples(parts[parts.length - 1].compound);
  const container = simples(parts[parts.length - 2].compound);
  if (!container.includes(".blyrics-container") || !container.some((s) => NO_LYRICS.test(s))) return null;
  if (!container.every((s) => s === ".blyrics-container" || s === "div" || NO_LYRICS.test(s))) return null;
  if (!parts.slice(0, -2).every((part) => simples(part.compound).every((s) => PAGE.test(s)))) return null;
  if (!subject.includes(".blyrics--line") || !subject.every((s) => s === ".blyrics--line" || PSEUDO.test(s))) return null;
  return subject.map((s) => PSEUDO.exec(s)?.[1]).find(Boolean) ?? "line";
}

/**
 * `--blyrics-no-lyrics-text` and `--blyrics-no-lyrics-icon` from the content a theme draws on the
 * no-lyrics line's `::after` and `::before`, with the icon's size and colour on its element and the
 * message's size and weight on the line, whose style the WebGL renderer draws it with.
 */
function noLyricsValues(rules, authored, review, cover) {
  const found = { line: {}, before: {}, after: {} };
  let order = 0;
  for (const { selector, conditional, declarations } of rules) {
    for (const [property, value, important] of declarations) {
      order++;
      for (const original of splitTopLevel(selector, ",").map((s) => s.trim())) {
        for (const one of expandIs(original)) {
          const part = noLyricsPart(one);
          if (!part) continue;
          if (conditional) {
            if (property === "content") review("This no-lyrics message applies to only some screens, so --blyrics-no-lyrics-text and -icon were not written for it. Set them under a media query of your own if they matter.", original);
            // A size the line takes on some screens is still one the block would override there.
            if (part !== "line") continue;
          }
          (found[part][property] ??= []).push({ value, important, specificity: specificity(one), order, original });
        }
      }
    }
  }

  const container = [];
  const groups = [];
  /** The text a pseudo-element's content gives: a string, "" for none, null when unreadable. */
  const read = (part, name) => {
    const all = found[part].content;
    if (!all) return "";
    const won = winner(all);
    if (/^(?:none|normal)$/.test(won.value)) {
      for (const c of all) cover(c.original, "content");
      return "";
    }
    if (cssString(won.value) === null) {
      review(`Could not read \`content: ${won.value}\` on the no-lyrics line, so ${name} was not written; set it to a CSS string by hand.`, won.original);
      return null;
    }
    // An empty string draws nothing, here and in the WebGL renderer.
    for (const c of all) cover(c.original, "content");
    if (cssString(won.value) === "") return "";
    if (authored.has(name)) {
      review(`The theme already sets ${name}, so it was left as written.`);
      return null;
    }
    container.push(`${name}: ${won.value};`);
    return won.value;
  };
  const text = read("after", "--blyrics-no-lyrics-text");
  const icon = read("before", "--blyrics-no-lyrics-icon");
  const declaration = (property, { value, important }) => `${property}: ${value}${important ? " !important" : ""};`;

  if (icon) {
    const style = ["font-size", "color"].filter((p) => found.before[p]).map((p) => declaration(p, winner(found.before[p])));
    if (style.length) groups.push({ selector: '.blyrics-container[data-no-lyrics="true"] .blyrics-no-lyrics-icon', declarations: style });
  }
  if (text) {
    const style = [];
    for (const property of ["font-size", "font-weight"]) {
      if (!found.after[property]) continue;
      const won = winner(found.after[property]);
      const where = `the no-lyrics line (\`${NO_LYRICS_LINE}\`)`;
      if (found.line[property]) {
        review(`The theme sets ${property} on ${where} already, so the message's own ${property} (\`${won.value}\`, from its \`::after\`) was not written there. The WebGL renderer draws the message with the line's style: check its ${property}.`, won.original);
      } else if (RELATIVE_FONT.test(won.value)) {
        review(`The message's ${property} (\`${won.value}\`, from its \`::after\`) is relative to the line, so it was not written onto ${where}, whose style the WebGL renderer draws the message with; set it there by hand.`, won.original);
      } else if (icon && !found.before[property]) {
        // On the current renderer the icon's `::before` would inherit it from the line.
        review(`The message's ${property} (\`${won.value}\`, from its \`::after\`) was not written onto ${where}, whose style the WebGL renderer draws the message with, because the icon's \`::before\` would take it too on the current renderer. Set ${property} on both by hand if it matters.`, won.original);
      } else {
        style.push(declaration(property, won));
      }
    }
    if (style.length) groups.push({ selector: NO_LYRICS_LINE, declarations: style });
  }
  return { container, groups };
}

// -- Letters ----------------------------------------------------------------

/** The letters the DOM renderer split a word into, or the word split into them. */
const LETTERS = /^\.blyrics--letter$|^\.blyrics-[\w-]*--lettered$/;
const HELD = /^\[data-long-word(?:=["']?true["']?)?\]$/;
const NOT_HELD = /^:not\(\[data-long-word(?:=["']?true["']?)?\]\)$/;
/** `@container style(--letters: 1) or style(--letters: 2) …`: words of so many letters. */
const LETTER_COUNT = /^@container\s+style\(\s*--letters\s*:\s*\d+\s*\)(?:\s+or\s+style\(\s*--letters\s*:\s*\d+\s*\))*$/i;

/** The comment settings (`blyrics-key = value;` inside a comment) a stylesheet declares, last one winning. */
export function commentSettings(css) {
  const out = new Map();
  for (const [, comment] of css.matchAll(/\/\*([\s\S]*?)\*\//g)) {
    for (const [, key, value] of comment.matchAll(/(blyrics-[\w-]+)\s*=\s*([^;]+);/g)) out.set(key, value.trim());
  }
  return out;
}

/** Whether a selector picks letters of held words ("held"), of the other words ("plain"), or neither (null). */
function letterScope(selector) {
  const parts = compounds(selector).map((part) => simples(part.compound));
  if (!parts.some((own) => own.some((s) => LETTERS.test(s)))) return null;
  if (parts.some((own) => own.some((s) => NOT_HELD.test(s)))) return "plain";
  return parts.some((own) => own.some((s) => HELD.test(s))) ? "held" : "letters";
}

/**
 * A theme that waves only the letters of held words wants `blyrics-letter-wave = long;`, which is
 * noted rather than written: the current renderer reads `long` as `false` and splits no word at all.
 * When it keeps that wave to words of at most N letters (with a style query on the `--letters` the
 * DOM renderer set), `blyrics-long-word-max-letters = N`, which the current renderer does not read,
 * is written. Returns the comment settings to write.
 */
function letterSettings(rules, keyframes, settings, authored, review, cover) {
  const off = [];
  const held = [];
  let everyWord = false;
  for (const { selector, conditions, declarations } of rules) {
    const own = Object.fromEntries(declarations.map(([property, value]) => [property, value]));
    const animated = animationsOf(own);
    const still = (own.animation !== undefined || own["animation-name"] !== undefined) && animated.length === 0;
    for (const original of splitTopLevel(selector, ",").map((s) => s.trim())) {
      for (const one of expandIs(original)) {
        const scope = letterScope(one);
        if (scope === "plain" && still) off.push(original);
        if (scope === "held" && animated.length > 0) held.push({ original, conditions, animated });
        // Letters waving in every word, on every screen.
        if (scope === "letters" && animated.length > 0 && conditions.length === 0) everyWord = true;
      }
    }
  }
  if (everyWord || (off.length === 0 && held.length === 0)) return [];

  // Stopping the DOM renderer's letter animation needs no more than the setting.
  for (const where of off) for (const property of ["animation", "animation-name"]) cover(where, property);
  const wave = settings.get("blyrics-letter-wave")?.toLowerCase();
  if (wave === "false") return [];
  if (wave !== "long") {
    const message = `This theme waves the letters of held words only (\`[data-long-word]\`). The WebGL renderer does that with the comment setting \`blyrics-letter-wave = long;\`, which keeps the other words in one piece. It was not written, because the current renderer reads \`long\` as \`false\` and would split no word into letters: put \`/* blyrics-letter-wave = long; */\`${wave === undefined ? "" : ` in place of the theme's \`blyrics-letter-wave = ${settings.get("blyrics-letter-wave")};\``} once the theme is for the WebGL renderer only.`;
    for (const where of [...off, ...held.map((h) => h.original)]) review(message, where);
  }

  // What the held letters' keyframes do that the renderer's wave has variables for.
  const moves = new Set();
  for (const { animated } of held) {
    for (const { name } of animated) {
      for (const { declarations } of keyframes.get(name) ?? []) {
        for (const [property, value] of declarations) {
          if (property === "translate" && !/^(?:0|0px|0em|none)$/.test(splitTopLevel(value, " ")[0].trim())) moves.add("spread");
          if (property === "transform" && /\btranslate(?:X|3d)?\(/.test(value)) moves.add("spread");
          if (property === "text-shadow" || (property === "filter" && /\bdrop-shadow\(/.test(value))) moves.add("glow");
        }
      }
    }
  }
  const variables = { spread: "`--blyrics-letter-wave-spread` (how far the outermost letters move apart at the crest)", glow: "`--blyrics-letter-wave-glow` (how much brighter each letter's glow gets at its crest)" };
  const asked = [...moves].filter((m) => !authored.has(`--blyrics-letter-wave-${m}`));
  if (asked.length > 0) {
    const message = `The keyframes this theme runs on held words' letters also ${asked.map((m) => (m === "spread" ? "move the letters apart" : "light them up")).join(" and ")}, which the WebGL renderer's wave does with ${asked.map((m) => variables[m]).join(" and ")}. Keyframes are not read, so set ${asked.length > 1 ? "them" : "it"} on \`.blyrics-container\` by hand.`;
    for (const { original } of held) review(message, original);
  }

  // The largest word the held letters wave in, when every rule for them says the same.
  const caps = new Set(held.map(({ conditions }) => {
    const query = conditions.find((c) => /^@container\b/i.test(c));
    if (!query || !LETTER_COUNT.test(query) || conditions.length > 1) return null;
    const counts = [...query.matchAll(/--letters\s*:\s*(\d+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
    return counts.every((n, i) => n === i + 1) ? counts.length : null;
  }));
  const [cap] = caps;
  if (caps.size !== 1 || !cap) return [];
  const key = "blyrics-long-word-max-letters";
  if (settings.has(key)) {
    if (settings.get(key) !== String(cap)) review(`The theme waves held words' letters only in words of up to ${cap} letters, and already sets \`${key} = ${settings.get(key)};\`, so it was left as written.`);
    return [];
  }
  return [`${key} = ${cap}`];
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

/** A colour as written, or null for what is not one (or depends on the element, such as `currentColor`). */
function cssColor(value) {
  if (/^(?:inherit|initial|unset|revert|revert-layer|currentcolor|none|auto)$/i.test(value) || /\bvar\(/.test(value)) return null;
  return /^(?:#[\da-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(.*\)|[a-z]+)$/i.test(value) ? value : null;
}

/** What a theme says the DOM renderer painted with, which the WebGL renderer does not paint. */
const PAINTS = "(it paints text, its shadows, the glow, image highlights and solid boxes behind lines and romanizations only)";
const NO_PAINT = /^(?:none|hidden|normal|initial|unset|revert|revert-layer|transparent|-?0(?:\.0+)?(?:[a-z]+|%)?)$/i;

/**
 * Whether a paint value draws nothing: `none`, `0` with or without a unit, the CSS-wide keywords,
 * `transparent`, or a border, outline or stroke of no width, no style or no colour.
 */
function drawsNothing(value) {
  const tokens = splitTopLevel(value.replace(/\s*!\s*important$/i, ""), " ").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 1) return NO_PAINT.test(tokens[0]);
  // Shadows have lengths of 0 too; a border, outline or stroke is no more than width, style and colour.
  if (tokens.length > 3 || tokens.some((t) => t.includes(",")) || /^(?:inset|-?(?:\d|\.\d))/.test(tokens[1] ?? "")) return false;
  return tokens.some((t) => /^(?:none|hidden|transparent)$/i.test(t) || /^-?0(?:\.0+)?(?:[a-z]+|%)?$/i.test(t));
}

/** Background keywords that are no colour. */
const BACKGROUND_KEYWORD = /^(?:none|repeat|no-repeat|repeat-x|repeat-y|space|round|scroll|fixed|local|center|top|bottom|left|right|border-box|padding-box|content-box|text|auto|cover|contain)$/i;

/**
 * The colour a `background` or `background-color` fills with: "transparent" when it draws nothing,
 * undefined when it draws an image, null when it cannot be read.
 */
function backgroundFill(property, value) {
  if (/\b(?:url|image|image-set|cross-fade|element|paint|[\w-]*gradient)\(/i.test(value)) return undefined;
  if (property === "background-color") return /\bvar\(/.test(value) && !/^var\([^()]*\)$/.test(value) ? null : /^var\(/.test(value) ? value : cssColor(value);
  // The shorthand sets the colour too: to transparent when it names none.
  if (/\bvar\(/.test(value) || splitTopLevel(value, ",").length > 1 || /^(?:inherit|initial|unset|revert|revert-layer)$/i.test(value)) return null;
  const tokens = splitTopLevel(value, " ").flatMap((t) => (t.includes("(") ? [t] : t.split("/")));
  const colours = tokens.map((t) => t.trim()).filter((t) => t && !BACKGROUND_KEYWORD.test(t) && !/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[a-z]+|%)?$/i.test(t));
  if (colours.length === 0) return "transparent";
  return colours.length === 1 ? cssColor(colours[0]) : null;
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
