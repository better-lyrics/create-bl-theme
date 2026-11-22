## Migrating a theme from the old animation engine

> [!NOTE]
> This section is about today's DOM renderer. Where it disagrees with [Migrating a theme to the WebGL renderer](#migrating-a-theme-to-the-webgl-renderer) below (state classes, `::after`, transitions, glow filters), that section is right for the WebGL renderer.

Older themes were written for the previous engine, which animated by toggling CSS classes and writing `transition-delay` values. The current engine uses the Web Animations API and normal inline text flow. If a user's existing theme references any of the removed hooks below, migrate it.

The fastest path is the CLI, which applies the mechanical rewrites and flags the rest:

```sh
npx create-bl-theme@latest migrate ./their-theme          # preview, nothing is written
npx create-bl-theme@latest migrate ./their-theme --write  # apply the automatic fixes in place
```

When editing by hand, apply this mapping.

Safe automatic rewrites:

- `.blyrics-zero-dur-animate` becomes `.blyrics-line-synced-word`.
- `var(--blyrics-anim-delay, X)` becomes `X`, and `var(--blyrics-anim-delay)` with no fallback becomes `0s`. The engine owns per-word stagger now, so this variable is never set. Keep any `--blyrics-duration` reference; that one still exists.

Needs a human decision (do not blindly rewrite):

- `.blyrics--word.blyrics--animating` has no class equivalent. The engine animates each word's `::after` overlay directly. Remove per-word active rules, or drive them from `--blyrics-duration` and `[data-long-word]`.
- `.blyrics--pre-animating`, `.blyrics--break`, and `.blyrics--has-trailing-space` were removed. Delete those rules. `.blyrics--pre-animating` was a one-reflow marker used to restart CSS keyframes; the engine no longer restarts anything that way, and its window was identical to `.blyrics--animating` anyway.
- Words are no longer direct `<span>` children of the line. `.blyrics--line > span` and `.blyrics-container > div > span` no longer select words; use `.blyrics--word`. Translations and romanizations are `<div class="blyrics--translated blyrics-content-line">`, not `<span>`.
- The lyric line is no longer a flexbox. Replace `justify-content` / `order` / `flex-flow` on `.blyrics--line` with `text-align` and `transform-origin`.
- Rules on `.blyrics--word::after` should also target `.blyrics-word-highlight`, because long wrapped words render their highlight in a real child element, not `::after`.

Preserved (do not change): every color, font, layout, and effect variable, plus `--blyrics-duration` (still set on both words and lines), `--lyric-transition-amount-start` / `--lyric-transition-amount-end`, `.blyrics-container`, `.blyrics--line`, `.blyrics--word`, `.blyrics--active`, `.blyrics--animating` (line-level only), `.blyrics--paused`, `.blyrics-user-scrolling`, `.blyrics--translated`, `.blyrics--romanized`, `.blyrics--instrumental*`, `.blyrics-rtl`, `data-sync`, `data-agent`, and `[blyrics-dfs]`. A theme that only sets variables needs no changes.

### Do not collapse `.blyrics--animating` into `.blyrics--active`

They look interchangeable and are not. A line carries both, on two different clocks:

| Class | Clock | Closes |
| ----- | ----- | ------ |
| `.blyrics--active` | Audio time plus `--blyrics-scroll-timing-offset` (0.5s default), so it runs ahead of what you hear | When the scroll target moves on, roughly half a second before the line stops playing |
| `.blyrics--animating` | Audio time | Once the line's own words have actually finished |

Anything that dims, blurs, hides, or shrinks previous lines must key off `.blyrics--animating`, or off both. Keying it off `.blyrics--active` alone makes the previous line drop out while its last word is still being sung. `.blyrics--active` is for scroll-anchored affordances: which line is centered, cursor, hit targets.

```css
/* wrong: previous line vanishes mid-word */
.blyrics-container > div:not(.blyrics--active) { opacity: 0; }

/* right: matches either, so it also works on engines older than 2.4.0.1 */
.blyrics-container > :is(.blyrics--active, .blyrics--animating) { opacity: 1; }
```

