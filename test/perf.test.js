// perf names the features a theme turns on, including those on by default, so its costs are only
// as right as its detection.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { perfReport } from "../bin/perf.js";

const CLI = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
const ids = (css) => perfReport(css).features.map((f) => f.id);
const source = (css, id) => perfReport(css).features.find((f) => f.id === id)?.source;

test("a theme that sets nothing has the default features", () => {
  const report = perfReport(".blyrics-container { --blyrics-font-size: 2rem }");
  assert.deepEqual(report.features.map((f) => f.id), ["glow-every-word", "letter-wave-every-word", "word-wobble", "romanized-pill"]);
  assert.ok(report.features.every((f) => f.source.every((s) => s.startsWith("on by default"))));
  assert.deepEqual([report.overall, report.because], ["medium", ["glow-every-word"]]);
});

test("the glow is on every word, on held words only, or off", () => {
  assert.deepEqual(source(".blyrics--word { --blyrics-glow-color: #fff8 }", "glow-every-word"), ["`--blyrics-glow-color: #fff8` on `.blyrics--word`"]);
  const held = ".blyrics-word-highlight:not([data-long-word]) { --blyrics-glow-color: transparent }";
  assert.deepEqual(source(held, "glow-held-words"), ["`--blyrics-glow-color: transparent` on `.blyrics-word-highlight:not([data-long-word])`"]);
  assert.ok(!ids(held).includes("glow-every-word"));
  assert.ok(ids(".blyrics--word { --blyrics-glow-color: transparent } .blyrics--word[data-long-word] { --blyrics-glow-color: white }").includes("glow-held-words"));
  for (const off of [
    ".blyrics-container { --blyrics-animate-highlight-glow: 0 }",
    ":root { --blyrics-glow-color: rgb(0 0 0 / 0) }",
    ":root { --blyrics-highlight-color: rgba(255, 255, 255, 0) }",
    ".blyrics-container { --blyrics-highlight-glow-radius-from: 0 }",
  ]) {
    assert.ok(!ids(off).some((id) => id.startsWith("glow-")), off);
  }
});

test("the letter wave follows its setting and the wobble switch", () => {
  assert.deepEqual(source("/* blyrics-letter-wave = long; */", "letter-wave-held-words"), ["`blyrics-letter-wave = long;` (comment setting)"]);
  assert.ok(!ids("/* blyrics-letter-wave = long; */").includes("letter-wave-every-word"));
  assert.ok(!ids("/* blyrics-letter-wave = false; */").some((id) => id.startsWith("letter-wave")));
  const still = ids(".blyrics-container { --blyrics-animate-word-wobble: 0; --blyrics-letter-wave-glow: 0.8; --blyrics-word-wobble-scope: syllable }");
  assert.ok(!still.some((id) => /^(?:letter-wave|word-wobble|syllable-wobble)/.test(id)), still.join());
  assert.ok(ids(".blyrics-container { --blyrics-letter-wave-glow: 0.8 }").includes("letter-wave-glow"));
});

test("line effects count only when they change something", () => {
  const css = `.blyrics-container { --blyrics-line-blur-after: 0 1px 2px; --blyrics-line-hover-blur: 1px; --blyrics-line-saturate: 1 0.8;
    --blyrics-line-opacity: 1 0.5; --blyrics-line-opacity-browsing: 0.4; --blyrics-line-hover-scale: 1.02 }`;
  for (const id of ["line-blur", "hover-blur", "line-filters", "line-opacity", "browsing-opacity", "hover-look"]) assert.ok(ids(css).includes(id), id);
  assert.equal(perfReport(css).features.find((f) => f.id === "line-blur").cost, "high");
  const neutral = ".blyrics-container { --blyrics-line-blur: 0; --blyrics-line-hover-blur: 0px; --blyrics-line-brightness: 1 1; --blyrics-line-opacity: 1 }";
  assert.ok(!ids(neutral).some((id) => /^(?:line-|hover-blur)/.test(id)), ids(neutral).join());
});

test("shadows, boxes, image highlights and the romanization box are found where they draw", () => {
  const css = `/* blyrics-image-highlights = true; */
    .blyrics--line { --blyrics-text-shadow: 0 1px 2px black; --blyrics-active-text-shadow: 0 0 8px white; --blyrics-line-bg-color: #0006 }
    .blyrics--romanized { --blyrics-romanized-bg-color: transparent }`;
  for (const id of ["text-shadow", "state-shadows", "line-boxes", "image-highlights"]) assert.ok(ids(css).includes(id), id);
  assert.ok(!ids(css).includes("romanized-pill"));
  assert.ok(!ids(".blyrics--line { --blyrics-text-shadow: none; --blyrics-line-border-color: transparent }").some((id) => id === "text-shadow" || id === "line-boxes"));
});

