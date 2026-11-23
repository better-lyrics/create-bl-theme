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
// The one effect almost every theme builds that way, fading and blurring lines
// by where they are relative to the sung one, has a variable form:
// `--blyrics-line-opacity[-before|-after]` and `--blyrics-line-blur[-before|-after]`,
// lists of values for the sung line, then 1, 2, 3... lines away. This pass
// reads the theme's line rules and writes those lists, which the current DOM
// renderer ignores, so the theme keeps working on both.
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
};

/** `text` without the block an earlier run wrote, its lines kept. What is to be compiled and read. */
export function withoutBlock(text) {
  return text.replace(BLOCK, (block) => block.replace(/[^\n]/g, " "));
}

/**
 * Returns { output, changes, flags, unsupported } for `source`, given the CSS `withoutBlock(source)`
 * compiles to (the source itself for a .css theme). `changes` and `flags` are in the shape
 * migrateSource uses.
 */
export function migrateForWebgl(source, css) {
  const changes = [];
  const flags = [];
  const unsupported = [];
  const rules = parseRules(withoutBlock(css));
  const customs = customProperties(rules);
  const authored = new Set(rules.flatMap((rule) => rule.declarations.map(([name]) => name)));
  const review = (message, where = null) => flags.push({ line: where, code: "review", message });

  // 1. Distance effects and the hovered line, written as variables.
  const candidates = lineCandidates(rules, customs, review);
  const written = [...distanceLists(candidates, authored, review), ...hoverValues(candidates, authored, review)];
  const { output, change } = withBlock(source, written);
  if (change) changes.push(change);

  // 2. What line rules do that the renderer cannot see. Read from the compiled CSS, where RICS
  //    nesting is flattened, so each finding names its full selector.
  for (const { selector, declarations } of rules) {
    for (const one of splitTopLevel(selector, ",")) {
      for (const [property, value] of declarations) classify(one.trim(), property, value);
    }
  }
  function classify(selector, property, value) {
    const line = selector;
    if (!LYRIC_SUBJECT.test(selector)) return;
    // The footer and the buttons are ordinary DOM beside the lines.
    if (compounds(selector).some((part) => /^\.blyrics-(?:footer|no-lyrics)|\.blyrics-footer/.test(withoutArguments(part.compound)))) return;
    const pseudo = /::?(?:before|after)\b/.test(selector);
    const word = /\.blyrics--word\b|\.blyrics--letter\b|\.blyrics-word-highlight\b/.test(lastCompound(selector));
    const otherFilter = property === "filter" && /\b(?:brightness|contrast|saturate|grayscale|sepia|hue-rotate|invert|drop-shadow)\s*\(/.test(value);

    if (compounds(selector).some((part) => isHovered(part.compound)) && /^(?:opacity|filter|transform|scale|color|background|text-shadow)/.test(property)) {
      const line_ = expandIs(selector).map(hoveredLine).find(Boolean);
      if (!line_) {
        unsupported.push({ line, code: "hover", message: "Hover effects other than on the hovered line itself (for example dimming the other lines while the mouse is over the lyrics) do not show in the WebGL renderer." });
      } else if (otherFilter || !/^(?:opacity|filter|transform|scale)$/.test(property)) {
        unsupported.push({ line, code: "hover", message: `\`${property}\` on a hovered line does not show. The line under the mouse can only change its opacity, blur and scale (\`--blyrics-line-hover-opacity\`, \`-blur\`, \`-scale\`).` });
      }
      return;
    }
    if (pseudo && property === "content") {
      unsupported.push({ line, code: "pseudo-content", message: "`::before` / `::after` content on lyric elements is not drawn by the WebGL renderer." });
      return;
    }
    switch (property) {
      case "opacity":
      case "filter":
        if (word) {
          unsupported.push({ line, code: "word-opacity", message: "Opacity or filters on single words are not drawn. Words are shown in `--blyrics-lyric-inactive-color` until sung and `--blyrics-lyric-active-color` once sung, which can carry an alpha." });
        } else if (otherFilter) {
          unsupported.push({ line, code: "line-filter", message: "Line filters other than `blur()` are not drawn by the WebGL renderer." });
        } else {
          flags.push({ line, code: "line-opacity", message: "Opacity and blur on lines are not drawn by the WebGL renderer: it fades and blurs lines from `--blyrics-line-opacity[-before|-after]` and `--blyrics-line-blur[-before|-after]` instead (written above where this theme's rules could be read). The rule can stay for the current renderer." });
        }
        return;
      case "transform":
      case "scale":
      case "translate":
      case "rotate":
        flags.push({ line, code: "line-transform", message: "Transforms on lyric elements are not drawn. The sung line's size is `--blyrics-active-scale` and the others' `--blyrics-scale`; words move with the `--blyrics-word-wobble-transform-*` and `--blyrics-letter-wave-*` variables. Rotations and skews have no equivalent." });
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
      case "text-shadow":
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
        unsupported.push({ line, code: "paint", message: `\`${property}\` on lyric elements is not drawn by the WebGL renderer (it paints text, the glow and image highlights only).` });
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

  return { output, changes, flags: group(flags), unsupported: group(unsupported) };
}

// -- The block -------------------------------------------------------------

function withBlock(source, written) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const existing = BLOCK.exec(source);
  const at = existing ? lineOf(source, existing.index) : 0;
  if (written.length === 0) {
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
    "/* This theme's line opacity, blur and hover rules as the WebGL renderer reads them: lines fade",
    "   and blur by their distance from the sung line, and the line under the mouse takes the hover",
    "   values. The current renderer ignores these and keeps using the rules. */",
    ".blyrics-container {",
    ...written.map((d) => `  ${d}`),
    "}",
    BLOCK_END,
  ].join(newline);
  if (existing?.[0] === block) return { output: source, change: null };
  // In place, so what the author added after the block stays after it.
  const output = existing ? source.replace(BLOCK, () => block) : `${source.trimEnd()}${newline}${newline}${block}${newline}`;
  const names = written.map((d) => d.split(":")[0]);
  const hover = names.some((name) => name.includes("-hover-"));
  return {
    output,
    change: {
      line: lineOf(output, output.indexOf(BLOCK_BEGIN)),
      code: "distance-lists",
      message: `${existing ? "Updated" : "Added"} ${names.join(", ")} from the theme's line rules. Watch a synced song to check the fade${hover ? " and the hover" : ""} match.`,
    },
  };
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

/** Whether a container compound holds for every synced song at rest. */
function isContainerAtRest(compound) {
  return simples(compound).every((simple) => {
    if (/^(?:div|\.blyrics-container|\[data-sync\]|\[data-loader-visible=["']?false["']?\])$/.test(simple)) return true;
    const not = argumentsOf(simple, "not");
    if (not) return not.flatMap((arg) => expandIs(arg)).every((arg) => compounds(arg).length === 1 && simples(arg).some((s) => NOT_AT_REST.test(s)));
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
 * The lines a selector picks relative to the sung line, as distance ranges on each side (0 is the
 * sung line itself); SCOPED when it picks only some; null when it is no rule about lines at rest.
 */
function lineRole(selector) {
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

/** The selector without the `:hover` on its subject, when that is a line, or null. */
function hoveredLine(selector) {
  const parts = compounds(selector);
  if (parts.length === 0 || parts.slice(0, -1).some((part) => isHovered(part.compound))) return null;
  const subject = simples(parts[parts.length - 1].compound);
  if (!subject.includes(":hover")) return null;
  const rest = subject.filter((s) => s !== ":hover").join("") || "*";
  const without = [...parts.slice(0, -1), { combinator: parts[parts.length - 1].combinator, compound: rest }]
    .map((part) => `${part.combinator} ${part.compound}`.trim())
    .join(" ");
  return lineRole(without) ? without : null;
}

// -- The cascade on lines --------------------------------------------------

/** Every opacity, blur and scale a rule gives lines, with where it applies and what it weighs. */
function lineCandidates(rules, customs, review) {
  const out = { opacity: [], blur: [], scale: [], visibility: [], "pointer-events": [] };
  let order = 0;
  for (const { selector, conditional, declarations } of rules) {
    for (const [property, raw, important] of declarations) {
      order++;
      const kind = { opacity: "opacity", filter: "blur", transform: "scale", scale: "scale", visibility: "visibility", "pointer-events": "pointer-events" }[property];
      if (!kind) continue;
      const hit = kind === "visibility" || kind === "pointer-events"; // whether a line can be hovered at all
      const value = resolve(raw, customs);
      for (const original of splitTopLevel(selector, ",").map((s) => s.trim())) {
        for (const one of expandIs(original)) {
          const hovered = hoveredLine(one);
          if (hit && hovered) continue;
          if (kind === "scale" && !hovered) {
            // At rest the renderer scales lines itself; only a transform that beats a hover matters.
            if (!important) continue;
          }
          const role = lineRole(hovered ?? one);
          if (!role) continue;
          if (role.scoped || conditional) {
            if (!hit && (kind !== "scale" || hovered)) {
              review(
                "These opacity, blur or hover rules apply to only some screens, views or lines, so they were left out of the generated values, which apply to every line. Set the variables under a selector or media query of your own if they matter.",
                original
              );
            }
            continue;
          }
          const parsed = hit ? value : kind === "scale" ? (property === "scale" ? parseScaleNumber(value) : parseScale(value)) : KINDS[kind].parse(value);
          out[kind].push({ ...role, hovered: !!hovered, value: parsed, raw: `${property}: ${raw}`, selector: original, important, specificity: specificity(original), order });
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
      review(`Could not read \`${unreadable.raw}\`, so no --blyrics-line-${kind} list was written; set it by hand.`, unreadable.selector);
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
    // Past the point where lines are fully transparent, their blur does not matter.
    for (const side of ["before", "after"]) {
      const { [side]: opacity } = lists.opacity;
      if (!lists.blur || opacity[opacity.length - 1] !== "0") continue;
      lists.blur[side] = trimTail(lists.blur[side].slice(0, opacity.length - 1));
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

// -- Values ----------------------------------------------------------------

/** The theme's own custom properties as the container inherits them, where they always hold. */
function customProperties(rules) {
  const found = new Map();
  rules.forEach(({ selector, conditional, declarations }, order) => {
    if (conditional) return;
    for (const one of splitTopLevel(selector, ",").map((s) => s.trim())) {
      // The nearer element's value is the inherited one, whatever the specificity.
      const near = { ":root": 1, html: 1, body: 2, "*": 3, ".blyrics-container": 3 }[one];
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

function resolve(value, customs) {
  let v = value;
  for (let depth = 0; depth < 8 && v.includes("var(") && v.length < 2000; depth++) {
    v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (m, name, fallback) => customs.get(name) ?? fallback?.trim() ?? m);
  }
  return v.trim();
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
