import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, ".tmp");
const outFile = path.join(outDir, "tests.cjs");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "tests/all.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: "inline",
  logLevel: "warning",
});

const result = spawnSync(process.execPath, [outFile], { stdio: "inherit" });
process.exit(result.status ?? 1);
