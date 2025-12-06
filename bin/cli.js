#!/usr/bin/env node

import prompts from "prompts";
import pc from "picocolors";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { imageSize } from "image-size";
import { execSync } from "child_process";
import { compileWithDetails } from "rics";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

// Recommended image dimensions
const RECOMMENDED_WIDTH = 1280;
const RECOMMENDED_HEIGHT = 720;

// GitHub URL patterns
const GITHUB_URL_PATTERN = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/]+)(?:\/)?(?:\.git)?$/;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log();
  console.log(pc.bold(pc.cyan("  Better Lyrics Theme Creator")));
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

  if (command === "help" || command === "--help" || command === "-h") {
    showHelp();
    return;
  }

  await create(command);
}

function showHelp() {
  console.log(`${pc.bold("Usage:")}
  ${pc.cyan("create-bl-theme")} [name]              Create a new theme
  ${pc.cyan("create-bl-theme")} validate [dir|url]  Validate a theme (local or GitHub)
  ${pc.cyan("create-bl-theme")} publish [dir]       Check publishing status

${pc.bold("Examples:")}
  ${pc.dim("$")} create-bl-theme my-awesome-theme
  ${pc.dim("$")} create-bl-theme validate ./my-theme
  ${pc.dim("$")} create-bl-theme validate https://github.com/user/theme-repo
  ${pc.dim("$")} create-bl-theme publish

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

async function create(targetDir) {
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

  if (fs.existsSync(fullPath)) {
    console.log(pc.red(`\nError: Directory "${dir}" already exists.`));
    process.exit(1);
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

  // Create placeholder image note
  fs.writeFileSync(
    path.join(fullPath, "images", ".gitkeep"),
    "Add your preview screenshots here.\nRecommended: 1280x720 (16:9 aspect ratio)\nRename your main preview to preview.png\n"
  );

  console.log();
  console.log(pc.green("  Theme scaffolded successfully!"));
  console.log();
  console.log(pc.bold("  Next steps:"));
  console.log(`  ${pc.dim("1.")} cd ${dir}`);
  console.log(`  ${pc.dim("2.")} Edit ${pc.cyan("style.rics")} with your theme styles`);
  console.log(
    `  ${pc.dim("3.")} Add a preview screenshot to ${pc.cyan("images/preview.png")}`
  );
  let stepNum = 4;
  if (response.useDescriptionFile) {
    console.log(`  ${pc.dim(`${stepNum}.`)} Edit ${pc.cyan("DESCRIPTION.md")} with your theme description`);
    stepNum++;
  }
  if (response.hasShaders) {
    console.log(`  ${pc.dim(`${stepNum}.`)} Configure ${pc.cyan("shader.json")} for shader effects`);
    stepNum++;
  }
  console.log(
    `  ${pc.dim(`${stepNum}.`)} Push to GitHub and submit to the theme store`
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
    pc.dim("  Validate your theme with: ") + pc.cyan(`npx create-bl-theme@latest validate ${dir}`)
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
    console.log("  1. Fork https://github.com/better-lyrics/themes");
    console.log(`  2. Add { "repo": "${repo}" } to index.json`);
    console.log("  3. Open a pull request");
    console.log();
    console.log("After your PR is merged, install the GitHub App for auto-updates:");
    console.log(pc.cyan("  https://github.com/marketplace/better-lyrics-themes"));
    process.exit(0);
  }

  // 7. Theme is registered
  console.log(pc.green("Theme is registered in the theme store."));
  console.log();
  console.log(pc.bold("Auto-publishing Setup:"));
  console.log();
  console.log("To enable automatic updates when you push:");
  console.log("  1. Install the GitHub App on your repo:");
  console.log(pc.cyan("     https://github.com/marketplace/better-lyrics-themes"));
  console.log();
  console.log("  2. Push changes to your repo:");
  console.log(pc.dim("     git add ."));
  console.log(pc.dim('     git commit -m "feat: update theme"'));
  console.log(pc.dim("     git push"));
  console.log();
  console.log("The registry will automatically:");
  console.log("  - Validate your theme");
  console.log("  - Update the lockfile");
  console.log("  - Vendor your theme files");
  console.log("  - Show a commit status on your push");
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

  console.log();
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
      "https://raw.githubusercontent.com/better-lyrics/themes/main/index.json"
    );
    const index = await response.json();
    return index.themes?.some((t) => t.repo === repo) ?? false;
  } catch {
    return false;
  }
}

async function checkLockStatus(repo) {
  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/better-lyrics/themes/main/index.lock.json"
    );
    const lock = await response.json();
    return lock.themes?.find((t) => t.repo === repo) ?? null;
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error(pc.red(err.message));
  process.exit(1);
});
