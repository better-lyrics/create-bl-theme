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
2. Fork [themes](https://github.com/better-lyrics/themes)
3. Add your theme to `index.json`:
   ```json
   {
     "themes": [
       { "repo": "your-username/your-theme-repo" }
     ]
   }
   ```
4. Open a pull request

### Auto-Publishing

After your theme is registered, install the [Better Lyrics Themes](https://github.com/marketplace/better-lyrics-themes) GitHub App on your repo. This enables automatic updates:

1. Bump your version: `create-bl-theme bump patch`
2. Commit and push
3. The registry automatically validates and publishes your update

Use `create-bl-theme publish` to check your publishing status.

## License

MIT