`.blyrics--paused` sits on the line and on each of its words while playback is paused. Use it to freeze theme-authored CSS animations in step with the engine.

### Intent-level migration (effects that break silently)

Renaming classes and variables is not enough. The old engine let themes customize or disable an effect by hooking its class or its `@keyframes`; the new engine builds every animation from CSS variables and ignores those hooks, so the old customization goes dead and the engine's DEFAULT effect comes back. These changes compile fine and pass a syntactic migration, so you have to recognize the intent and re-express it. Watch a richsync song after migrating and check each effect.

**A redefined `@keyframes blyrics-wobble` or `@keyframes blyrics-glow` does nothing now.** The engine reads keyframe values from variables, not from these at-rules. Translate the keyframe's stops into the matching variables:

- Wobble: map the keyframe transforms to `--blyrics-word-wobble-transform-from` (0%), `--blyrics-word-wobble-transform-peak`, `--blyrics-word-wobble-transform-settle`, and `--blyrics-word-wobble-transform-to` (100%), with `--blyrics-word-wobble-peak-offset` (default 0.125) and `--blyrics-word-wobble-settle-offset` (default 0.75) for the middle stop positions. For example, a theme that replaced the default horizontal `scaleX` wobble with a subtle upward drift (`0% { translateY(0) } 100% { translateY(-0.0375em) }`) becomes:

  ```css
  :root {
    --blyrics-word-wobble-transform-from: translateY(0);
    --blyrics-word-wobble-transform-peak: translateY(-0.005em);
    --blyrics-word-wobble-transform-settle: translateY(-0.028em);
    --blyrics-word-wobble-transform-to: translateY(-0.0375em);
  }
  ```

  If the intent was just to remove the wobble, set `--blyrics-animate-word-wobble: 0` instead. Then delete the dead `@keyframes`.
- Glow: map to `--blyrics-highlight-glow-filter-from` / `--blyrics-highlight-glow-filter-to` (both `drop-shadow(...)` strings using `var(--blyrics-glow-color)`), or set `--blyrics-animate-highlight-glow: 0` to remove it.

**Per-word glow color works.** The engine composes the glow filter with `var(--blyrics-glow-color)` left unresolved, so each word resolves its own color through the Web Animations API. The old "null the glow on `::after`, restore it on `[data-long-word]`" pattern carries straight over:

```css
.blyrics--word::after {
  --blyrics-glow-color: color(display-p3 1 1 1 / 0.0001);
}
.blyrics--word[data-long-word]::after,
.blyrics--word[data-long-word] > .blyrics-word-highlight {
  --blyrics-glow-color: color(display-p3 1 1 1 / 1);
}
```

Long wrapped words render their highlight in a real `.blyrics-word-highlight` child, so target it alongside `::after`. Tune the blur with `--blyrics-highlight-glow-radius-from` / `--blyrics-highlight-glow-radius-to` while keeping per-word color. Setting the full `--blyrics-highlight-glow-filter-from` / `--blyrics-highlight-glow-filter-to` instead resolves the color once at the container, so every word shares one glow color. Use `--blyrics-animate-highlight-glow: 0` to turn glow off.

**Disabling an effect** was done many ways: `animation: none` on the dead animating class, a `@keyframes` flattened to `transform: none`, `.blyrics--word::after { display: none }`, a full `::after` / `::before` reset, a zero-alpha `--blyrics-glow-color`, a zero duration, or a forced `transform: translateY(0) !important`. All of them collapse to one flag now: `--blyrics-animate-line-scale`, `--blyrics-animate-word-wobble`, `--blyrics-animate-highlight-swipe`, `--blyrics-animate-highlight-glow`, `--blyrics-animate-highlight-fade`, `--blyrics-animate-scroll`, `--blyrics-animate-instrumental` (each `1` on, `0` off). Set the flag and delete the old hack.

**`--blyrics-anim-delay` carried timing, not just a value.** The engine no longer sets it, so migration flattens it to `0s`. If a theme used it to stagger or hold a per-word or per-line transition (for example to keep the previous line visible until the next one starts), that timing is gone. Re-express deliberate offsets with a static `transition-delay`, or lean on the line enter/exit and `--blyrics-scale-transition-duration` timing the engine now owns. Line-transition feel is the most likely thing to need hand-tuning in the live extension.

