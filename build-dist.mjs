import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "./scripts/zip.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, "dist");
const artifacts = ["main.js", "manifest.json", "styles.css"];
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const missing = artifacts.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length > 0) {
  console.error(`Missing build artifact(s): ${missing.join(", ")}`);
  console.error("Run `npm run build` first.");
  process.exit(1);
}

// Keep dist/backup and the historical archives untouched. Each release gets
// its own folder containing the three plugin files plus an installable zip.
const releaseName = `${manifest.id}-${manifest.version}`;
const releaseDir = path.join(distDir, releaseName);
fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

for (const file of artifacts) {
  fs.copyFileSync(path.join(root, file), path.join(releaseDir, file));
}

const zipName = `${releaseName}.zip`;
const zip = createZip(
  artifacts.map((file) => ({
    name: file,
    data: fs.readFileSync(path.join(releaseDir, file)),
  })),
);
fs.writeFileSync(path.join(releaseDir, zipName), zip);
console.log(
  `Packaged ${manifest.name} ${manifest.version} into dist/${releaseName}/ (${artifacts.join(", ")}, ${zipName})`,
);
