#!/usr/bin/env node

import prompts from "prompts";
import pc from "picocolors";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { imageSize } from "image-size";
import { execSync, spawn } from "child_process";
import { compileWithDetails } from "rics";
import { DISCORD_URL, migrateForWebgl, withoutBlock } from "./webgl.js";
import { perfReport } from "./perf.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES_DIR = path.join(__dirname, "..", "templates");
const SKILLS_DIR = path.join(__dirname, "..", "skills");

// Recommended image dimensions
const RECOMMENDED_WIDTH = 1280;
const RECOMMENDED_HEIGHT = 720;

// GitHub URL patterns
const GITHUB_URL_PATTERN = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/]+)(?:\/)?(?:\.git)?$/;

// GitHub App URL for auto-updates
const GITHUB_APP_URL = "https://github.com/apps/better-lyrics-harmonizer/installations/new";

// Load package.json for version
const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")
);

// Cross-platform browser opener
const IS_PRERELEASE = pkg.version.includes("-");
/** How to run this release through npx. */
const NPX = `npx create-bl-theme@${IS_PRERELEASE ? "beta" : "latest"}`;

function openBrowser(url) {
  const platform = process.platform;
  let command;
  let args;

  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.unref();
    resolve();
  });
}

// Prompt to install GitHub App for auto-updates
async function promptGitHubAppInstall() {
  console.log();
  console.log(pc.bold("GitHub App Installation"));
  console.log();
  console.log("Install Better Lyrics Harmonizer for automatic theme publishing.");
  console.log(pc.dim("This is a one-time setup. After installing, push changes with a bumped"));
  console.log(pc.dim("version and they'll auto-publish to the theme store (with commit status)."));
  console.log();

  const response = await prompts({
    type: "confirm",
    name: "openBrowser",
    message: "Open browser to install Better Lyrics Harmonizer?",
    initial: true,
  });

  if (response.openBrowser) {
    try {
      await openBrowser(GITHUB_APP_URL);
      console.log(pc.green("  Browser opened!"));
    } catch (err) {
      console.log(pc.yellow("  Could not open browser automatically."));
    }
  }

  console.log();
  console.log(pc.dim("  Install URL:"));
  console.log(pc.cyan(`  ${GITHUB_APP_URL}`));
  console.log();
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Handle flags first (no banner)
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(pkg.version);
    return;
  }

  if (command === "--help" || command === "-h" || command === "help") {
    showHelp();
    return;
  }

  // JSON goes to stdout alone, so it comes before the banner.
  if (command === "perf" && args.includes("--json")) {
    perf(args.slice(1).find((a) => !a.startsWith("-")) || ".", { json: true });
    return;
  }

  console.log();
  console.log(pc.bold(pc.cyan("  Better Lyrics Theme Creator")) + pc.dim(` v${pkg.version}`));
  console.log(pc.dim("  Create themes for Better Lyrics extension"));
  console.log();

  if (command === "validate") {
    await validate(args[1] || ".");
    return;
  }

  if (command === "publish") {
    await publish(args[1] || ".");
    return;
  }

  if (command === "bump") {
    await bump(args[1], args[2]);
    return;
  }

  if (command === "migrate") {
    const rest = args.slice(1);
    const write = rest.includes("--write");
    const target = rest.find((a) => !a.startsWith("-")) || ".";
    await migrate(target, { write });
    return;
  }

  if (command === "perf") {
    perf(args.slice(1).find((a) => !a.startsWith("-")) || ".");
    return;
  }

  if (command === "skill") {
    await skill(args[1] || ".");
    return;
  }

  await create(command);
}

function showHelp() {
  console.log(`
${pc.bold(pc.cyan("create-bl-theme"))} ${pc.dim(`v${pkg.version}`)}
CLI for Better Lyrics themes

${pc.bold("Usage:")}
  ${pc.cyan("create-bl-theme")} [name]              Create a new theme
  ${pc.cyan("create-bl-theme")} validate [dir|url]  Validate a theme (local or GitHub)
  ${pc.cyan("create-bl-theme")} publish [dir]       Check publishing status
  ${pc.cyan("create-bl-theme")} bump [type] [dir]   Bump version (patch, minor, major)
  ${pc.cyan("create-bl-theme")} migrate [dir|file]  Migrate a theme to the current engine and the WebGL renderer
  ${pc.cyan("create-bl-theme")} perf [dir|file]     Show what a theme's effects cost in the WebGL renderer (--json)
  ${pc.cyan("create-bl-theme")} skill [dir]         Install the theme skill into your AI assistants

${pc.bold("Options:")}
  ${pc.cyan("-v, --version")}  Show version number
  ${pc.cyan("-h, --help")}     Show this help message

${pc.bold("Examples:")}
  ${pc.dim("$")} create-bl-theme my-awesome-theme
  ${pc.dim("$")} create-bl-theme validate ./my-theme
  ${pc.dim("$")} create-bl-theme validate https://github.com/user/theme-repo
  ${pc.dim("$")} create-bl-theme publish
  ${pc.dim("$")} create-bl-theme bump patch
  ${pc.dim("$")} create-bl-theme bump minor ./my-theme
  ${pc.dim("$")} create-bl-theme migrate
  ${pc.dim("$")} create-bl-theme migrate ./my-theme --write
  ${pc.dim("$")} create-bl-theme perf ./my-theme
  ${pc.dim("$")} create-bl-theme skill

${pc.bold("Theme Structure:")}
  my-theme/
  ├── metadata.json        ${pc.dim("# Required - Theme metadata")}
  ├── style.rics           ${pc.dim("# Required - Styles (or style.css)")}
  ├── shader.json          ${pc.dim("# Optional - If hasShaders: true")}
  ├── DESCRIPTION.md       ${pc.dim("# Optional - Rich description")}
  ├── cover.png            ${pc.dim("# Optional - Cover image")}
  └── images/              ${pc.dim("# Required - Screenshots")}
      └── preview.png

${pc.bold("Documentation:")}
  ${pc.cyan("https://github.com/better-lyrics/themes")}
`);
}

function isDirectoryEmpty(dirPath) {
  const entries = fs.readdirSync(dirPath);
  return entries.every((entry) => entry.startsWith("."));
}