**Do not assume exactly one active line.** The engine can mark several lines `.blyrics--active` at once while scrolling. Selectors like `.blyrics--active ~ div` or `:not(.blyrics--active)` that assumed a single active line (common in "hide past lines / dim upcoming lines" designs) can behave differently; verify them on a real song.

## Migrating a theme to the WebGL renderer

Better Lyrics is moving to a WebGL renderer (`@braccato/core` 2). It draws the lyrics on one canvas instead of animating thousands of elements, which is several times cheaper. The lines are still in the page, laid out but invisible, so the browser still wraps them and a theme's layout and `--blyrics-*` variables still apply. Nothing paints those elements, though, so rules that style them directly stop showing.

The CLI does the mechanical part and flags the rest:

```sh
npx create-bl-theme@beta migrate ./their-theme          # preview, nothing is written
npx create-bl-theme@beta migrate ./their-theme --write  # apply the automatic fixes in place
```

With `--write` it reads the theme's line opacity, blur and `:hover` rules and appends the matching distance lists and hover values (below) in a block marked `create-bl-theme migrate: WebGL renderer`. Re-running updates that block in place. The current DOM renderer ignores these variables, so a migrated theme works on both renderers: keep the old rules until the WebGL renderer has shipped.

It writes a value only where the CSS cascade settles it. It leaves these to you, with a review note:
- rules inside media, container and support queries;
- rules for one view (fullscreen, Picture-in-Picture, video mode) or only some lines (`:first-child`, `:empty`, one `data-agent`);
- values it cannot read, such as `calc()`, `em` blurs or variables set outside `:root` and the container;
- hover values that differ from line to line, or that would show lines the theme hides from the mouse.

It never replaces a `--blyrics-line-*` value the theme already sets, and it writes nothing for a `.rics` file that does not compile.

### What still works

- Every `--blyrics-*` variable for colour, font, size, spacing and timing, and every `/* blyrics-key = value; */` comment setting.
- Selectors that scope variables. Colours resolve per element, so `[data-agent="v2"] { --blyrics-lyric-active-color: … }` or `.blyrics-word-highlight:not([data-long-word]) { --blyrics-glow-color: transparent; }` still apply to just those lines or words.
- Layout properties on lines: `font-*`, `letter-spacing`, `line-height`, `text-align`. The space around a line is `--blyrics-padding`; the renderer sets lines' and words' own `padding` and `margin`.

### What no longer shows

- Paint on lyric elements: `opacity`, `filter`, `transform`, `scale`, `color`, `text-shadow`, `background`, `border`, `box-shadow`, `outline`, `-webkit-text-stroke`, `mix-blend-mode`.
- `animation`, `transition` and `@keyframes` on lyric elements. The renderer times its own effects.
- `::before` / `::after` on lyric elements.
- The state classes are never set: `.blyrics--active`, `.blyrics--animating`, `.blyrics--paused` and `[data-word-state]` match nothing, so rules keyed off them do nothing. `.blyrics-user-scrolling` is still set on the container.
- `:hover` on lines, except the opacity, blur and scale of the hovered line, which have variables (below).

### The replacements

**Fading and blurring lines by distance from the sung line.** This is what most themes build with `.blyrics--active` rules and sibling chains, and it is now two lists of values: one for the sung line, then 1, 2, 3… lines away:

```css
.blyrics-container {
  --blyrics-line-opacity-after: 1 0.88 0.72 0.52 0.28 0;
  --blyrics-line-blur-after: 0 1.125px 2.5px 4.125px 6px;
  --blyrics-line-opacity-before: 1 0.4;
}
```

- `--blyrics-line-opacity` and `--blyrics-line-blur` apply to both sides. `-before` (lines already sung) and `-after` (lines still to come) replace one side.
- The last value holds beyond the end, so `1 0.5` dims every other line, and a trailing `0` hides the rest.
- Blurs are in `px` or `rem` and mean what `blur()` means.
- The renderer interpolates between whole lines as the view scrolls, and eases the effects off while the reader scrolls. Rules under `.blyrics-user-scrolling` that undo the fade are not needed.

