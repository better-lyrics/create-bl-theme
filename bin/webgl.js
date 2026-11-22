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
// renderer ignores, so the theme keeps working on both. Everything else is
// flagged: with its variable replacement where there is one, and as not
// possible yet where there is none, so the author can ask for it.
//
// The full mapping is in skills/MIGRATION.md.
// ---------------------------------------------------------------------------

export const DISCORD_URL = "https://discord.gg/UsHE3d5fWF";

const BLOCK_BEGIN = "/* create-bl-theme migrate: WebGL renderer (begin) */";
const BLOCK_END = "/* create-bl-theme migrate: WebGL renderer (end) */";

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

/**
 * Returns { output, changes, flags, unsupported } for `source`, given the CSS it compiles to (the
 * source itself for a .css theme). `changes` and `flags` are in the shape migrateSource uses.
 */
export function migrateForWebgl(source, css) {
  const changes = [];
  const flags = [];
  const unsupported = [];
  const rules = parseRules(stripComments(css));
  const customs = customProperties(rules);

  // 1. Distance effects and the hovered line, written as variables.
  const lists = distanceLists(rules, customs);
  const hover = hoverValues(rules, customs);
  const written = [...lists.declarations, ...hover.declarations];
  let output = removeBlock(source);
  if (written.length > 0) {
    const block = [
      BLOCK_BEGIN,
      "/* This theme's line opacity, blur and hover rules as the WebGL renderer reads them: lines fade",
      "   and blur by their distance from the sung line, and the line under the mouse takes the hover",
      "   values. The current renderer ignores these and keeps using the rules. */",
      ".blyrics-container {",
      ...written.map((d) => `  ${d}`),
      "}",
      BLOCK_END,
    ].join("\n");
    output = `${output.trimEnd()}\n\n${block}\n`;
    changes.push({
      line: lineOf(output, output.indexOf(BLOCK_BEGIN)),
      code: "distance-lists",
      message: `Added ${written.map((d) => d.split(":")[0]).join(", ")} from the theme's line rules. Watch a synced song to check the fade${hover.declarations.length ? " and the hover" : ""} match.`,
    });
  }
  for (const note of [...lists.notes, ...hover.notes]) flags.push({ line: null, code: "distance-review", message: note });

  // 2. What line rules do that the renderer cannot see. Read from the compiled CSS, where RICS
  //    nesting is flattened, so each finding names its full selector.
  for (const { selector, body } of rules) {
    for (const [property, value] of declarations(body)) {
      for (const one of splitTopLevel(selector, ",")) classify(one.trim(), property, value);
    }
  }
  function classify(selector, property, value) {
    const line = selector;
    if (!LYRIC_SUBJECT.test(selector)) return;
    const hover = /:hover\b/.test(selector);
    const pseudo = /::?(?:before|after)\b/.test(selector);
    const word = /\.blyrics--word\b|\.blyrics--letter\b|\.blyrics-word-highlight\b/.test(lastCompound(selector));

    if (hover) {
      // A hovered line's opacity, blur and scale are written as variables (above).
      if (/^(?:opacity|filter|transform|scale)$/.test(property) && hoveredLine(selector)) return;
      if (/^(?:opacity|filter|transform|scale|color|background|text-shadow)/.test(property)) {
        unsupported.push({ line, code: "hover", message: hoveredLine(selector) ? `\`${property}\` on a hovered line does not show. The line under the mouse can only change its opacity, blur and scale (\`--blyrics-line-hover-opacity\`, \`-blur\`, \`-scale\`).` : "Hover effects other than on the hovered line itself (for example dimming the other lines while the mouse is over the lyrics) do not show in the WebGL renderer." });
        return;
      }
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
        } else if (property === "filter" && /\b(?:brightness|contrast|saturate|grayscale|sepia|hue-rotate|invert|drop-shadow)\s*\(/.test(value)) {
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
  const text = stripCommentsKeepingLines(output.replace(blockPattern(), ""));
  for (const dead of DEAD_VARIABLES) {
    for (const m of text.matchAll(dead.pattern)) flags.push({ line: `L${lineOf(text, m.index)}`, code: "dead-var", message: dead.message });
  }

  return { output, changes, flags: group(flags), unsupported: group(unsupported) };
}

// -- Distance lists --------------------------------------------------------

/**
 * The lines a selector picks relative to the sung line, as distance ranges on each side (0 is the
 * sung line itself), or null when it is not a plain line rule this pass can read.
 */
function lineRole(selector) {
  const parts = compounds(selector);
  if (parts.length === 0) return null;
  const subject = parts[parts.length - 1].compound;
  if (/::?(?:before|after)\b/.test(subject)) return null;
  if (/:hover\b/.test(selector)) return null;
  // Effects ease off while the reader scrolls; rules for that state are the renderer's to make.
  if (parts.some((p) => hasPositive(p.compound, /\.blyrics-user-scrolling\b/))) return null;
  // Unsynced lyrics have no sung line; the renderer leaves them plain.
  if (/data-sync\s*=\s*["']?none/.test(selector) && !/:not\(\s*\[data-sync/.test(selector)) return null;
  // Rules about one word's state, the loader or the empty view are not about lines' distance.
  if (/data-word-state|data-no-lyrics|data-loader|\[data-layout|\.blyrics--(?:paused|instrumental)\b/.test(selector)) return null;

  // Ancestors are the page's or the renderer's: a rule nested under some menu is not about lyrics.
  if (parts.slice(0, -1).some((p) => (p.compound.replace(/:(?:not|has|is|where)\((?:[^()]|\([^()]*\))*\)/g, "").match(/\.[\w-]+/g) || []).some((c) => !c.startsWith(".blyrics")))) return null;
  // A line is `.blyrics--line`, a child of the container, or a sibling of either.
  const lineish = (i) =>
    /\.blyrics--(?:line|active|animating)\b/.test(parts[i].compound) ||
    (i > 0 && parts[i].combinator === ">" && /\.blyrics-container\b/.test(parts[i - 1].compound));
  let anchor = parts.length - 1;
  while (anchor > 0 && (parts[anchor].combinator === "+" || parts[anchor].combinator === "~")) anchor--;
  const isLine =
    /\.blyrics--line\b/.test(subject) ||
    (/^(?:div|\*|:not|:has|:is|\.blyrics--(?:active|animating))/.test(subject) && lineish(anchor));
  if (!isLine) return null;
  // A line has no other class of the renderer's (the footer, the loader and credits sit beside them).
  const strippedSubject = subject.replace(/:(?:not|has|is|where)\((?:[^()]|\([^()]*\))*\)/g, "");
  if ((strippedSubject.match(/\.blyrics-[\w-]+/g) || []).some((c) => !/^\.blyrics--(?:line|active|animating)$/.test(c))) return null;

  const STATE = /\.blyrics--(?:active|animating)\b/;
  const all = [0, Infinity];
  if (hasPositive(subject, STATE)) return { before: [0, 0], after: [0, 0] };
  const before = /:has\(\s*([+~])[^)]*\.blyrics--(?:active|animating)/.exec(subject);
  if (before) return { before: before[1] === "+" ? [1, 1] : [1, Infinity], after: null };

  // An earlier compound in the sung state, then sibling combinators down to this line.
  for (let i = parts.length - 2; i >= 0; i--) {
    if (!hasPositive(parts[i].compound, STATE)) continue;
    const between = parts.slice(i + 1).map((p) => p.combinator);
    if (between.some((c) => c !== "+" && c !== "~")) return null;
    const steps = between.filter((c) => c === "+").length;
    if (!between.includes("~")) return { before: null, after: [steps, steps] };
    return { before: null, after: [Math.max(1, steps + (between[0] === "~" ? 1 : 0)), Infinity] };
  }
  // Every line, or every line but the sung one, or but those on one side of it.
  const notAfter = /:not\([^)]*\.blyrics--(?:active|animating)\s*~/.test(subject);
  const notBefore = /:not\(\s*:has\(\s*~[^)]*\.blyrics--(?:active|animating)/.test(subject);
  const notSung = /:not\(\s*(?::is\()?[^)~]*\.blyrics--(?:active|animating)\s*[,)]/.test(subject);
  const first = notSung ? 1 : 0;
  return { before: notBefore ? null : [first, Infinity], after: notAfter ? null : [first, Infinity] };
}

/**
 * The selector without the `:hover` on its subject, when it picks the hovered line itself (any
 * line, not one in a given state), or null.
 */
function hoveredLine(selector) {
  const parts = compounds(selector);
  if (parts.length === 0) return null;
  const subject = parts[parts.length - 1].compound;
  if (!/:hover\b/.test(subject) || parts.slice(0, -1).some((p) => /:hover\b/.test(p.compound))) return null;
  const without = selector.replace(/:hover\b(?![\s\S]*:hover\b)/, "");
  const role = lineRole(without);
  if (!role) return null;
  const all = (range) => range && range[0] === 0 && range[1] === Infinity;
  return all(role.before) && all(role.after) ? without : null;
}

/** The hovered line's opacity, blur and scale, as `--blyrics-line-hover-*` declarations. */
function hoverValues(rules, customs) {
  const found = { opacity: [], blur: [], scale: [] };
  const notes = [];
  let order = 0;
  for (const { selector, body } of rules) {
    const declared = resolved(declarations(body), customs);
    for (const one of splitTopLevel(selector, ",").flatMap((s) => expandIs(s.trim()))) {
      if (!hoveredLine(one)) continue;
      const meta = { specificity: specificity(one), order: order++ };
      const add = (kind, raw, value) => {
        if (raw === undefined) return;
        if (value === null) {
          notes.push(`Could not read \`${raw}\` on \`${one}\` into \`--blyrics-line-hover-${kind}\`; set it by hand.`);
          return;
        }
        found[kind].push({ ...meta, value, important: /!important/.test(raw) });
      };
      add("opacity", declared.get("opacity"), declared.has("opacity") ? parseOpacity(declared.get("opacity")) : null);
      add("blur", declared.get("filter"), declared.has("filter") ? parseBlur(declared.get("filter")) : null);
      const transform = declared.get("transform");
      if (transform !== undefined) add("scale", transform, parseScale(transform));
      const scale = declared.get("scale");
      if (scale !== undefined) add("scale", scale, parseOpacity(scale));
    }
  }
  const out = [];
  for (const kind of ["opacity", "blur", "scale"]) {
    const value = winner(found[kind]);
    if (value !== undefined) out.push(`--blyrics-line-hover-${kind}: ${value};`);
  }
  return { declarations: out, notes: [...new Set(notes)] };
}

/** The uniform scale of a transform made only of `scale(n)`, `none` meaning 1. */
function parseScale(value) {
  const v = value.replace(/!important/, "").trim();
  if (v === "none") return "1";
  const m = /^scale\(\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (!m || (m[2] !== undefined && m[2] !== m[1])) return null;
  return trimNumber(Number.parseFloat(m[1]));
}

/** Custom properties the theme sets on the page or the container, by name; the last one wins. */
function customProperties(rules) {
  const out = new Map();
  for (const { selector, body } of rules) {
    if (!splitTopLevel(selector, ",").some((s) => /^(?::root|html|body|\*|\.blyrics-container)$/.test(s.trim()))) continue;
    for (const part of splitTopLevel(body, ";")) {
      const i = part.indexOf(":");
      const name = i < 0 ? "" : part.slice(0, i).trim();
      if (name.startsWith("--")) out.set(name, part.slice(i + 1).trim());
    }
  }
  return out;
}

/** `declared` with `var()` references to the theme's own custom properties filled in. */
function resolved(declared, customs) {
  const out = new Map();
  for (const [name, value] of declared) {
    let v = value;
    for (let depth = 0; depth < 5 && /var\(/.test(v); depth++) {
      v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (m, ref, fallback) => customs.get(ref) ?? fallback?.trim() ?? m);
    }
    out.set(name, v);
  }
  return out;
}

function distanceLists(rules, customs) {
  const candidates = { opacity: [], blur: [] };
  const notes = [];
  let order = 0;
  for (const { selector, body } of rules) {
    const declared = resolved(declarations(body), customs);
    const opacity = declared.get("opacity");
    const filter = declared.get("filter");
    if (opacity === undefined && filter === undefined) continue;
    for (const one of splitTopLevel(selector, ",").flatMap((s) => expandIs(s.trim()))) {
      const role = lineRole(one);
      if (!role) continue;
      const add = (kind, raw, parse) => {
        if (raw === undefined) return;
        const value = parse(raw);
        if (value === null) {
          notes.push(`Could not read \`${kind === "blur" ? "filter" : "opacity"}: ${raw}\` on \`${one}\` into a distance list; set that value in the lists by hand.`);
          return;
        }
        candidates[kind].push({ ...role, value, important: /!important/.test(raw), specificity: specificity(one), order: order++ });
      };
      add("opacity", opacity, parseOpacity);
      add("blur", filter, parseBlur);
    }
  }

  const lists = {};
  for (const [kind, rest] of [["opacity", "1"], ["blur", "0"]]) {
    lists[kind] = { before: sideList(candidates[kind], "before", rest), after: sideList(candidates[kind], "after", rest) };
  }
  // A sung line the rules make invisible means the theme shows lyrics some other way (through
  // per-word rules, say), which the renderer cannot draw; the lists would only hide everything.
  if (Number(lists.opacity.after[0]) < 0.05) {
    notes.push("This theme's line rules leave even the sung line transparent, so it shows lyrics through per-word or other rules the WebGL renderer does not draw. No distance lists were written: decide how lines should look with `--blyrics-line-opacity` / `--blyrics-line-blur` by hand.");
    return { declarations: [], notes: [...new Set(notes)] };
  }
  // Past the point where lines are fully transparent, their blur does not matter.
  for (const side of ["before", "after"]) {
    const op = lists.opacity[side];
    if (op.length > 1 && op[op.length - 1] === "0") {
      const gone = op.length - 1;
      const blur = lists.blur[side];
      if (blur.length > gone) lists.blur[side] = trimTail(blur.slice(0, gone));
    }
  }

  const out = [];
  for (const [kind, rest] of [["opacity", "1"], ["blur", "0"]]) {
    const { before, after } = lists[kind];
    const name = `--blyrics-line-${kind}`;
    const plain = (list) => list.length === 1 && list[0] === rest;
    if (plain(before) && plain(after)) continue;
    if (before.join(" ") === after.join(" ")) out.push(`${name}: ${after.join(" ")};`);
    else {
      if (!plain(before)) out.push(`${name}-before: ${before.join(" ")};`);
      if (!plain(after)) out.push(`${name}-after: ${after.join(" ")};`);
    }
  }
  return { declarations: out, notes: [...new Set(notes)] };
}

/** The values for the sung line, then 1, 2, 3... lines to one side, as the cascade picks them. */
function sideList(candidates, side, rest) {
  const ranges = candidates.filter((c) => c[side]);
  const covering = (d) => ranges.filter((c) => d >= c[side][0] && d <= c[side][1]);
  const sung = candidates.filter((c) => (c.before && c.before[0] === 0) || (c.after && c.after[0] === 0));
  const reach = Math.max(0, ...ranges.flatMap((c) => [c[side][0], c[side][1] === Infinity ? c[side][0] : c[side][1]]));
  const list = [winner(sung) ?? rest];
  for (let d = 1; d <= reach + 1; d++) list.push(winner(covering(d)) ?? rest);
  return trimTail(list);
}

function winner(candidates) {
  let best = null;
  for (const c of candidates) {
    if (!best || compare(c, best) >= 0) best = c;
  }
  return best?.value;
}

function compare(a, b) {
  if (a.important !== b.important) return a.important ? 1 : -1;
  for (let i = 0; i < 3; i++) if (a.specificity[i] !== b.specificity[i]) return a.specificity[i] - b.specificity[i];
  return a.order - b.order;
}

function trimTail(list) {
  const out = [...list];
  while (out.length > 1 && out[out.length - 1] === out[out.length - 2]) out.pop();
  return out;
}

/** Each alternative of the first `:is()` / `:where()` outside `:not()`, substituted in place. */
function expandIs(selector, depth = 0) {
  if (depth > 4) return [selector];
  const match = /:(is|where)\(/g;
  let m;
  while ((m = match.exec(selector))) {
    if (insideNot(selector, m.index)) continue;
    const open = m.index + m[0].length;
    const close = matchingParen(selector, open - 1);
    if (close < 0) return [selector];
    const before = selector.slice(0, m.index);
    const after = selector.slice(close + 1);
    // A complex alternative (with combinators) only stands in for a whole compound.
    const wholeCompound = /(?:^|[\s>+~])$/.test(before) && /^(?:$|[\s>+~,])/.test(after);
    const args = splitTopLevel(selector.slice(open, close), ",").map((a) => a.trim());
    if (args.some((a) => compounds(a).length > 1) && !wholeCompound) return [selector];
    return args.flatMap((arg) => expandIs(`${before}${arg}${after}`, depth + 1));
  }
  return [selector];
}

function insideNot(text, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (text[i] === ")") depth++;
    else if (text[i] === "(") {
      if (depth === 0) return /:(?:not|has)$/.test(text.slice(0, i));
      depth--;
    }
  }
  return false;
}

function matchingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** [ids, classes/attributes/pseudo-classes, types] of a complex selector. */
function specificity(selector) {
  const out = [0, 0, 0];
  let rest = selector;
  // :is/:not/:has count as their most specific argument; :where counts nothing.
  rest = rest.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, "");
  rest = rest.replace(/:(?:is|not|has)\(((?:[^()]|\([^()]*\))*)\)/g, (_m, args) => {
    const best = splitTopLevel(args, ",").map((a) => specificity(a.trim())).sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0] ?? [0, 0, 0];
    for (let i = 0; i < 3; i++) out[i] += best[i];
    return " ";
  });
  out[0] += (rest.match(/#[\w-]+/g) || []).length;
  out[1] += (rest.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
  out[2] += (rest.match(/(?:^|[\s>+~])[a-z][\w-]*|::[\w-]+/gi) || []).length;
  return out;
}

function parseOpacity(value) {
  const v = value.replace(/!important/, "").trim();
  if (/^-?[\d.]+%$/.test(v)) return trimNumber(Number.parseFloat(v) / 100);
  if (/^-?[\d.]+$/.test(v)) return trimNumber(Number.parseFloat(v));
  return null;
}

function parseBlur(value) {
  const v = value.replace(/!important/, "").trim();
  if (v === "none") return "0";
  const blur = /blur\(\s*([\d.]+)([a-z]*)\s*\)/.exec(v);
  if (!blur) return /^[a-z-]+\(/.test(v) ? "0" : null;
  const n = Number.parseFloat(blur[1]);
  if (n === 0) return "0";
  // The renderer's lists take px and rem; an em blur depends on the line's font size.
  if (blur[2] !== "" && blur[2] !== "px" && blur[2] !== "rem") return null;
  return `${trimNumber(n)}${blur[2] || "px"}`;
}

function trimNumber(n) {
  return String(Math.round(n * 1000) / 1000);
}

// -- CSS reading ------------------------------------------------------------

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripCommentsKeepingLines(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** Innermost `selector { body }` blocks: flat rules, including those inside @media and nesting parents' children. */
function parseRules(css) {
  const rules = [];
  for (const m of css.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (!selector || selector.startsWith("@") || /^(?:from|to|[\d.]+%)(?:\s*,\s*(?:from|to|[\d.]+%))*$/.test(selector)) continue;
    rules.push({ selector: selector.replace(/\s+/g, " "), body: m[2] });
  }
  return rules;
}

function declarations(body) {
  const out = new Map();
  for (const part of splitTopLevel(body, ";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const name = part.slice(0, i).trim().toLowerCase();
    if (!name || name.startsWith("--") || name.startsWith("$")) continue;
    out.set(name, part.slice(i + 1).trim());
  }
  return out;
}

function splitTopLevel(text, separator) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === separator && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** The compounds of a complex selector, each with the combinator before it (" " for descendant). */
function compounds(selector) {
  const out = [];
  let depth = 0;
  let current = "";
  let combinator = null;
  const flush = () => {
    if (current.trim()) out.push({ combinator: combinator ?? "", compound: current.trim() });
    current = "";
  };
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && (ch === ">" || ch === "+" || ch === "~")) {
      flush();
      combinator = ch;
      continue;
    }
    if (depth === 0 && /\s/.test(ch)) {
      if (current.trim()) {
        flush();
        combinator = " ";
      }
      continue;
    }
    current += ch;
  }
  flush();
  if (out.length > 0) out[0].combinator = "";
  return out;
}

function lastCompound(selector) {
  const parts = compounds(selector);
  return parts.length ? parts[parts.length - 1].compound : "";
}

/** Whether `compound` matches `pattern` itself, not only inside a `:not(...)` or `:has(...)`. */
function hasPositive(compound, pattern) {
  let stripped = compound;
  let previous;
  do {
    previous = stripped;
    stripped = stripped.replace(/:(?:not|has)\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "");
  } while (stripped !== previous);
  return pattern.test(stripped);
}

// -- Bookkeeping ----------------------------------------------------------

function blockPattern() {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\n*${escape(BLOCK_BEGIN)}[\\s\\S]*?${escape(BLOCK_END)}\\n?`, "g");
}

function removeBlock(source) {
  return source.replace(blockPattern(), "\n");
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