async function create(targetDir) {
  if (targetDir) {
    const earlyPath = path.resolve(process.cwd(), targetDir);
    if (fs.existsSync(earlyPath) && !isDirectoryEmpty(earlyPath)) {
      const { proceed } = await prompts({
        type: "confirm",
        name: "proceed",
        message: `Directory "${targetDir}" is not empty. Continue anyway? (files may be overwritten)`,
        initial: false,
      });
      if (!proceed) {
        console.log(pc.red("\nCancelled."));
        process.exit(1);
      }
    }
  }

  const questions = [
    {
      type: targetDir ? null : "text",
      name: "directory",
      message: "Theme directory name:",
      initial: "my-bl-theme",
      validate: (value) =>
        value.length > 0 ? true : "Directory name is required",
    },
    {
      type: "text",
      name: "id",
      message: "Theme ID (lowercase, hyphens allowed):",
      initial: (prev) => (targetDir || prev).toLowerCase().replace(/\s+/g, "-"),
      validate: (value) =>
        /^[a-z0-9-]+$/.test(value)
          ? true
          : "Only lowercase letters, numbers, and hyphens allowed",
    },
    {
      type: "text",
      name: "title",
      message: "Theme title:",
      initial: (prev, values) =>
        (targetDir || values.directory)
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
      validate: (value) => (value.length > 0 ? true : "Title is required"),
    },
    {
      type: "text",
      name: "description",
      message: "Description:",
      initial: "A custom theme for Better Lyrics",
    },
    {
      type: "confirm",
      name: "useDescriptionFile",
      message: "Use DESCRIPTION.md for richer formatting? (recommended for longer descriptions)",
      initial: false,
    },
    {
      type: "text",
      name: "creator",
      message: "Your GitHub username:",
      validate: (value) =>
        value.length > 0 ? true : "GitHub username is required",
    },
    {
      type: "multiselect",
      name: "tags",
      message: "Select tags (space to toggle, enter to confirm):",
      choices: [
        { title: "dark", value: "dark" },
        { title: "light", value: "light" },
        { title: "minimal", value: "minimal" },
        { title: "colorful", value: "colorful" },
        { title: "animated", value: "animated" },
        { title: "glassmorphism", value: "glassmorphism" },
        { title: "retro", value: "retro" },
        { title: "neon", value: "neon" },
      ],
      hint: "- Space to select. Return to submit",
    },
    {
      type: "confirm",
      name: "hasShaders",
      message: "Will this theme include shaders?",
      initial: false,
    },
  ];

  const response = await prompts(questions, {
    onCancel: () => {
      console.log(pc.red("\nCancelled."));
      process.exit(1);
    },
  });

  const dir = targetDir || response.directory;
  const fullPath = path.resolve(process.cwd(), dir);

  if (!targetDir && fs.existsSync(fullPath) && !isDirectoryEmpty(fullPath)) {
    const { proceed } = await prompts({
      type: "confirm",
      name: "proceed",
      message: `Directory "${dir}" is not empty. Continue anyway? (files may be overwritten)`,
      initial: false,
    });
    if (!proceed) {
      console.log(pc.red("\nCancelled."));
      process.exit(1);
    }
  }

  console.log();
  console.log(pc.dim(`Creating theme in ${fullPath}...`));

  // Create directories
  fs.mkdirSync(fullPath, { recursive: true });
  fs.mkdirSync(path.join(fullPath, "images"), { recursive: true });

  // Create metadata.json
  const metadata = {
    id: response.id,
    title: response.title,
    creators: [response.creator],
    minVersion: "2.0.5.6",
    hasShaders: response.hasShaders,
    version: "1.0.0",
    tags: response.tags,
    images: ["preview.png"],
  };

  // Only include description in metadata.json if not using DESCRIPTION.md
  if (!response.useDescriptionFile) {
    metadata.description = response.description;
  }

  fs.writeFileSync(
    path.join(fullPath, "metadata.json"),
    JSON.stringify(metadata, null, 2)
  );

  // Create DESCRIPTION.md if user opted for it
  if (response.useDescriptionFile) {
    const descriptionMd = `<!--
  Better Lyrics supports GitHub Flavored Markdown (GFM) for theme descriptions.
  You can use all standard GFM features including:
  - **Bold** and *italic* text
  - [Links](https://example.com)
  - Images: ![alt text](https://example.com/image.png)
  - Lists (ordered and unordered)
  - Code blocks with syntax highlighting
  - Tables
  - And more!

  This file takes precedence over the "description" field in metadata.json.
  Delete this comment block when you're ready to publish.
-->

## Features

- Add your theme features here
- Describe what makes your theme special
- Use **bold** for emphasis on key points

## Preview

<!-- You can embed images directly in your description -->
<!-- ![Theme Preview](https://your-image-url.png) -->

## Installation Notes

Any special instructions for using this theme.

## Compatibility

- Works with Better Lyrics v2.0.5.6+
`;
    fs.writeFileSync(path.join(fullPath, "DESCRIPTION.md"), descriptionMd);
  }

  // Create style.rics from template
  const ricsTemplate = fs.readFileSync(
    path.join(TEMPLATES_DIR, "style.rics"),
    "utf-8"
  );
  fs.writeFileSync(path.join(fullPath, "style.rics"), ricsTemplate);

  // Create shader.json if needed
  if (response.hasShaders) {
    const shaderTemplate = fs.readFileSync(
      path.join(TEMPLATES_DIR, "shader.json"),
      "utf-8"
    );
    fs.writeFileSync(path.join(fullPath, "shader.json"), shaderTemplate);
  }

  // Create README
  const readme = `# ${response.title}

${response.description}

## Installation

1. Open Better Lyrics extension options
2. Go to **Themes** tab
3. Click **Install from URL**
4. Enter: \`https://github.com/${response.creator}/${dir}\`

## Preview

![Preview](images/preview.png)

## License

MIT
`;
  fs.writeFileSync(path.join(fullPath, "README.md"), readme);

  fs.writeFileSync(
    path.join(fullPath, ".gitattributes"),
    "*.rics linguist-language=SCSS\n"
  );

  // Create placeholder image note
  fs.writeFileSync(
    path.join(fullPath, "images", ".gitkeep"),
    "Add your preview screenshots here.\nRecommended: 1280x720 (16:9 aspect ratio)\nRename your main preview to preview.png\n"
  );

  console.log();
  console.log(pc.green("  Theme scaffolded successfully!"));
  console.log();
  console.log(pc.bold("  Next steps:"));
  let stepNum = 1;
  if (dir !== ".") {
    console.log(`  ${pc.dim(`${stepNum}.`)} cd ${dir}`);
    stepNum++;
  }
  console.log(`  ${pc.dim(`${stepNum}.`)} Edit ${pc.cyan("style.rics")} with your theme styles`);
  stepNum++;
  console.log(
    `  ${pc.dim(`${stepNum}.`)} Add a preview screenshot to ${pc.cyan("images/preview.png")}`
  );
  stepNum++;
  if (response.useDescriptionFile) {
    console.log(`  ${pc.dim(`${stepNum}.`)} Edit ${pc.cyan("DESCRIPTION.md")} with your theme description`);
    stepNum++;
  }
  if (response.hasShaders) {
    console.log(`  ${pc.dim(`${stepNum}.`)} Configure ${pc.cyan("shader.json")} for shader effects`);
    stepNum++;
  }
  console.log(
    `  ${pc.dim(`${stepNum}.`)} Push to GitHub, then open a Submit theme issue:`
  );
  console.log(
    `     ${pc.cyan("https://github.com/better-lyrics/themes/issues/new?template=submit-theme.yml")}`
  );
  console.log();
  console.log(pc.bold("  Resources:"));
  console.log(`  ${pc.cyan("RICS")} is a lightweight CSS preprocessor with full CSS parity.`);
  console.log(`  It adds variables, nesting, and mixins - but plain CSS works too!`);
  console.log();
  console.log(`  ${pc.dim("Playground:")}     https://rics.boidu.dev`);
  console.log(`  ${pc.dim("RICS Docs:")}      https://github.com/better-lyrics/rics`);
  console.log(`  ${pc.dim("Styling Guide:")}  https://github.com/better-lyrics/better-lyrics/blob/master/STYLING.md`);
  console.log(`  ${pc.dim("Submit Theme:")}   https://github.com/better-lyrics/themes`);
  console.log();
  console.log(
    pc.dim("  Validate your theme with: ") + pc.cyan(`${NPX} validate ${dir}`)
  );
  console.log();
}

