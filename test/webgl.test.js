// migrate edits other people's themes, so it must write only what the cascade says, and leave a
// note for the rest.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { migrateForWebgl } from "../bin/webgl.js";

const CLI = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
const LINE = ".blyrics-container > .blyrics--line";
const SUNG = ".blyrics-container > .blyrics--active";

function migrate(css) {
  const result = migrateForWebgl(css, css);
  const rules = blockRules(result.output);
  const written = Object.fromEntries(Object.entries(rules[".blyrics-container"] ?? {}).filter(([name]) => name.startsWith("--blyrics-line-")).map(([name, value]) => [name.slice("--blyrics-line-".length), value]));
  return { ...result, written, rules };
}

/** The block's rules, as { selector: { name: value } }. */
function blockRules(output) {
  const block = output.match(/\/\* create-bl-theme migrate: WebGL renderer \(begin\)[\s\S]*?WebGL renderer \(end\) \*\//)?.[0] ?? "";
  const rules = {};
  for (const [, selector, body] of block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules[selector.trim()] = Object.fromEntries([...body.matchAll(/(--[\w-]+): ([^;]*);/g)].map((m) => [m[1], m[2]]));
  }
  return rules;
}

/** Nothing written, and the author told. */
function assertLeftToAuthor(css) {
  const { written, flags } = migrate(css);
  assert.deepEqual(written, {}, css);
  assert.ok(flags.some((flag) => flag.code === "review"), `expected a note: ${css}`);
}

function runCli(name, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "create-bl-theme-"));
  try {
    const file = path.join(dir, name);
    fs.writeFileSync(file, source);
    const { stdout, status } = spawnSync(process.execPath, [CLI, "migrate", file, "--write"], { encoding: "utf8" });
    return { output: fs.readFileSync(file, "utf8"), stdout, status };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("lines dimmed around the sung one become one list", () => {
  assert.deepEqual(migrate(`${LINE} { opacity: .4 } ${SUNG} { opacity: 1 }`).written, { opacity: "1 0.4" });
});

test("a chain of siblings is one value a line", () => {
  const css = `${SUNG} + .blyrics--line { filter: blur(2px) } ${SUNG} + .blyrics--line + .blyrics--line { filter: blur(4px) }`;
  assert.deepEqual(migrate(css).written, { "blur-after": "0 2px 4px 0" });
});

test("each + and ~ is at least a line further away", () => {
  for (const chain of ["+ div ~ div", "~ div ~ div", "~ div + div"]) {
    assert.deepEqual(migrate(`${SUNG} ${chain} { opacity: .5 }`).written, { "opacity-after": "1 1 0.5" }, chain);
  }
});

test(":has chains count lines before the sung one", () => {
  assert.deepEqual(migrate(`${LINE}:has(+ .blyrics--line + .blyrics--active) { opacity: .5 }`).written, { "opacity-before": "1 1 0.5 1" });
  assert.deepEqual(migrate(`${LINE}:has(~ .blyrics--active) { opacity: 0 }`).written, { "opacity-before": "1 0" });
});

test(":is takes the specificity of its most specific argument", () => {
  const css = `.blyrics-container > :is(.blyrics--active, #never) { opacity: 1 } .blyrics-container > .blyrics--line.blyrics--active { opacity: .2 } ${LINE}:not(.blyrics--active) { opacity: .5 }`;
  assert.deepEqual(migrate(css).written, { opacity: "1 0.5" });
});

test("an unreadable value leaves that list to the author", () => {
  for (const value of ["blur(var(--unknown))", "blur(calc(1em + 2px))", "var(--unknown)", "blur(0.2em)"]) {
    assertLeftToAuthor(`${LINE}:not(.blyrics--active) { filter: ${value} }`);
  }
  assertLeftToAuthor(`${LINE}:not(.blyrics--active) { opacity: var(--unknown) }`);
});

test("one unreadable line does not become a list without it", () => {
  assertLeftToAuthor(`${LINE}:not(.blyrics--active) { filter: blur(var(--unknown)) } ${SUNG} + .blyrics--line { filter: blur(2px) }`);
});

test("an unreadable value that loses the cascade does not matter", () => {
  const css = `${LINE}:not(.blyrics--active) { opacity: var(--unknown) } ${LINE}:not(.blyrics--active) { opacity: .3 }`;
  assert.deepEqual(migrate(css).written, { opacity: "1 0.3" });
});

test("a theme's own custom properties are filled in", () => {
  const css = `:root { --dim: .3 } ${LINE}:not(.blyrics--active) { opacity: var(--dim) }`;
  assert.deepEqual(migrate(css).written, { opacity: "1 0.3" });
});

test("rules for only some screens are not made global", () => {
  assertLeftToAuthor(`@media (max-width: 600px) { ${LINE}:not(.blyrics--active) { opacity: .2 } }`);
  const css = `:root { --dim: .5 } @media (max-width: 600px) { :root { --dim: .1 } } ${LINE}:not(.blyrics--active) { opacity: var(--dim) }`;
  assert.deepEqual(migrate(css).written, { opacity: "1 0.5" });
});

test("rules for only some views are not made global", () => {
  for (const scope of ["#layout[player-fullscreened]", ".blyrics-pip-shell", "ytmusic-player-page[video-mode]", "#blyrics-karaoke"]) {
    assertLeftToAuthor(`${scope} ${LINE}:not(.blyrics--active) { opacity: .2 }`);
  }
});

test("rules for only some lines are not made global", () => {
  for (const only of [":empty", ":first-child", ":nth-child(2n)", '[data-agent="v2"]', ":not(:first-child)"]) {
    assertLeftToAuthor(`${LINE}${only} { opacity: .2 }`);
  }
});

test("a container that is not hovered is the container at rest", () => {
  assert.deepEqual(migrate(`.blyrics-container:not(:hover) > .blyrics--line:not(.blyrics--active) { opacity: .3 }`).written, { opacity: "1 0.3" });
});

test("lists and hover values the author wrote are kept", () => {
  const css = `.blyrics-container { --blyrics-line-opacity: 1 .9; --blyrics-line-hover-opacity: .8 } ${LINE}:not(.blyrics--active) { opacity: .2; filter: blur(2px) } ${LINE}:hover { opacity: 1 !important }`;
  assert.deepEqual(migrate(css).written, { blur: "0 2px" });
});

test("a hover rule becomes hover values", () => {
  const css = `${LINE}:hover { opacity: 1 !important; filter: none !important; transform: scale(1.02) }`;
  assert.deepEqual(migrate(css).written, { "hover-opacity": "1", "hover-blur": "0", "hover-scale": "1.02" });
});

test("a hover rule that another rule beats on some lines is left to the author", () => {
  const css = `${SUNG} + .blyrics--line.blyrics--line { opacity: .6 } ${LINE}:hover { opacity: 1 }`;
  const { written, flags } = migrate(css);
  assert.equal(written["hover-opacity"], undefined);
  assert.ok(flags.some((flag) => /hover/.test(flag.message)));
});

test("hover does not reveal lines the theme hides from the mouse", () => {
  const hidden = `${SUNG} ~ .blyrics--line { opacity: 0; visibility: hidden } ${LINE}:hover { opacity: 1 !important; filter: none !important }`;
  const { written } = migrate(hidden);
  assert.equal(written["hover-opacity"], undefined);
  assert.equal(written["hover-blur"], "0");
});

test("a hover filter other than blur is reported", () => {
  const { unsupported } = migrate(`${LINE}:hover { filter: blur(0) brightness(1.4) }`);
  assert.equal(unsupported.length, 1);
});

test("a theme whose sung line is transparent gets no lists", () => {
  assertLeftToAuthor(`${LINE} { opacity: 0 }`);
});

test("unsynced and scrolling rules are the renderer's", () => {
  const css = `.blyrics-container[data-sync="none"] > .blyrics--line { opacity: .5 } .blyrics-user-scrolling > .blyrics--line { opacity: .7 }`;
  assert.deepEqual(migrate(css).written, {});
});

test("saturate and brightness in line filters become lists", () => {
  const css = `${LINE}:not(.blyrics--active) { filter: blur(2px) saturate(80%) brightness(.6) } ${SUNG} + .blyrics--line { filter: blur(1px) }`;
  assert.deepEqual(migrate(css).written, { "blur-before": "0 2px", "blur-after": "0 1px 2px", "saturate-before": "1 0.8", "saturate-after": "1 1 0.8", "brightness-before": "1 0.6", "brightness-after": "1 1 0.6" });
  const { unsupported } = migrate(`${LINE}:not(.blyrics--active) { filter: saturate(.5) }`);
  assert.deepEqual(unsupported, []);
});

test("calc() over the theme's own numbers is worked out", () => {
  const css = `:root { --level: .8 } ${LINE}:not(.blyrics--active) { opacity: calc(var(--level) * 0.5); filter: blur(calc(2px * 2)) }`;
  assert.deepEqual(migrate(css).written, { opacity: "1 0.4", blur: "0 4px" });
});

test("variables set on the container for one sync type are read for that type", () => {
  // Minimal and Burn: the visibility is set per sync type, and the other lines' is a calc() of it.
  const css = `.blyrics-container[data-sync="synced"] { --sung: 1; --next: .15 } .blyrics-container[data-sync="richsync"] { --sung: 1; --next: 1 }
    .blyrics-container { --browsing: calc(var(--sung) * 0.5) }
    .blyrics-container > div { opacity: var(--next) } .blyrics-container > div.blyrics--active { opacity: var(--sung) }
    .blyrics-container:is(:hover, .blyrics-user-scrolling) > div:not(.blyrics--active):not(:hover) { opacity: var(--browsing) }`;
  const { rules, unsupported } = migrate(css);
  assert.deepEqual(rules['.blyrics-container[data-sync="synced"]'], { "--blyrics-line-opacity": "1 0.15", "--blyrics-line-opacity-browsing": "0.5" });
  assert.deepEqual(rules['.blyrics-container[data-sync="richsync"]'], { "--blyrics-line-opacity-browsing": "0.5" });
  assert.equal(rules[".blyrics-container"], undefined);
  assert.deepEqual(unsupported, []);
});

test("rules for one sync type are written under that sync type", () => {
  const css = `.blyrics-container[data-sync="richsync"] > .blyrics--line:not(.blyrics--active) { opacity: .5 } ${LINE}:not(.blyrics--active) { filter: blur(2px) }`;
  const { rules, flags } = migrate(css);
  assert.deepEqual(rules['.blyrics-container[data-sync="richsync"]'], { "--blyrics-line-opacity": "1 0.5", "--blyrics-line-blur": "0 2px" });
  assert.deepEqual(rules['.blyrics-container[data-sync="synced"]'], { "--blyrics-line-blur": "0 2px" });
  assert.ok(!flags.some((flag) => flag.code === "review"));
});

test("the other lines while browsing take the browsing opacity only when the hovered line is left out", () => {
  const browsing = ".blyrics-container:hover > .blyrics--line:not(.blyrics--active)";
  assert.deepEqual(migrate(`${browsing}:not(:hover) { opacity: .4 }`).written, { "opacity-browsing": "0.4" });
  const { written, unsupported } = migrate(`${browsing} { opacity: .4 }`);
  assert.deepEqual(written, {});
  assert.equal(unsupported.length, 1);
});

test("browsing does not override a line rule that outweighs it", () => {
  const css = `${SUNG} + .blyrics--line.blyrics--line.blyrics--line.blyrics--line { opacity: .6 } .blyrics-container:hover > div:not(.blyrics--active):not(:hover) { opacity: .4 }`;
  const { written, flags } = migrate(css);
  assert.equal(written["opacity-browsing"], undefined);
  assert.ok(flags.some((flag) => /browsing/.test(flag.message)));
});

test("a hovered line under a hovered container is the hovered line", () => {
  assert.deepEqual(migrate(`.blyrics-container:hover > .blyrics--line:hover { opacity: 1 }`).written, { "hover-opacity": "1" });
});

test("sung words in the sung line take the past opacity", () => {
  // Opacity Based Karaoke: the opacity comes through a variable set on the line being sung.
  const css = `:root { --past-current: .7 }
    .blyrics-container[data-sync="richsync"] .blyrics--line.blyrics--animating:has([data-word-state="active"]) { --w-past: var(--past-current) }
    .blyrics-container[data-sync="richsync"] .blyrics--line .blyrics--word[data-word-state="past"] { opacity: var(--w-past) }`;
  const { rules, unsupported } = migrate(css);
  assert.deepEqual(rules['.blyrics-container[data-sync="richsync"] .blyrics--line .blyrics--word'], { "--blyrics-word-past-opacity": "0.7" });
  assert.deepEqual(unsupported, []);
});

test("a background line whose words are all sung dims its words", () => {
  const { rules } = migrate(`.blyrics--line .blyrics-background-line:not(:has(.blyrics--word:not([data-word-state="past"]))) { opacity: 0.7 }`);
  assert.deepEqual(rules[".blyrics--line .blyrics-background-line"], { "--blyrics-word-past-opacity": "0.7" });
});

test("sung words that keep their opacity need nothing", () => {
  const { output, unsupported } = migrate(`.blyrics--word[data-word-state="past"] { opacity: 1 } .blyrics-word-highlight[data-word-state="past"] { opacity: 1 !important }`);
  assert.doesNotMatch(output, /WebGL renderer \(begin\)/);
  assert.deepEqual(unsupported, []);
});

test("upcoming words still need their colour's alpha", () => {
  const { output, unsupported } = migrate(`.blyrics--word[data-word-state="upcoming"] { opacity: .4 }`);
  assert.doesNotMatch(output, /WebGL renderer \(begin\)/);
  assert.equal(unsupported[0].code, "word-opacity");
});

test("words lowered until sung take the rest transform", () => {
  // Apple Music, with the old engine's `> span >` that matches nothing now.
  const css = `.blyrics--line > span > .blyrics--word { transform: translateY(3px); transition: transform calc(var(--blyrics-duration, 0ms) + 300ms) ease-out }
    .blyrics--line > span > .blyrics--word.blyrics--animating { transform: translateY(0); animation: none }`;
  const { rules, flags } = migrate(css);
  assert.deepEqual(rules[".blyrics--line .blyrics--word"], { "--blyrics-word-rest-transform": "translateY(3px)" });
  assert.deepEqual(rules[".blyrics-container"], { "--blyrics-word-rise-extra-duration": "0.3s", "--blyrics-word-rise-easing": "ease-out" });
  assert.ok(!flags.some((flag) => flag.code === "line-transform"));
});

test("the scale and translate properties make a rest transform", () => {
  // Spicy for YTM: the pose is on the words waiting in the lines around the sung one.
  const css = `:root { --rest-scale: .95; --rest-y: .01em }
    .blyrics-container[data-sync="richsync"] > .blyrics--line:is(.blyrics--active, .blyrics--animating, .blyrics--active + .blyrics--line) .blyrics--word[data-word-state="upcoming"] { scale: var(--rest-scale); translate: 0 var(--rest-y) }
    .blyrics-container[data-sync="richsync"] > .blyrics--line:is(.blyrics--active, .blyrics--animating) .blyrics--word:not([data-word-state="upcoming"]) { animation: lift 1s linear }`;
  const { rules } = migrate(css);
  assert.deepEqual(rules['.blyrics-container[data-sync="richsync"] > .blyrics--line .blyrics--word'], { "--blyrics-word-rest-transform": "translateY(0.01em) scale(0.95)" });
});

test("a word transform nothing undoes is not a rest pose", () => {
  const { output, flags } = migrate(`.blyrics--word { transform: translateY(3px) }`);
  assert.doesNotMatch(output, /WebGL renderer \(begin\)/);
  assert.ok(flags.some((flag) => flag.code === "line-transform"));
});

test("a static text shadow is drawn, one that changes with state is not", () => {
  const css = `.blyrics-container .blyrics--word { text-shadow: 0 2px 4px rgba(0, 0, 0, .05) } .blyrics-container .blyrics--word.blyrics--animating { text-shadow: 0 0 8px white }
    .blyrics-highlight-run { text-shadow: none } .blyrics--translated { text-shadow: 0 1px 2px black !important }`;
  const { rules, unsupported } = migrate(css);
  assert.deepEqual(rules[".blyrics-container .blyrics--word"], { "--blyrics-text-shadow": "0 2px 4px rgba(0, 0, 0, .05)" });
  assert.deepEqual(rules[".blyrics--translated"], { "--blyrics-text-shadow": "0 1px 2px black !important" });
  assert.deepEqual(unsupported.map((u) => u.code), ["state-shadow"]);
});

test("variables on the word's ::after move onto the word", () => {
  const css = `.blyrics--word::after { --blyrics-glow-color: transparent; animation: none } .blyrics--word[data-long-word]::after { --blyrics-glow-color: white }
    .blyrics--word.blyrics-line-synced-word::after { animation: none !important }`;
  const { rules, flags, unsupported, settles } = migrate(css);
  assert.deepEqual(rules[".blyrics--word"], { "--blyrics-glow-color": "transparent" });
  assert.deepEqual(rules[".blyrics--word[data-long-word]"], { "--blyrics-glow-color": "white" });
  assert.deepEqual([flags, unsupported], [[], []]);
  assert.deepEqual(settles, ["var-on-pseudo"]);
});

test("braces in strings do not end a rule", () => {
  const css = `#side-panel::after { content: "}" } ${LINE}:not(.blyrics--active) { opacity: .3 }`;
  assert.deepEqual(migrate(css).written, { opacity: "1 0.3" });
});

test("migrating again changes and reports nothing", () => {
  for (const newline of ["\n", "\r\n"]) {
    const once = migrate(`${LINE}:not(.blyrics--active) {${newline}  opacity: .3;${newline}}${newline}`).output;
    if (newline === "\r\n") assert.ok(!/[^\r]\n/.test(once), "mixed line endings");
    const again = migrateForWebgl(once, once);
    assert.equal(again.output, once);
    assert.deepEqual(again.changes, []);
  }
});

test("an author's rules after the block stay after it", () => {
  const once = migrate(`${LINE}:not(.blyrics--active) { opacity: .3 }\n`).output;
  const edited = `${once}\n.mine { color: red }\n`;
  assert.equal(migrateForWebgl(edited, edited).output, edited);
});

test("a theme that does not compile is not written to", () => {
  const source = `${LINE}:not(.blyrics--active) { opacity: .3 }\n.unclosed { color: red;\n`;
  const { output, status } = runCli("style.rics", source);
  assert.equal(output, source);
  assert.notEqual(status, 0);
});

test("the command writes a .rics theme", () => {
  const { output, status } = runCli("style.rics", `$dim: .3;\n.blyrics-container {\n  > .blyrics--line:not(.blyrics--active) { opacity: $dim; }\n}\n`);
  assert.equal(status, 0);
  assert.match(output, /--blyrics-line-opacity: 1 0\.3;/);
});

test("the old engine's findings are reported apart from the WebGL renderer's", () => {
  const { stdout } = runCli("style.css", `${LINE}:not(.blyrics--active) { opacity: .3 }\n.blyrics--pre-animating { color: red }\n.blyrics--word::after { --blyrics-glow-color: red }\n`);
  const webgl = stdout.indexOf("WebGL renderer\n");
  const current = stdout.indexOf("Current renderer");
  assert.ok(webgl >= 0 && current > webgl, stdout);
  assert.ok(stdout.indexOf(".blyrics--pre-animating` was removed") > current);
  // Copying the variables onto the word settles the old engine's note about them.
  assert.doesNotMatch(stdout, /sets an engine variable on `::after`/);
});

test("a container that always holds while a song plays is no state, and is left out of the selector", () => {
  // reCover: the shadow is under `.blyrics-container:has(.blyrics--active)`.
  const { rules, unsupported } = migrate(`.blyrics-container:has(.blyrics--active) .blyrics--word { text-shadow: 0 .3rem .5rem rgba(0, 0, 0, .15) } .blyrics-container:has(.blyrics--active) .blyrics--word:after { text-shadow: none }`);
  assert.deepEqual(rules[".blyrics-container .blyrics--word"], { "--blyrics-text-shadow": "0 .3rem .5rem rgba(0, 0, 0, .15)" });
  assert.deepEqual(unsupported, []);
});

// Burn, Minimal and Opacity Based Karaoke draw their own note on the instrumental line and on the
// empty line, and pulse it while the line is sung.
const NOTE_PULSE = `.blyrics--instrumental-icon { display: none }
  .blyrics--instrumental.blyrics--line::after { content: "♫"; animation: none; transform: scale(100%) }
  .blyrics--active.blyrics--animating.blyrics--instrumental.blyrics--line::after { animation: note-pulse 1.5s ease-in-out infinite }
  .blyrics--paused.blyrics--active.blyrics--animating.blyrics--instrumental.blyrics--line::after { animation-play-state: paused }
  .blyrics--line:has(.blyrics-bidi-run:empty) .blyrics-line-main::before { content: "♫" }
  .blyrics--active.blyrics--animating.blyrics--line:has(.blyrics-bidi-run:empty) .blyrics-line-main::before { animation: note-pulse 1.5s ease-in-out infinite }`;

test("a note drawn on the instrumental line becomes the instrumental icon, and its pulse the pulse", () => {
  const css = `${NOTE_PULSE}
    @keyframes note-pulse { 0% { opacity: .6; transform: scale(100%); transform-origin: bottom center } 50% { opacity: 1; transform: scale(105%) } 100% { opacity: .6; transform: scale(100%) } }`;
  const { rules, flags, unsupported } = migrate(css);
  assert.deepEqual(rules[".blyrics-container"], { "--blyrics-instrumental-icon": '"♫"', "--blyrics-instrumental-pulse-scale": "1.05" });
  assert.deepEqual(unsupported, []);
  // The DOM renderer's note it hid is replaced, so hiding it needs no note.
  assert.ok(!flags.some((flag) => flag.code === "display-none"));
  assert.deepEqual(flags.map((flag) => flag.message).filter((m) => /only the scale/i.test(m)).length, 1);
});

test("a pulse that only scales carries over whole, with its duration", () => {
  const css = `${NOTE_PULSE.replaceAll("1.5s", "1200ms")} @keyframes note-pulse { from, to { scale: 1 } 50% { scale: 1.1 } }`;
  const { rules, flags } = migrate(css);
  assert.deepEqual(rules[".blyrics-container"], { "--blyrics-instrumental-icon": '"♫"', "--blyrics-instrumental-pulse-scale": "1.1", "--blyrics-instrumental-pulse-duration": "1.2s" });
  assert.deepEqual(flags, []);
});

test("a pulse that does not come back, or stops, is left to the author", () => {
  for (const [frames, animation] of [
    ["from { transform: scale(1) } to { transform: scale(1.1) }", "note-pulse 1.5s infinite"],
    ["50% { transform: scale(1.1) }", "note-pulse 1.5s 3"],
  ]) {
    const css = `${NOTE_PULSE.replaceAll("note-pulse 1.5s ease-in-out infinite", animation)} @keyframes note-pulse { ${frames} }`;
    const { rules, flags } = migrate(css);
    assert.deepEqual(rules[".blyrics-container"], { "--blyrics-instrumental-icon": '"♫"' }, animation);
    assert.ok(flags.some((flag) => /pulse-scale was not written/.test(flag.message)), animation);
  }
});

test("Apple Music's three dots become the dots icon", () => {
  // Minimalism Music: a bar masked into dots, its fill slid across, breathing while sung.
  const css = `#blyrics-wrapper .blyrics--instrumental .blyrics--instrumental-icon, #blyrics-wrapper .blyrics--instrumental.blyrics--line::after { display: none !important }
    #blyrics-wrapper .blyrics--instrumental.blyrics--line::before { content: ""; background: linear-gradient(90deg, white 40%, gray 60%); mask: radial-gradient(circle at .18em 50%, #000 .17em, transparent .18em) 0 0 / .68em 100% repeat-x }
    #blyrics-wrapper .blyrics--instrumental.blyrics--line.blyrics--active::before { animation: am-dots-slide var(--am-dur) linear forwards, am-dots-breathe 3s ease-in-out infinite }
    @media (prefers-reduced-motion: reduce) { #blyrics-wrapper .blyrics--instrumental.blyrics--line.blyrics--active::before { animation: am-dots-slide var(--am-dur) linear forwards } }
    @keyframes am-dots-slide { from { background-position: 100% 0 } to { background-position: 0% 0 } }
    @keyframes am-dots-breathe { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.14) } }`;
  const { rules, flags, unsupported } = migrate(css);
  assert.deepEqual(rules[".blyrics-container"], { "--blyrics-instrumental-icon": "dots", "--blyrics-instrumental-pulse-scale": "1.14", "--blyrics-instrumental-pulse-duration": "3s" });
  assert.deepEqual([flags, unsupported], [[], []]);
});

test("other drawings on the instrumental line are left to the author, with the dots suggested", () => {
  const { output, flags, unsupported } = migrate(`.blyrics--instrumental.blyrics--line::before { content: ""; background: white; border-radius: 50% }`);
  assert.doesNotMatch(output, /WebGL renderer \(begin\)/);
  assert.ok(flags.some((flag) => flag.message.includes("--blyrics-instrumental-icon: dots")));
  assert.deepEqual(unsupported.map((u) => u.code), ["pseudo-content"]);
});

test("instrumental notes that differ, apply to some screens, or that the author set are not written", () => {
  for (const css of [
    `.blyrics--instrumental.blyrics--line::after { content: "♫" } .blyrics--line:has(.blyrics-bidi-run:empty) .blyrics-line-main::before { content: "♪" }`,
    `@media (max-width: 600px) { .blyrics--instrumental.blyrics--line::after { content: "♫" } }`,
    `#layout[player-fullscreened] .blyrics--instrumental.blyrics--line::after { content: "♫" }`,
    `.blyrics-container { --blyrics-instrumental-icon: dots } .blyrics--instrumental.blyrics--line::after { content: "♫" }`,
  ]) {
    const { rules, flags } = migrate(css);
    assert.equal(rules[".blyrics-container"]?.["--blyrics-instrumental-icon"], undefined, css);
    assert.ok(flags.some((flag) => flag.code === "review"), css);
  }
});

// Glassy Blur, Lucid, Lyric Glow and Minimalism Music draw the no-lyrics state on the line's
// pseudo-elements.
const NO_LYRICS = '.blyrics-container[data-no-lyrics="true"]';

test("the no-lyrics line's content becomes the no-lyrics message and icon", () => {
  const css = `${NO_LYRICS} .blyrics-line-main { display: none !important }
    ${NO_LYRICS} .blyrics--line::before { content: "\\266B"; font-size: 6rem; font-weight: 400; color: rgba(255,255,255,.28); margin-bottom: .5rem }
    ${NO_LYRICS} .blyrics--line::after { content: "No lyrics found"; font-size: 2rem; font-weight: 600 }
    ${NO_LYRICS} .blyrics--line { display: flex; flex-direction: column }`;
  const { rules, unsupported } = migrate(css);
  assert.deepEqual(rules[".blyrics-container"], { "--blyrics-no-lyrics-text": '"No lyrics found"', "--blyrics-no-lyrics-icon": '"\\266B"' });
  assert.deepEqual(rules[`${NO_LYRICS} .blyrics-no-lyrics-icon`], {});
  assert.match(migrate(css).output, /\.blyrics-no-lyrics-icon \{\n {2}font-size: 6rem;\n {2}color: rgba\(255,255,255,\.28\);\n\}/);
  assert.match(migrate(css).output, /data-no-lyrics="true"\] \.blyrics--line \{\n {2}font-size: 2rem;\n {2}font-weight: 600;\n\}/);
  assert.deepEqual(unsupported, []);
});

