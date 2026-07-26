## Migrating a theme from the old animation engine

Older themes were written for the previous engine, which animated by toggling CSS classes and writing `transition-delay` values. The current engine uses the Web Animations API and normal inline text flow. If a user's existing theme references any of the removed hooks below, migrate it.

The fastest path is the CLI, which applies the mechanical rewrites and flags the rest:

```sh
npx create-bl-theme@latest migrate ./their-theme          # preview, nothing is written
npx create-bl-theme@latest migrate ./their-theme --write  # apply the automatic fixes in place
```

When editing by hand, apply this mapping.

Safe automatic rewrites:

- `.blyrics--animating` on a line becomes `.blyrics--active` (for example `.blyrics--line.blyrics--animating`, `.blyrics-container > div.blyrics--animating`, and `:not(.blyrics--animating)`). This also applies inside RICS string variables and `#{}` interpolation.
- `.blyrics-zero-dur-animate` becomes `.blyrics-line-synced-word`.
- `var(--blyrics-anim-delay, X)` becomes `X`, and `var(--blyrics-anim-delay)` with no fallback becomes `0s`. The engine owns per-word stagger now, so this variable is never set. Keep any `--blyrics-duration` reference; that one still exists.

Needs a human decision (do not blindly rewrite):

- `.blyrics--word.blyrics--animating` has no class equivalent. The engine animates each word's `::after` overlay directly. Remove per-word active rules, or drive them from `--blyrics-duration` and `[data-long-word]`.
- `.blyrics--paused`, `.blyrics--pre-animating`, `.blyrics--break`, and `.blyrics--has-trailing-space` were removed. Delete those rules.
- Words are no longer direct `<span>` children of the line. `.blyrics--line > span` and `.blyrics-container > div > span` no longer select words; use `.blyrics--word`. Translations and romanizations are `<div class="blyrics--translated blyrics-content-line">`, not `<span>`.
- The lyric line is no longer a flexbox. Replace `justify-content` / `order` / `flex-flow` on `.blyrics--line` with `text-align` and `transform-origin`.
- Rules on `.blyrics--word::after` should also target `.blyrics-word-highlight`, because long wrapped words render their highlight in a real child element, not `::after`.

Preserved (do not change): every color, font, layout, and effect variable, plus `--blyrics-duration` (still set on both words and lines), `--lyric-transition-amount-start` / `--lyric-transition-amount-end`, `.blyrics-container`, `.blyrics--line`, `.blyrics--word`, `.blyrics--active`, `.blyrics-user-scrolling`, `.blyrics--translated`, `.blyrics--romanized`, `.blyrics--instrumental*`, `.blyrics-rtl`, `data-sync`, `data-agent`, and `[blyrics-dfs]`. A theme that only sets variables needs no changes.

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