async function validate(dir) {
  let fullPath;
  let tempDir = null;
  let errors = [];
  let warnings = [];

  // Check if input is a GitHub URL
  const githubMatch = dir.match(GITHUB_URL_PATTERN);

  if (githubMatch) {
    const [, owner, repo] = githubMatch;
    const repoUrl = `https://github.com/${owner}/${repo}.git`;

    console.log(pc.dim(`Cloning ${pc.cyan(`${owner}/${repo}`)} from GitHub...\n`));

    try {
      // Create temp directory
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bl-theme-"));
      fullPath = tempDir;

      // Clone the repository (shallow clone for speed)
      execSync(`git clone --depth 1 ${repoUrl} "${tempDir}"`, {
        stdio: "pipe",
      });

      console.log(pc.green(`  Cloned successfully!\n`));
    } catch (e) {
      console.log(pc.red(`Error: Could not clone repository "${owner}/${repo}"`));
      console.log(pc.dim(`  Make sure the repository exists and is publicly accessible.\n`));

      if (e.message) {
        console.log(pc.dim(`  ${e.message}`));
      }

      process.exit(1);
    }
  } else {
    fullPath = path.resolve(process.cwd(), dir);
  }

  console.log(pc.dim(`Validating theme at ${fullPath}...\n`));

  // Check directory exists
  if (!fs.existsSync(fullPath)) {
    console.log(pc.red(`Error: Directory "${dir}" does not exist.`));
    process.exit(1);
  }

  // Check for DESCRIPTION.md
  const descriptionMdPath = path.join(fullPath, "DESCRIPTION.md");
  const hasDescriptionMd = fs.existsSync(descriptionMdPath);

  // Check metadata.json
  const metadataPath = path.join(fullPath, "metadata.json");
  if (!fs.existsSync(metadataPath)) {
    errors.push("metadata.json is missing");
  } else {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
      const required = [
        "id",
        "title",
        "creators",
        "minVersion",
        "hasShaders",
        "version",
        "images",
      ];

      for (const field of required) {
        if (metadata[field] === undefined) {
          errors.push(`metadata.json: missing required field "${field}"`);
        }
      }

      // Validate version format (semver)
      if (metadata.version) {
        const semverRegex = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;
        if (!semverRegex.test(metadata.version)) {
          errors.push(
            `metadata.json: invalid version format "${metadata.version}". Must be semver (e.g., 1.0.0, 1.0.0-beta.1)`
          );
        }
      }

      // Check for description: either in metadata.json OR in DESCRIPTION.md
      if (!metadata.description && !hasDescriptionMd) {
        errors.push(
          'Missing description: add "description" field in metadata.json or create DESCRIPTION.md'
        );
      }

      if (hasDescriptionMd) {
        const descContent = fs.readFileSync(descriptionMdPath, "utf-8").trim();
        if (descContent.length === 0) {
          errors.push("DESCRIPTION.md exists but is empty");
        }
      }

      if (metadata.id && !/^[a-z0-9-]+$/.test(metadata.id)) {
        errors.push(
          "metadata.json: id must be lowercase letters, numbers, and hyphens only"
        );
      }

      if (metadata.creators && !Array.isArray(metadata.creators)) {
        errors.push("metadata.json: creators must be an array");
      }

      if (metadata.images && !Array.isArray(metadata.images)) {
        errors.push("metadata.json: images must be an array");
      }

      // Check if images referenced in metadata.json exist in images/
      if (metadata.images && Array.isArray(metadata.images)) {
        const imagesDir = path.join(fullPath, "images");
        for (const image of metadata.images) {
          const imagePath = path.join(imagesDir, image);
          if (!fs.existsSync(imagePath)) {
            errors.push(
              `metadata.json: image "${image}" not found in images/ directory`
            );
          }
        }
      }

      if (!metadata.tags) {
        warnings.push("metadata.json: consider adding tags for discoverability");
      }
    } catch (e) {
      errors.push(`metadata.json: invalid JSON - ${e.message}`);
    }
  }

  // Check for style.rics or style.css (prefer .rics)
  const ricsPath = path.join(fullPath, "style.rics");
  const cssPath = path.join(fullPath, "style.css");
  const hasRics = fs.existsSync(ricsPath);
  const hasCss = fs.existsSync(cssPath);

  if (!hasRics && !hasCss) {
    errors.push("Missing required file: style.rics or style.css");
  } else if (hasRics) {
    const ricsSource = fs.readFileSync(ricsPath, "utf-8");
    if (ricsSource.trim().length === 0) {
      warnings.push("style.rics is empty");
    } else {
      // Validate RICS syntax
      try {
        const result = compileWithDetails(ricsSource);
        if (result.errors && result.errors.length > 0) {
          for (const err of result.errors) {
            const location = err.start
              ? ` (line ${err.start.line}, column ${err.start.column})`
              : "";
            errors.push(`style.rics: ${err.message}${location}`);
          }
        }
        if (result.warnings && result.warnings.length > 0) {
          for (const warn of result.warnings) {
            warnings.push(`style.rics: ${warn.message || warn}`);
          }
        }
      } catch (e) {
        errors.push(`style.rics: Failed to compile - ${e.message}`);
      }
    }
  } else if (hasCss) {
    const css = fs.readFileSync(cssPath, "utf-8");
    if (css.trim().length === 0) {
      warnings.push("style.css is empty");
    }
  }

  // Check images directory
  const imagesDir = path.join(fullPath, "images");
  if (!fs.existsSync(imagesDir)) {
    errors.push("images/ directory is missing");
  } else {
    const images = fs
      .readdirSync(imagesDir)
      .filter((f) => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
    if (images.length === 0) {
      errors.push("images/ directory must contain at least one image");
    } else {
      // Validate each image
      for (const image of images) {
        const imagePath = path.join(imagesDir, image);

        try {
          const imageBuffer = fs.readFileSync(imagePath);
          const dimensions = imageSize(imageBuffer);

          if (!dimensions || !dimensions.width || !dimensions.height) {
            errors.push(
              `${pc.bold(image)}: Unable to read image dimensions - the file may be corrupted or in an unsupported format`
            );
            continue;
          }

          const { width, height } = dimensions;
          const aspectRatio = (width / height).toFixed(2);
          const recommendedAspectRatio = (RECOMMENDED_WIDTH / RECOMMENDED_HEIGHT).toFixed(2);

          // Only warn if aspect ratio differs from recommended 16:9
          if (aspectRatio !== recommendedAspectRatio) {
            warnings.push(`${pc.bold(image)}: ${width}x${height} (aspect ratio ${aspectRatio})`);
          }
        } catch (e) {
          // Handle corrupted or unreadable images
          if (e.message.includes("unsupported") || e.message.includes("Invalid")) {
            errors.push(
              `${pc.bold(image)}: This image appears to be corrupted or in an unsupported format\n      ${pc.dim("Please ensure the file is a valid image (PNG, JPG, GIF, or WebP)")}`
            );
          } else if (e.code === "ENOENT") {
            errors.push(`${pc.bold(image)}: File not found`);
          } else {
            errors.push(
              `${pc.bold(image)}: Could not validate image - ${e.message}\n      ${pc.dim("The file may be corrupted or inaccessible")}`
            );
          }
        }
      }
    }
  }

  // Check shader.json if hasShaders is true
  if (fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
      if (metadata.hasShaders) {
        const shaderPath = path.join(fullPath, "shader.json");
        if (!fs.existsSync(shaderPath)) {
          errors.push("shader.json is missing but hasShaders is true");
        }
      }
    } catch (e) {
      // Already reported JSON error above
    }
  }

  // Check for cover image (cover.png or first image in images array)
  if (fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
      const hasCoverPng = fs.existsSync(path.join(fullPath, "cover.png"));
      const hasImagesArray = metadata.images && metadata.images.length > 0;

      if (!hasCoverPng && !hasImagesArray) {
        warnings.push("No cover image found. Add cover.png or images to the images/ folder.");
      }
    } catch (e) {
      // Already reported JSON error above
    }
  }

  // Print results
  if (errors.length === 0 && warnings.length === 0) {
    console.log(pc.green("  All checks passed!"));
  } else {
    if (errors.length > 0) {
      console.log(pc.red(pc.bold("  Errors:")));
      errors.forEach((e) => console.log(pc.red(`    - ${e}`)));
    }
    if (warnings.length > 0) {
      console.log(pc.yellow(pc.bold("\n  Warnings:")));
      console.log(pc.yellow("  Non-standard aspect ratios (recommended: 16:9)"));
      warnings.forEach((w) => console.log(pc.yellow(`    - ${w}`)));
      console.log();
      console.log(pc.dim(pc.yellow("  This is just a suggestion - your images will still work fine!")));
      console.log(pc.dim(pc.yellow("  Different aspect ratios can be intentional for your theme's design.")));
    }
  }

  console.log();

  // Prompt to install GitHub App if validation passed
  if (errors.length === 0) {
    await promptGitHubAppInstall();
  }

  // Cleanup temp directory if we cloned from GitHub
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  if (errors.length > 0) {
    process.exit(1);
  }
}

