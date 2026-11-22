# create-bl-theme

CLI tool to scaffold [Better Lyrics](https://github.com/better-lyrics/better-lyrics) themes.

## Installation

```bash
npm install -g create-bl-theme
```

Or use directly with npx:

```bash
npx create-bl-theme@latest my-theme
```

## Usage

### Create a new theme

```bash
create-bl-theme [theme-name]
```

The CLI will prompt you for:

- Theme ID (lowercase, hyphens allowed)
- Theme title
- Description
- Your GitHub username
- Tags (dark, light, minimal, colorful, etc.)
- Whether to include shaders

### Validate a theme

```bash
# Validate a local directory
create-bl-theme validate ./my-theme

# Validate directly from a GitHub repository
create-bl-theme validate https://github.com/username/theme-repo
```

The validator checks:
- Required files (metadata.json, style.rics or style.css, images/)
- RICS syntax validation (for .rics files)
- Valid JSON structure and required fields
- Semver version format
- Image integrity (detects corrupted files)
- Image dimensions (recommends 1280x720, but other sizes work fine)

### Migrate a theme to the new animation engine

Better Lyrics is about to rewrite its lyric animation engine: class toggles become the Web Animations API, and the lyric DOM moves to normal inline text flow. Themes that reach into the current engine's internals will need a few updates. This command does the mechanical ones for you and flags the rest.

```bash
# Preview what would change (does not modify anything)
create-bl-theme migrate

# Apply the automatic fixes in place
create-bl-theme migrate --write

# Target a specific theme directory or a single file
create-bl-theme migrate ./my-theme --write
create-bl-theme migrate ./my-theme/style.rics --write
```

It resolves `style.rics` (or `style.css`) in a directory, or takes a file path directly. It:

- Auto-fixes the unambiguous changes: the renamed line-synced class and the dead `--blyrics-anim-delay` variable.
- Flags the parts that need a human decision: word-level active state (now engine-driven), removed line-break hooks, and selectors that assumed the old flat word DOM.
- Rechecks that your `.rics` still compiles after writing.

Most themes need nothing: every color, font, and layout variable is preserved. See the [styling reference](https://github.com/better-lyrics/better-lyrics/blob/master/STYLING.md) for the full selector and variable catalogue.

### Migrate a theme to the WebGL renderer

Better Lyrics is moving to a WebGL renderer that draws the lyrics on a canvas. Theme variables and comment settings still apply. Rules that paint the lyric elements themselves do not: opacity, filters, transforms, colors, shadows and animations on lines and words, and anything keyed off `.blyrics--active` or `.blyrics--animating`. The same `migrate` command covers it:

- **Writes automatically:** it reads your line opacity and blur rules (the "dim and blur lines around the sung one" effect most themes have) and appends the equivalent `--blyrics-line-opacity-*` / `--blyrics-line-blur-*` lists, plus your `:hover` rules' opacity, blur and scale as `--blyrics-line-hover-*`. The current renderer ignores these, so the theme keeps working on both.
- **Flags with a replacement:** colors, scale and spacing, which have variables.
- **Flags as not possible yet:** effects the renderer has no equivalent for, such as text shadows, non-blur filters and hover styles beyond opacity, blur and scale. If your theme needs one, ask in the [Better Lyrics Discord](https://discord.gg/UsHE3d5fWF) so it can be added to the renderer.

The mapping is in [skills/MIGRATION.md](skills/MIGRATION.md), which `create-bl-theme skill` also installs for your AI assistant.

### Install the theme skill for your AI assistant

If you build themes with an AI coding assistant, install a Better Lyrics skill so it knows the selectors, CSS variables, DOM structure, and how to migrate old themes.

```bash
create-bl-theme skill
```

It detects which assistants you use, pre-selects them, and writes the skill in each one's format:

- Claude Code: `.claude/skills/better-lyrics-themes/SKILL.md`
- Codex and others: `AGENTS.md`
- Gemini CLI: `GEMINI.md`
- Cursor: `.cursor/rules/better-lyrics-themes.mdc`

Run it inside your theme directory, or pass a path. Re-running updates the skill in place; your own content in `AGENTS.md` and `GEMINI.md` is left untouched.

### Bump version

```bash
# Bump patch version (1.0.0 → 1.0.1)
create-bl-theme bump patch

# Bump minor version (1.0.0 → 1.1.0)
create-bl-theme bump minor

# Bump major version (1.0.0 → 2.0.0)
create-bl-theme bump major

# Bump in a specific directory
create-bl-theme bump patch ./my-theme
```

### Check publishing status

```bash
# Check if theme is registered and ready to publish
create-bl-theme publish

# Check a specific directory
create-bl-theme publish ./my-theme
```

The publish command:
- Checks if your theme is registered in the theme store
- Shows your current version vs. the registry version
- Provides setup instructions for auto-publishing

## Generated Structure

```
my-theme/
├── metadata.json    # Theme metadata (required)
├── style.rics       # Your styles in RICS format (required)
├── DESCRIPTION.md   # Rich description (optional, takes precedence)
├── shader.json      # Shader config (if enabled)
├── README.md        # Theme documentation
└── images/          # Screenshots (required)
    └── preview.png
```

## RICS

Themes use [RICS](https://github.com/better-lyrics/rics) - a lightweight CSS preprocessor with full CSS parity. RICS adds variables, nesting, and mixins while staying close to standard CSS.

**Any valid CSS is also valid RICS**, so you can write plain CSS if you prefer.

```scss
$accent: #ff6b6b;

.lyrics-container {
  background: rgba(0, 0, 0, 0.8);

  .lyrics-line {
    color: $accent;

    &.active {
      font-weight: bold;
    }
  }
}
```

- **Playground:** https://rics.boidu.dev
- **RICS Docs:** https://github.com/better-lyrics/rics

> **Note:** Both `.rics` and `.css` files are supported. The validator prefers `.rics` if both exist.

### Theme Description Options

You can provide your theme description in two ways:

1. **`description` field in metadata.json** - Simple, inline description for basic themes
2. **`DESCRIPTION.md` file** - For richer descriptions with formatting (recommended for longer descriptions)

If both exist, `DESCRIPTION.md` takes precedence. At least one must be present.

Better Lyrics supports **GitHub Flavored Markdown (GFM)** in DESCRIPTION.md, so you can use:
- **Bold**, *italic*, and other text formatting
- [Links](https://example.com) and images
- Lists, tables, and code blocks
- Any other GFM features

## Theme Development

1. **Edit `style.rics`** - Add your custom styles using RICS or plain CSS. Use browser DevTools to inspect Better Lyrics elements and find the right selectors.

2. **Add screenshots** - Place at least one preview image in `images/`. Recommended size: 1280x720 (16:9 aspect ratio).

3. **Update `metadata.json`** - Ensure all fields are correct before submission.

4. **Test locally** - Install your theme via "Install from URL" in Better Lyrics using your local path or GitHub repo URL.

**Resources:**
- [Styling Guide](https://github.com/better-lyrics/better-lyrics/blob/master/STYLING.md) - Available selectors and styling reference

## Submitting to Theme Store

1. Push your theme to a GitHub repository
2. Open a [Submit theme issue](https://github.com/better-lyrics/themes/issues/new?template=submit-theme.yml) and enter your repo

A pull request gets opened and checked for you. Once a maintainer merges it, your theme is live.

### Auto-Publishing

After your theme is registered, install the [Better Lyrics Harmonizer](https://github.com/apps/better-lyrics-harmonizer/installations/new) GitHub App on your repo. This enables automatic updates:

1. Bump your version: `create-bl-theme bump patch`
2. Commit and push
3. The registry automatically validates and publishes your update

Use `create-bl-theme publish` to check your publishing status.

## License

MIT