test("the message's size is left to the author where moving it would change the theme", () => {
  const cases = [
    // The line has its own size already.
    [`${NO_LYRICS} .blyrics--line { font-size: 3rem }`, "font-size: 2rem", "sets font-size"],
    // Relative to the line it is on.
    ["", "font-size: 1.5em", "relative"],
    // The icon would inherit it on the current renderer.
    [`${NO_LYRICS} .blyrics--line::before { content: "♫" }`, "font-size: 2rem", "icon's `::before` would take it"],
  ];
  for (const [extra, size, why] of cases) {
    const { output, flags } = migrate(`${extra} ${NO_LYRICS} .blyrics--line::after { content: "No lyrics"; ${size} }`);
    assert.match(output, /--blyrics-no-lyrics-text: "No lyrics";/);
    assert.doesNotMatch(output, /\.blyrics--line \{\n {2}font-size/, why);
    assert.ok(flags.some((flag) => flag.message.includes(why)), why);
  }
});

test("an empty no-lyrics icon draws nothing, and other line pseudo-elements stay flagged", () => {
  // Minimalism Music's icon is an empty string; Lyric Glow's aurora is on every other line.
  const css = `${NO_LYRICS} .blyrics--line::before { content: ""; font-size: 10rem } ${NO_LYRICS} .blyrics--line::after { content: 'Guess' }
    .blyrics-container:not([data-no-lyrics="true"]) > .blyrics--line::before { content: ""; background: radial-gradient(white, transparent) }`;
  const { rules, unsupported } = migrate(css);
  assert.deepEqual(rules[".blyrics-container"], { "--blyrics-no-lyrics-text": "'Guess'" });
  assert.equal(rules[`${NO_LYRICS} .blyrics-no-lyrics-icon`], undefined);
  assert.deepEqual(unsupported.map((u) => u.where), [['.blyrics-container:not([data-no-lyrics="true"]) > .blyrics--line::before']]);
});

test("the no-lyrics message stays on the container when the line values differ by sync type", () => {
  const css = `.blyrics-container[data-sync="synced"] > .blyrics--line:not(.blyrics--active) { opacity: .5 } ${NO_LYRICS} .blyrics--line::after { content: "None" }`;
  const { rules } = migrate(css);
  assert.deepEqual(rules[".blyrics-container"], { "--blyrics-no-lyrics-text": '"None"' });
  assert.deepEqual(rules['.blyrics-container[data-sync="synced"]'], { "--blyrics-line-opacity": "1 0.5" });
});

test("a message size the line takes on some screens is the author's", () => {
  const { output, flags } = migrate(`@media (max-width: 600px) { ${NO_LYRICS} .blyrics--line { font-size: 1rem } } ${NO_LYRICS} .blyrics--line::after { content: "No lyrics"; font-size: 2rem }`);
  assert.doesNotMatch(output, /\.blyrics--line \{\n {2}font-size/);
  assert.ok(flags.some((flag) => flag.message.includes("sets font-size")));
});