async function publish(dir) {
  const fullPath = path.resolve(process.cwd(), dir);

  console.log(pc.dim(`Checking theme for publishing...\n`));

  // Check directory exists
  if (!fs.existsSync(fullPath)) {
    console.log(pc.red(`Error: Directory "${dir}" does not exist.`));
    process.exit(1);
  }

  // 1. Validate theme first (simple check, not full validation)
  const metadataPath = path.join(fullPath, "metadata.json");
  if (!fs.existsSync(metadataPath)) {
    console.log(pc.red("Error: metadata.json not found."));
    console.log(pc.dim("Run validation first: create-bl-theme validate"));
    process.exit(1);
  }

  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
  } catch (e) {
    console.log(pc.red(`Error: Invalid metadata.json - ${e.message}`));
    process.exit(1);
  }

  // 2. Check git repo
  if (!checkIsGitRepo(fullPath)) {
    console.log(pc.red("Not a git repository. Initialize git first:"));
    console.log(pc.dim("  git init"));
    console.log(pc.dim("  git remote add origin https://github.com/username/theme-name.git"));
    process.exit(1);
  }

  // 3. Get remote info
  const remote = getGitRemote(fullPath);
  if (!remote) {
    console.log(pc.red("No git remote found. Add a remote:"));
    console.log(pc.dim("  git remote add origin https://github.com/username/theme-name.git"));
    process.exit(1);
  }

  // 4. Parse repo from remote
  const repoMatch = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!repoMatch) {
    console.log(pc.red("Could not parse GitHub repo from remote:"), remote);
    process.exit(1);
  }
  const repo = repoMatch[1].replace(/\.git$/, "");

  // 5. Display theme info
  console.log(pc.bold("Theme Info:"));
  console.log(`  ID:      ${metadata.id}`);
  console.log(`  Title:   ${metadata.title}`);
  console.log(`  Version: ${metadata.version}`);
  console.log(`  Repo:    ${repo}`);
  console.log();

  // 6. Check if registered
  const isRegistered = await checkThemeRegistered(repo);

  if (!isRegistered) {
    console.log(pc.yellow("Theme is not registered in the theme store."));
    console.log();
    console.log(pc.bold("To register your theme:"));
    console.log("  Open a Submit theme issue and enter your repo:");
    console.log(`  ${pc.cyan("https://github.com/better-lyrics/themes/issues/new?template=submit-theme.yml")}`);
    console.log();
    console.log(pc.dim("A pull request gets opened and checked for you. After it merges, install the GitHub App for auto-updates:"));
    await promptGitHubAppInstall();
    process.exit(0);
  }

  // 7. Theme is registered
  console.log(pc.green("Theme is registered in the theme store."));
  console.log();
  console.log(pc.bold("To publish updates:"));
  console.log(pc.dim("  git add ."));
  console.log(pc.dim('  git commit -m "feat: update theme"'));
  console.log(pc.dim("  git push"));
  console.log();
  console.log("The registry will automatically:");
  console.log("  - Validate your theme");
  console.log("  - Update the lockfile");
  console.log("  - Vendor your theme files");
  console.log();

  // 8. Check current lockfile status
  const lockStatus = await checkLockStatus(repo);
  if (lockStatus) {
    console.log(pc.bold("Current Registry Status:"));
    console.log(`  Locked Version: ${lockStatus.version}`);
    console.log(`  Locked At:      ${lockStatus.locked}`);
    console.log(`  Commit:         ${lockStatus.commit.slice(0, 7)}`);

    if (metadata.version === lockStatus.version) {
      console.log();
      console.log(pc.yellow("Your local version matches the registry."));
      console.log("Bump the version in metadata.json to publish an update.");
    } else {
      // Compare versions
      const localParts = metadata.version.split(".").map(Number);
      const remoteParts = lockStatus.version.split(".").map(Number);
      let isGreater = false;

      for (let i = 0; i < 3; i++) {
        if (localParts[i] > remoteParts[i]) {
          isGreater = true;
          break;
        } else if (localParts[i] < remoteParts[i]) {
          break;
        }
      }

      if (isGreater) {
        console.log();
        console.log(pc.green(`Ready to publish: ${lockStatus.version} -> ${metadata.version}`));
        console.log("Push to your repo to trigger an update.");
      } else {
        console.log();
        console.log(pc.red(`Version ${metadata.version} is not greater than ${lockStatus.version}`));
        console.log("Versions must increase. Update metadata.json with a higher version.");
      }
    }
  }

  // Prompt to install GitHub App for auto-updates
  await promptGitHubAppInstall();
}

