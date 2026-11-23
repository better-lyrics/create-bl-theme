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
  const block = result.output.match(/WebGL renderer \(begin\)[\s\S]*?WebGL renderer \(end\)/)?.[0] ?? "";
  const written = Object.fromEntries([...block.matchAll(/--blyrics-line-([\w-]+): ([^;]*);/g)].map((m) => [m[1], m[2]]));
  return { ...result, written };
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
  for (const value of ["blur(var(--unknown))", "blur(calc(2px * 2))", "var(--unknown)", "blur(0.2em)"]) {
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
