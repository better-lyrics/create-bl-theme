#!/usr/bin/env node

import prompts from "prompts";
import pc from "picocolors";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { imageSize } from "image-size";
import { execSync } from "child_process";

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

${pc.bold("Examples:")}
  ${pc.dim("$")} create-bl-theme my-awesome-theme
  ${pc.dim("$")} create-bl-theme validate ./my-theme
  ${pc.dim("$")} create-bl-theme validate https://github.com/user/theme-repo
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

  // Create style.css from template
  const cssTemplate = fs.readFileSync(
    path.join(TEMPLATES_DIR, "style.css"),
    "utf-8"
  );
  fs.writeFileSync(path.join(fullPath, "style.css"), cssTemplate);

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
  console.log(`  ${pc.dim("2.")} Edit ${pc.cyan("style.css")} with your theme styles`);
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
  console.log(
    `      ${pc.dim("https://github.com/boidushya/better-lyrics-themes")}`
  );
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

  // Check style.css
  const stylePath = path.join(fullPath, "style.css");
  if (!fs.existsSync(stylePath)) {
    errors.push("style.css is missing");
  } else {
    const css = fs.readFileSync(stylePath, "utf-8");
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

main().catch((err) => {
  console.error(pc.red(err.message));
  process.exit(1);
});