function checkIsGitRepo(themePath) {
  try {
    execSync("git rev-parse --git-dir", { cwd: themePath, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getGitRemote(themePath) {
  try {
    return execSync("git remote get-url origin", { cwd: themePath, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function checkThemeRegistered(repo) {
  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/better-lyrics/themes/master/index.json"
    );
    if (!response.ok) {
      console.log(pc.dim(`  (Could not fetch registry: ${response.status})`));
      return false;
    }
    const index = await response.json();
    return index.themes?.some((t) => t.repo === repo) ?? false;
  } catch (e) {
    console.log(pc.dim(`  (Could not fetch registry: ${e.message})`));
    return false;
  }
}

async function checkLockStatus(repo) {
  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/better-lyrics/themes/master/index.lock.json"
    );
    const lock = await response.json();
    return lock.themes?.find((t) => t.repo === repo) ?? null;
  } catch {
    return null;
  }
}

async function bump(typeOrDir, dirArg) {
  // Handle flexible argument order: bump [type] [dir] or bump [dir]
  let type = "patch";
  let dir = ".";

  const validTypes = ["patch", "minor", "major"];

  if (typeOrDir) {
    if (validTypes.includes(typeOrDir)) {
      type = typeOrDir;
      dir = dirArg || ".";
    } else {
      // Assume it's a directory
      dir = typeOrDir;
    }
  }

  const fullPath = path.resolve(process.cwd(), dir);
  const metadataPath = path.join(fullPath, "metadata.json");

  // Check metadata.json exists
  if (!fs.existsSync(metadataPath)) {
    console.log(pc.red("Error: metadata.json not found."));
    process.exit(1);
  }

  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
  } catch (e) {
    console.log(pc.red(`Error: Invalid metadata.json - ${e.message}`));
    process.exit(1);
  }

  const currentVersion = metadata.version;
  if (!currentVersion) {
    console.log(pc.red("Error: No version field in metadata.json"));
    process.exit(1);
  }

  // Parse current version
  const match = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) {
    console.log(pc.red(`Error: Invalid version format "${currentVersion}"`));
    process.exit(1);
  }

  let [, major, minor, patch, prerelease] = match;
  major = parseInt(major, 10);
  minor = parseInt(minor, 10);
  patch = parseInt(patch, 10);

  // Bump version
  switch (type) {
    case "major":
      major++;
      minor = 0;
      patch = 0;
      prerelease = "";
      break;
    case "minor":
      minor++;
      patch = 0;
      prerelease = "";
      break;
    case "patch":
    default:
      patch++;
      prerelease = "";
      break;
  }

  const newVersion = `${major}.${minor}.${patch}`;
  metadata.version = newVersion;

  // Write back
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");

  console.log(pc.green(`  ${currentVersion} → ${newVersion}`));
  console.log();
  console.log(pc.dim(`  Updated ${metadataPath}`));
  console.log();
}

// ---------------------------------------------------------------------------
// Theme migration (old class-toggle engine -> new Web Animations API engine)
//
// Rewrites the unambiguous changes and flags the ones that need a human
// decision. Every rewrite matches a literal token (a class name or a var()
// call), so it is safe on both plain CSS and RICS source. The full mapping,
// including the intent-level cases the codemod only flags, is in
// skills/MIGRATION.md.
// ---------------------------------------------------------------------------

/**
 * The style file a target names: a file path is used directly; a directory prefers style.rics,
 * then style.css (same rule as validate). Exits when there is none.
 */
function stylePathOf(target, log = console.log) {
  const resolved = path.resolve(process.cwd(), target);

  if (!fs.existsSync(resolved)) {
    log(pc.red(`Error: "${target}" does not exist.`));
    process.exit(1);
  }

  if (!fs.statSync(resolved).isDirectory()) return resolved;
  const ricsPath = path.join(resolved, "style.rics");
  const cssPath = path.join(resolved, "style.css");
  if (fs.existsSync(ricsPath)) return ricsPath;
  if (fs.existsSync(cssPath)) return cssPath;
  log(pc.red(`Error: no style.rics or style.css in "${target}".`));
  process.exit(1);
}

/** `text` as CSS: compiled when it is RICS. Returns { css, errors }. */
function compiledStyle(stylePath, text) {
  if (!stylePath.endsWith(".rics")) return { css: text, errors: [] };
  try {
    const result = compileWithDetails(text);
    return { css: result.css, errors: result.errors.map((err) => err.message) };
  } catch (e) {
    return { css: "", errors: [e.message] };
  }
}

async function migrate(target, { write } = {}) {
  const stylePath = stylePathOf(target);
  const source = fs.readFileSync(stylePath, "utf-8");
  const engine = migrateSource(source);
  // The WebGL renderer pass reads the compiled CSS, so RICS nesting and variables are resolved.
  const { css: compiled, errors } = compiledStyle(stylePath, withoutBlock(engine.output));
  // Values read from half a theme would be wrong, so nothing is written from one.
  if (errors.length > 0) {
    console.log(pc.red(pc.bold("  style.rics does not compile, so nothing was migrated. Fix this and run migrate again:")));
    errors.forEach((message) => console.log(pc.red(`    - ${message}`)));
    console.log();
    process.exit(1);
  }
  const webgl = migrateForWebgl(engine.output, compiled);
  const output = webgl.output;
  // The two passes are reported apart: the WebGL findings stand on their own, and the old engine's
  // still matter to the current DOM renderer. A flag the WebGL block settles is not repeated.
  const sections = [
    {
      title: "WebGL renderer",
      changes: webgl.changes,
      flags: webgl.flags.map(placed),
      unsupported: webgl.unsupported.map(placed),
    },
    {
      title: "Current renderer (left over from the old animation engine)",
      changes: engine.changes,
      flags: engine.flags.filter((f) => !webgl.settles.includes(f.code)),
      unsupported: [],
    },
  ];
  const changes = sections.flatMap((s) => s.changes);
  const flags = sections.flatMap((s) => s.flags);
  const unsupported = sections.flatMap((s) => s.unsupported);

  const rel = path.relative(process.cwd(), stylePath);
  const shown = rel && !rel.startsWith("..") ? rel : stylePath;

  console.log(pc.bold(`  Migrating ${pc.cyan(shown)}`));
  console.log(pc.dim(`  auto-applied: ${changes.length}    needs review: ${flags.length}    not possible yet: ${unsupported.length}`));
  console.log();

  if (changes.length === 0 && flags.length === 0 && unsupported.length === 0) {
    console.log(pc.green("  Nothing to migrate. This theme only uses stable selectors and variables."));
    console.log();
    return;
  }

  for (const section of sections) {
    if (section.changes.length === 0 && section.flags.length === 0 && section.unsupported.length === 0) continue;
    console.log(pc.bold(pc.underline(`  ${section.title}`)));
    console.log();

    if (section.changes.length > 0) {
      console.log(pc.green(pc.bold("  Applied automatically:")));
      section.changes.forEach((c) => console.log(pc.dim(`    L${c.line}  `) + c.message));
      console.log();
    }

    if (section.flags.length > 0) {
      console.log(pc.yellow(pc.bold("  Needs review (not changed):")));
      section.flags.forEach((f) => console.log(pc.yellow(`    ${f.at}  `) + f.message));
      console.log();
    }

    if (section.unsupported.length > 0) {
      console.log(pc.magenta(pc.bold("  Not possible in the WebGL renderer yet:")));
      section.unsupported.forEach((f) => console.log(pc.magenta(`    ${f.at}  `) + f.message));
      console.log();
      console.log(pc.magenta("  If your theme needs one of these, ask in the Better Lyrics Discord so it can be added to"));
      console.log(pc.magenta("  the renderer: ") + pc.cyan(DISCORD_URL));
      console.log();
    }
  }

  if (!write) {
    console.log(pc.dim("  This was a preview. Re-run with ") + pc.cyan("--write") + pc.dim(" to apply the automatic fixes."));
    console.log();
    return;
  }

  fs.writeFileSync(stylePath, output);
  console.log(pc.green(`  Wrote ${shown}`));

  // Re-validate RICS still compiles after writing, same check as validate.
  if (stylePath.endsWith(".rics")) {
    try {
      const result = compileWithDetails(output);
      if (result.errors && result.errors.length > 0) {
        console.log(pc.red(pc.bold("  Warning: migrated style.rics no longer compiles:")));
        result.errors.forEach((err) => {
          const loc = err.start ? ` (line ${err.start.line}, column ${err.start.column})` : "";
          console.log(pc.red(`    - ${err.message}${loc}`));
        });
      } else {
        console.log(pc.dim("  RICS still compiles cleanly."));
      }
    } catch (e) {
      console.log(pc.red(`  Warning: could not compile migrated RICS - ${e.message}`));
    }
  }

  if (flags.length > 0) {
    console.log();
    console.log(pc.yellow("  Resolve the review items above by hand, then run ") + pc.cyan("validate") + pc.yellow("."));
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Perf report: which features of the WebGL renderer a theme turns on and what
// each costs (bin/perf.js, with the costs in bin/perf-costs.js).
// ---------------------------------------------------------------------------

function perf(target, { json } = {}) {
  const log = json ? console.error : console.log;
  const stylePath = stylePathOf(target, log);
  // The block migrate wrote is what the WebGL renderer reads, so it is read too.
  const source = fs.readFileSync(stylePath, "utf-8");
  const { css, errors } = compiledStyle(stylePath, source);
  if (errors.length > 0) {
    log(pc.red(pc.bold("  style.rics does not compile, so it cannot be read:")));
    errors.forEach((message) => log(pc.red(`    - ${message}`)));
    process.exit(1);
  }
  const report = perfReport(css);
  // What migrate would still write: until then the report sees the variables only, not the rules.
  const migrated = migrateForWebgl(source, compiledStyle(stylePath, withoutBlock(source)).css).output === source;
  const rel = path.relative(process.cwd(), stylePath);
  const shown = rel && !rel.startsWith("..") ? rel : stylePath;
  if (json) {
    console.log(JSON.stringify({ file: shown, migrated, ...report }, null, 2));
    return;
  }

  const paint = { low: pc.green, medium: pc.yellow, high: pc.red };
  const label = (cost) => paint[cost](pc.bold(cost.toUpperCase().padEnd(6)));
  console.log(pc.bold(`  What ${pc.cyan(shown)} costs in the WebGL renderer`));
  console.log();
  if (!migrated) {
    console.log(pc.yellow(`  migrate would still change this theme; run ${pc.cyan("migrate --write")} first, since this report reads only the renderer's variables.`));
    console.log();
  }
  for (const feature of report.features) {
    console.log(`  ${label(feature.cost)}  ${pc.bold(feature.title)}: ${feature.reason}.`);
    for (const source of feature.source) console.log(pc.dim(`          ${source}`));
    if (feature.tip) console.log(`          ${pc.cyan("Cheaper:")} ${feature.tip}`);
    console.log();
  }
  const because = report.features.filter((f) => report.because.includes(f.id)).map((f) => f.title.toLowerCase());
  console.log(`  ${pc.bold("Overall:")} ${label(report.overall).trim()}${because.length ? pc.dim(`, from ${because.join(" and ")}`) : ""}`);
  console.log(pc.dim("  Costs are the GPU time each feature adds to a frame on a desktop GPU: low is under 0.05 ms, medium up to"));
  console.log(pc.dim("  0.25 ms, high more. A frame at 60 fps has 16.7 ms, so even high matters mostly on slow or battery-saving GPUs."));
  console.log();
}

/** A WebGL pass finding with `at`, where it applies, in the shape the old-engine flags print. */
function placed(item) {
  const where = item.where.filter(Boolean);
  if (where.length === 0) return { ...item, at: "" };
  // A selector's end says which elements it picks, so long ones keep their end.
  const shown = where.slice(0, 2).map((w) => (w.length > 70 ? `...${w.slice(-67)}` : w));
  const more = where.length > 2 ? ` (+${where.length - 2} more)` : "";
  return { ...item, at: `${shown.join(", ")}${more}\n     ` };
}

// Pure transform: returns { output, changes, flags }.
function migrateSource(source) {
  const changes = [];
  const flags = [];
  let out = source;
  const note = (list, line, code, message) => list.push({ line, code, message });

  // 1. Renamed class: zero-duration animate -> line-synced word.
  out = out.replace(/\.blyrics-zero-dur-animate\b/g, (_m, offset) => {
    note(changes, lineOf(out, offset), "rename-class", ".blyrics-zero-dur-animate -> .blyrics-line-synced-word");
    return ".blyrics-line-synced-word";
  });

  // 2. `.blyrics--animating`: on a line it still exists and must be left alone; on a
  //    word there is no class equivalent (the engine animates the word overlay), so flag it.
  out = replaceTokens(out, /\.blyrics--animating\b/g, (offset, text) => {
    const compound = compoundAround(text, offset);
    if (/blyrics--word/.test(compound)) {
      note(flags, lineOf(text, offset), "word-active-state", "`.blyrics--word.blyrics--animating` has no equivalent: the engine now animates each word's `::after` via the Web Animations API. Remove the per-word active rule or drive it from `--blyrics-duration` / `[data-long-word]`.");
    }
    return null;
  });

  // 3. Dead timing variable `--blyrics-anim-delay`: collapse to fallback, else 0s.
  out = out.replace(/var\(\s*--blyrics-anim-delay\s*,\s*([^()]*?)\)/g, (_m, fallback, offset) => {
    const value = fallback.trim() || "0s";
    note(changes, lineOf(out, offset), "dead-var", `var(--blyrics-anim-delay, ...) -> ${value} (stagger is now engine-owned)`);
    return value;
  });
  out = out.replace(/var\(\s*--blyrics-anim-delay\s*\)/g, (_m, offset) => {
    note(changes, lineOf(out, offset), "dead-var", "var(--blyrics-anim-delay) -> 0s (no fallback; kept declaration valid)");
    return "0s";
  });

  // Flags: removed hooks that need a human decision.
  scanFlags(out, flags, /\.blyrics--pre-animating\b/g, "removed-class", "`.blyrics--pre-animating` was removed. It reset the karaoke gradient before a line played; the engine handles that. Delete the rule.");
  scanFlags(out, flags, /\.blyrics--break\b/g, "removed-class", "`.blyrics--break` (flex line-break spacer) was removed. Lines are normal inline text flow now; delete the rule.");
  scanFlags(out, flags, /\.blyrics--has-trailing-space\b/g, "removed-class", "`.blyrics--has-trailing-space` was removed. Word spacing is real whitespace now; delete the rule.");

  // Flags: DOM nesting changed (words are no longer direct <span> children).
  scanFlags(out, flags, /\.blyrics-container\s*>\s*div\s*>\s*span/g, "dom-nesting", "`.blyrics-container > div > span` no longer selects words. Target `.blyrics--word` (words are nested now); translations/romanizations are `<div>`, not `<span>`.");
  scanFlags(out, flags, /\.blyrics--line\s*>\s*span/g, "dom-nesting", "`.blyrics--line > span` no longer selects words directly. Use `.blyrics--word`, or a row wrapper (`.blyrics-line-main` / `.blyrics-background-line`).");
  scanFlags(out, flags, /span\.blyrics--(?:translated|romanized)\b/g, "dom-nesting", "Translations/romanizations are `<div class=\"blyrics--translated blyrics-content-line\">` now, not `<span>`. Drop the `span` type selector.");
  scanFlags(out, flags, />\s*span\s*>\s*span\.blyrics-background-lyric\b/g, "dom-nesting", "Background vocals moved to a `.blyrics-background-line` row as `.blyrics-word-group.blyrics-background-lyric`. A plain `.blyrics-background-lyric` selector still matches; this structural `> span > span` form does not.");

  // Flag: `.blyrics--word::after` glow without the long-word overlay.
  if (/\.blyrics--word\s*::?after/.test(out) && !/\.blyrics-word-highlight\b/.test(out)) {
    const m = /\.blyrics--word\s*::?after/.exec(out);
    note(flags, lineOf(out, m.index), "long-word-overlay", "Rules on `.blyrics--word::after` should also target `.blyrics-word-highlight`; long wrapped words render their highlight in a real `.blyrics-word-highlight` child, not `::after`.");
  }

  // Flag: flexbox layout on the lyric line (flat-CSS blocks only).
  scanFlags(out, flags, /\.blyrics--line[^{}]*\{[^{}]*(?:display\s*:\s*flex|flex-flow|justify-content|align-content|align-items)/g, "line-layout", "The lyric line is no longer a flexbox. Agent alignment uses `text-align` + `transform-origin` (e.g. `[data-agent=\"v2\"] { text-align: right }`). Re-express any flex/justify layout on `.blyrics--line`.");

  // Flag: redefined engine keyframes. The WAAPI engine no longer reads these; it
  // builds keyframes from CSS variables, so a redefinition is silently dead.
  scanFlags(out, flags, /@keyframes\s+blyrics-wobble\b/g, "dead-keyframe", "The engine no longer reads `@keyframes blyrics-wobble`. Translate its transform stops to `--blyrics-word-wobble-transform-{from,peak,settle,to}` (with `--blyrics-word-wobble-peak-offset` / `--blyrics-word-wobble-settle-offset`), or set `--blyrics-animate-word-wobble: 0` to disable the wobble. Otherwise the default horizontal wobble comes back.");
  scanFlags(out, flags, /@keyframes\s+blyrics-glow\b/g, "dead-keyframe", "The engine no longer reads `@keyframes blyrics-glow`. Use `--blyrics-highlight-glow-filter-from` / `--blyrics-highlight-glow-filter-to` (and `--blyrics-glow-color`), or `--blyrics-animate-highlight-glow: 0` to disable.");

  // Flag: an engine variable set on ::after only. The engine animates the word's
  // `::after` AND a `.blyrics-word-highlight` child; set inherited vars on the word.
  scanFlags(out, flags, /::after[^{}]*\{[^{}]*--blyrics-(?:glow-color|duration|highlight)/g, "var-on-pseudo", "This sets an engine variable on `::after`. The engine also animates a `.blyrics-word-highlight` child for long words. Set the variable on `.blyrics--word` (and `.blyrics--word[data-long-word]`) instead, so it inherits to both overlays.");

  // Flag: anything the auto-pass could not simplify.
  scanFlags(out, flags, /--blyrics-anim-delay/g, "dead-var-residual", "Leftover `--blyrics-anim-delay` reference the auto-pass could not simplify (nested fallback?). Replace it with a static delay; the engine no longer sets this variable.");

  dedupeFlags(flags);
  return { output: out, changes, flags: flags.map((f) => ({ ...f, at: `L${f.line}` })) };
}

function compoundAround(text, index) {
  const boundary = new Set([" ", "\t", "\n", "\r", ">", "+", "~", ",", "{", "}", ";"]);
  let start = index;
  let depth = 0;
  while (start > 0) {
    const ch = text[start - 1];
    if (ch === ")") depth++;
    else if (ch === "(") depth--;
    else if (depth === 0 && boundary.has(ch)) break;
    start--;
  }
  let end = index;
  depth = 0;
  while (end < text.length) {
    const ch = text[end];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && boundary.has(ch)) break;
    end++;
  }
  return text.slice(start, end);
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

function replaceTokens(text, regex, cb) {
  let result = "";
  let last = 0;
  for (const m of text.matchAll(regex)) {
    const replacement = cb(m.index, text);
    if (replacement === null) continue;
    result += text.slice(last, m.index) + replacement;
    last = m.index + m[0].length;
  }
  return result + text.slice(last);
}

function scanFlags(text, flags, regex, code, message) {
  for (const m of text.matchAll(regex)) flags.push({ line: lineOf(text, m.index), code, message });
}

function dedupeFlags(flags) {
  const seen = new Set();
  for (let i = flags.length - 1; i >= 0; i--) {
    const key = `${flags[i].line}:${flags[i].code}`;
    if (seen.has(key)) flags.splice(i, 1);
    else seen.add(key);
  }
  flags.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------
// Skill installer: writes the Better Lyrics theme skill into whichever AI
// coding assistants the user has. The authoring guide is fetched fresh from the
// better-lyrics repo on every install, so it never goes stale; the migration
// guide is this package's own skills/MIGRATION.md. Detects installed assistants
// from marker folders and pre-selects them in the prompt.
// ---------------------------------------------------------------------------

const SKILL_NAME = "better-lyrics-themes";
const SKILL_DESCRIPTION =
  "Better Lyrics theme development: selectors, CSS variables, DOM structure, and migration from the old animation engine and to the WebGL renderer. Use when creating, editing, or migrating a Better Lyrics theme (.rics or .css).";
const SKILL_BEGIN = "<!-- BEGIN better-lyrics-themes (create-bl-theme) -->";
const SKILL_END = "<!-- END better-lyrics-themes (create-bl-theme) -->";

// The authoring guide lives in the extension repo and is fetched fresh on every
// install so it never drifts from the canonical version. This package owns only
// the migration guide (skills/MIGRATION.md).
const AUTHORING_SKILL_RAW_URLS = [
  // Until the WebGL renderer ships, the guide that describes it is on its branch; master's is for the
  // DOM renderer, whose advice the WebGL migration guide contradicts. Once that branch is merged
  // and gone, master's is the one.
  ...(IS_PRERELEASE ? ["https://raw.githubusercontent.com/better-lyrics/better-lyrics/feat/rust-renderer/STYLING-SKILL.md"] : []),
  "https://raw.githubusercontent.com/better-lyrics/better-lyrics/master/STYLING-SKILL.md",
];
const AUTHORING_SKILL_DOC_URL =
  "https://github.com/better-lyrics/better-lyrics/blob/master/STYLING-SKILL.md";

async function fetchAuthoringSkill() {
  for (const url of AUTHORING_SKILL_RAW_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      if (text.trim()) return text;
    } catch {
      return null; // Offline: the next would fail the same way.
    }
  }
  return null;
}

function assistantRegistry(dir, home) {
  const has = (...p) => p.some((f) => fs.existsSync(f));
  return [
    {
      key: "claude",
      title: "Claude Code",
      detected: has(path.join(dir, ".claude"), path.join(home, ".claude")),
      install: (body) => {
        const skillDir = path.join(dir, ".claude", "skills", SKILL_NAME);
        fs.mkdirSync(skillDir, { recursive: true });
        const out = path.join(skillDir, "SKILL.md");
        const frontmatter = `---\nname: ${SKILL_NAME}\ndescription: ${SKILL_DESCRIPTION}\n---\n\n`;
        fs.writeFileSync(out, frontmatter + body);
        return out;
      },
    },
    {
      key: "agents",
      title: "AGENTS.md (Codex and others)",
      detected: has(path.join(dir, "AGENTS.md"), path.join(home, ".codex")),
      install: (body) => writeMarkerDoc(path.join(dir, "AGENTS.md"), body),
    },
    {
      key: "gemini",
      title: "Gemini CLI",
      detected: has(path.join(dir, ".gemini"), path.join(dir, "GEMINI.md"), path.join(home, ".gemini")),
      install: (body) => writeMarkerDoc(path.join(dir, "GEMINI.md"), body),
    },
    {
      key: "cursor",
      title: "Cursor",
      detected: has(path.join(dir, ".cursor"), path.join(dir, ".cursorrules"), path.join(home, ".cursor")),
      install: (body) => {
        const rulesDir = path.join(dir, ".cursor", "rules");
        fs.mkdirSync(rulesDir, { recursive: true });
        const out = path.join(rulesDir, `${SKILL_NAME}.mdc`);
        const frontmatter = `---\ndescription: ${SKILL_DESCRIPTION}\nglobs: **/*.rics, **/*.css\nalwaysApply: false\n---\n\n`;
        fs.writeFileSync(out, frontmatter + body);
        return out;
      },
    },
  ];
}

// Insert or replace a marked block in a shared markdown file (AGENTS.md,
// GEMINI.md), so re-running does not duplicate the skill. If the markers are
// orphaned (only one present) or out of order, strip every literal marker and
// append a fresh block, so a hand-edited file never accumulates duplicates.
function writeMarkerDoc(filePath, body) {
  const block = `${SKILL_BEGIN}\n\n${body}\n\n${SKILL_END}`;
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  const start = content.indexOf(SKILL_BEGIN);
  const end = content.indexOf(SKILL_END);
  if (start !== -1 && end !== -1 && end > start) {
    content = content.slice(0, start) + block + content.slice(end + SKILL_END.length);
  } else {
    content = content.split(SKILL_BEGIN).join("").split(SKILL_END).join("");
    const trimmed = content.trimEnd();
    content = trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
  }
  fs.writeFileSync(filePath, content);
  return filePath;
}

async function skill(targetDir) {
  const dir = path.resolve(process.cwd(), targetDir);
  const home = os.homedir();

  const migrationPath = path.join(SKILLS_DIR, "MIGRATION.md");
  if (!fs.existsSync(migrationPath)) {
    console.log(pc.red("Error: bundled migration guide is missing from this install."));
    process.exit(1);
  }
  const migration = fs.readFileSync(migrationPath, "utf-8").trim();

  const assistants = assistantRegistry(dir, home);
  const anyDetected = assistants.some((a) => a.detected);

  console.log(pc.dim(`  Installing into ${dir}`));
  if (anyDetected) {
    console.log(pc.dim(`  Detected: ${assistants.filter((a) => a.detected).map((a) => a.title).join(", ")}`));
  } else {
    console.log(pc.dim("  No assistants detected. Pick the ones you use."));
  }
  console.log();

  const response = await prompts(
    {
      type: "multiselect",
      name: "targets",
      message: "Install the Better Lyrics theme skill into:",
      choices: assistants.map((a) => ({
        title: a.detected ? `${a.title} ${pc.dim("(detected)")}` : a.title,
        value: a.key,
        selected: a.detected,
      })),
      hint: "- Space to toggle, Return to confirm",
      instructions: false,
    },
    {
      onCancel: () => {
        console.log(pc.red("\nCancelled."));
        process.exit(1);
      },
    }
  );

  const chosen = response.targets || [];
  if (chosen.length === 0) {
    console.log(pc.yellow("  Nothing selected."));
    console.log();
    return;
  }

  console.log();
  console.log(pc.dim("  Fetching the latest authoring guide from better-lyrics..."));
  const authoring = await fetchAuthoringSkill();

  let body;
  if (authoring) {
    body = `${authoring.trimEnd()}\n\n${migration}\n`;
  } else {
    console.log(pc.yellow("  Could not fetch the authoring guide (offline?). Installing the migration guide only."));
    console.log(pc.dim(`  Full authoring guide: ${AUTHORING_SKILL_DOC_URL}`));
    body = `${migration}\n`;
  }

  console.log();
  for (const key of chosen) {
    const assistant = assistants.find((a) => a.key === key);
    try {
      const out = assistant.install(body);
      const rel = path.relative(dir, out);
      console.log(pc.green(`  ${assistant.title}: `) + pc.dim(rel && !rel.startsWith("..") ? rel : out));
    } catch (e) {
      console.log(pc.red(`  ${assistant.title}: failed - ${e.message}`));
    }
  }
  console.log();
  console.log(pc.dim("  Reload or restart your assistant to pick up the skill."));
  console.log();
}

main().catch((err) => {
  console.error(pc.red(err.message));
  process.exit(1);
});