| DOM-renderer rule | WebGL list |
| ----------------- | ---------- |
| `.blyrics--line:not(.blyrics--active) { opacity: .4 }` | `--blyrics-line-opacity: 1 0.4` |
| `.blyrics--active ~ .blyrics--line { opacity: .66 }` | `--blyrics-line-opacity-after: 1 0.66` |
| `.blyrics--line:has(~ .blyrics--active) { opacity: 0 }` | `--blyrics-line-opacity-before: 1 0` |
| `.blyrics--active + .blyrics--line { filter: blur(2px) }`, `+ .blyrics--line + .blyrics--line { filter: blur(4px) }` | `--blyrics-line-blur-after: 0 2px 4px` |
| `visibility: hidden` / `opacity: 0` past some distance | end the opacity list with `0` |

**The line under the mouse.** A `.blyrics--line:hover` rule's opacity, blur and scale become:

```css
.blyrics-container {
  --blyrics-line-hover-opacity: 1;
  --blyrics-line-hover-blur: 0;
  --blyrics-line-hover-scale: 1.02;
  --blyrics-line-hover-duration: 0.2s; /* default */
  --blyrics-line-hover-easing: ease;   /* default */
}
```

Each one replaces the line's own value (its distance opacity, its distance blur, its scale) while the pointer is on it; leave one unset to keep the line's own. Nothing else about a hovered line can change, and touch has no hover. Rules that change other lines while the mouse is over the lyrics (`.blyrics-container:hover > div:not(:hover)`) have no equivalent.

**Colours.** Set variables, not `color`:
- `--blyrics-lyric-inactive-color`: words not yet sung.
- `--blyrics-lyric-active-color`: the sung part of a word.
- `--blyrics-glow-color`: the glow.
- `--blyrics-translated-color`: translations and romanizations.

`--blyrics-text-color` with `--blyrics-inactive-opacity` / `--blyrics-active-opacity` still derive the first two. A colour with alpha is how a word or line is made translucent.

**Size.** The sung line's scale is `--blyrics-active-scale` (default 1) and the others' is `--blyrics-scale` (default 0.95), timed by `--blyrics-scale-transition-duration` and eased by `--blyrics-line-enter-easing` / `--blyrics-line-exit-easing`.

**Glow.**
- Size: `--blyrics-highlight-glow-radius-from` / `--blyrics-highlight-glow-radius-to`.
- Colour: `--blyrics-glow-color`, which can vary per word as above.
- `--blyrics-highlight-glow-filter-from/-to` are not read.

**Word motion.** `--blyrics-word-wobble-transform-{from,peak,settle,to}`, `--blyrics-letter-wave-*`, the swipe stops `--blyrics-highlight-swipe-*`, and the `--blyrics-animate-*` switches all apply. Transforms there take translations and scales; rotations and skews are ignored.

**Variables the WebGL renderer does not read:**
- `--blyrics-highlight-glow-filter-*`
- `--blyrics-line-enter/exit-transform-*`
- the instrumental note's path, transform and easing variables (it draws the note itself)
- `--blyrics-word-wobble-end-easing`
- `--blyrics-image-glow-opacity-*`
- the per-line `--blyrics-line-scroll-*`
- `--blyrics-duration`, which nothing sets any more

### When something has no equivalent: ask

Some effects have no variable yet:
- hover styles beyond the hovered line's opacity, blur and scale
- text shadows, outlines, strokes, backgrounds or borders on lyrics
- filters other than `blur()`
- per-word opacity or styles keyed off a word's state
- `::before` / `::after` decorations
- custom keyframe animations
- rotated or skewed text

Don't fake them with page-level hacks. Ask in the Better Lyrics Discord (https://discord.gg/UsHE3d5fWF): the renderer is ours, and effects themes need can be added to it. The CLI lists these under "Not possible in the WebGL renderer yet".

When helping someone migrate:
1. Run the CLI first.
2. Check the generated lists against what the theme looked like, on a synced song.
3. Re-express what the review items cover.
4. Tell them plainly which effects cannot carry over and that they can ask for them on Discord.
