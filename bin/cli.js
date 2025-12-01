#!/usr/bin/env node

import prompts from "prompts";
import pc from "picocolors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

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
  ${pc.cyan("create-bl-theme")} [name]        Create a new theme
  ${pc.cyan("create-bl-theme")} validate [dir] Validate a theme directory

${pc.bold("Examples:")}
  ${pc.dim("$")} create-bl-theme my-awesome-theme
  ${pc.dim("$")} create-bl-theme validate ./my-theme
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
    description: response.description,
    creators: [response.creator],
    minVersion: "2.0.5.6",
    hasShaders: response.hasShaders,
    version: "1.0.0",
    tags: response.tags,
    images: ["preview.png"],
  };

  fs.writeFileSync(
    path.join(fullPath, "metadata.json"),
    JSON.stringify(metadata, null, 2)
  );

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
  if (response.hasShaders) {
    console.log(`  ${pc.dim("4.")} Configure ${pc.cyan("shader.json")} for shader effects`);
  }
  const submitStep = response.hasShaders ? "5." : "4.";
  console.log(
    `  ${pc.dim(submitStep)} Push to GitHub and submit to the theme store`
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
  const fullPath = path.resolve(process.cwd(), dir);
  let errors = [];
  let warnings = [];

  console.log(pc.dim(`Validating theme at ${fullPath}...\n`));

  // Check directory exists
  if (!fs.existsSync(fullPath)) {
    console.log(pc.red(`Error: Directory "${dir}" does not exist.`));
    process.exit(1);
  }

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
        "description",
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
      warnings.forEach((w) => console.log(pc.yellow(`    - ${w}`)));
    }
  }

  console.log();

  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(pc.red(err.message));
  process.exit(1);
});