test("a theme with only cheap features rates low", () => {
  const report = perfReport("/* blyrics-letter-wave = long; */ .blyrics-container { --blyrics-animate-highlight-glow: 0 }");
  assert.deepEqual([report.overall, report.because], ["low", []]);
  assert.ok(report.features.every((f) => f.cost === "low"));
});

test("the command prints JSON for a .rics theme, migrate's block included", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "create-bl-theme-"));
  try {
    fs.writeFileSync(path.join(dir, "style.rics"), "$blur: 2px;\n.blyrics-container { --blyrics-line-blur: 0 #{$blur}; }\n");
    const { stdout, status } = spawnSync(process.execPath, [CLI, "perf", dir, "--json"], { encoding: "utf8" });
    assert.equal(status, 0);
    const report = JSON.parse(stdout);
    assert.equal(report.overall, "high");
    assert.deepEqual(report.features.find((f) => f.id === "line-blur").source, ["`--blyrics-line-blur: 0 2px` on `.blyrics-container`"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unmigrated theme is said to be one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "create-bl-theme-"));
  try {
    const file = path.join(dir, "style.css");
    const run = (...args) => spawnSync(process.execPath, [CLI, "perf", file, ...args], { encoding: "utf8" }).stdout;
    fs.writeFileSync(file, ".blyrics--line:not(.blyrics--active) { filter: blur(2px) }\n");
    assert.equal(JSON.parse(run("--json")).migrated, false);
    assert.match(run(), /migrate would still change this theme/);
    spawnSync(process.execPath, [CLI, "migrate", file, "--write"], { encoding: "utf8" });
    assert.equal(JSON.parse(run("--json")).migrated, true);
    assert.doesNotMatch(run(), /migrate would still change this theme/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("switches are read where every song reads them, and pseudo-elements are not read", () => {
  assert.ok(ids('.blyrics-container[data-sync="synced"] { --blyrics-animate-highlight-glow: 0 }').includes("glow-every-word"));
  assert.ok(ids(".blyrics-container { --blyrics-animate-highlight-glow: 1 !important } .blyrics-container { --blyrics-animate-highlight-glow: 0 }").includes("glow-every-word"));
  assert.ok(!ids(".blyrics-container { --blyrics-animate-highlight-glow: 0 }").includes("glow-every-word"));
  assert.ok(!ids(".blyrics--word::before { --blyrics-text-shadow: 0 0 2px red }").includes("text-shadow"));
});

test("distance lists are rated as the container reads them", () => {
  assert.ok(!ids(".blyrics-container { --blyrics-line-blur: 0 4px; --blyrics-line-blur-before: 0; --blyrics-line-blur-after: 0 }").includes("line-blur"));
  assert.ok(!ids(".blyrics--word:hover { --blyrics-line-blur: 0 4px }").includes("line-blur"));
  assert.deepEqual(source('.blyrics-container[data-sync="synced"] { --blyrics-line-blur-after: 0 2px }', "line-blur"), ['`--blyrics-line-blur-after: 0 2px` on `.blyrics-container[data-sync="synced"]`']);
  assert.ok(!ids(".blyrics--line { --blyrics-line-opacity: 1 0.5 }").includes("line-opacity"));
});

test("a theme migrate would not change counts as migrated, with no block", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "create-bl-theme-"));
  try {
    const file = path.join(dir, "style.css");
    fs.writeFileSync(file, ".blyrics-container { --blyrics-font-size: 2rem }\n");
    const run = (...args) => spawnSync(process.execPath, [CLI, "perf", file, ...args], { encoding: "utf8" }).stdout;
    assert.equal(JSON.parse(run("--json")).migrated, true);
    assert.doesNotMatch(run(), /migrate would still change this theme/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a distance list on the container inside a media query is reported with its query", () => {
  assert.deepEqual(source("@media (min-width: 800px) { .blyrics-container { --blyrics-line-blur-after: 0 3px } }", "line-blur"), ["`--blyrics-line-blur-after: 0 3px` on `.blyrics-container` (in `@media (min-width: 800px)`)"]);
  assert.ok(ids("@media (min-width: 800px) { .blyrics-container { --blyrics-animate-highlight-glow: 0 } }").includes("glow-every-word"));
});

test("distance lists are parsed as the renderer parses them", () => {
  assert.ok(!ids(".blyrics-container { --blyrics-line-blur: 0, 0 }").includes("line-blur"));
  assert.deepEqual(source(".blyrics-container { --blyrics-line-blur: 0 2px; --blyrics-line-blur-after: none }", "line-blur"), ["`--blyrics-line-blur: 0 2px` on `.blyrics-container`"]);
});

test("a container that holds for every song with lyrics reads the lists", () => {
  assert.ok(ids('.blyrics-container:not([data-no-lyrics="true"]) { --blyrics-line-blur: 0 2px }').includes("line-blur"));
});
