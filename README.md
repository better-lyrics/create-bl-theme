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
create-bl-theme validate [directory]
```

Checks that your theme has all required files and valid metadata.

## Generated Structure

```
my-theme/
├── metadata.json   # Theme metadata (required)
├── style.css       # Your CSS styles (required)
├── shader.json     # Shader config (if enabled)
├── README.md       # Theme documentation
└── images/         # Screenshots (required)
    └── preview.png
```

## Theme Development

1. **Edit `style.css`** - Add your custom styles. Use browser DevTools to inspect Better Lyrics elements and find the right selectors.

2. **Add screenshots** - Place at least one preview image in `images/`. Recommended size: 1280x720 (16:9 aspect ratio).

3. **Update `metadata.json`** - Ensure all fields are correct before submission.

4. **Test locally** - Install your theme via "Install from URL" in Better Lyrics using your local path or GitHub repo URL.

## Submitting to Theme Store

1. Push your theme to a GitHub repository
2. Fork [better-lyrics-themes](https://github.com/better-lyrics/better-lyrics-themes)
3. Add your theme to `index.json`:
   ```json
   {
     "themes": [
       { "repo": "your-username/your-theme-repo" }
     ]
   }
   ```
4. Open a pull request

## License

MIT
