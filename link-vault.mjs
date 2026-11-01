import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;
const vaultPath = process.env.VAULT_PATH ?? process.argv[2];

if (!vaultPath) {
  console.error("Usage: npm run link -- /path/to/vault");
  console.error("   or: VAULT_PATH=/path/to/vault npm run link");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
const pluginId = manifest.id;
if (!pluginId) {
  console.error("manifest.json is missing an id.");
  process.exit(1);
}

const configDir = path.join(vaultPath, ".obsidian");
if (!fs.existsSync(configDir)) {
  console.error("Not an Obsidian vault (no .obsidian folder):", vaultPath);
  process.exit(1);
}

if (!fs.existsSync(path.join(projectRoot, "main.js"))) {
  console.error("main.js is missing. Run `npm run build` first.");
  process.exit(1);
}

const pluginsDir = path.join(configDir, "plugins");
// Obsidian loads a plugin by manifest.id; keep the folder name in sync with it.
const linkPath = path.join(pluginsDir, pluginId);

fs.mkdirSync(pluginsDir, { recursive: true });
try {
  fs.unlinkSync(linkPath);
} catch (err) {
  if (err.code !== "ENOENT") {
    console.error("Could not replace", linkPath);
    console.error("Remove it manually, then run this script again.");
    process.exit(1);
  }
}
fs.symlinkSync(projectRoot, linkPath, "dir");
console.log("Symlink created:", linkPath, "->", projectRoot);
console.log(`Restart Obsidian, then enable "${manifest.name}" in Settings > Community plugins.`);
