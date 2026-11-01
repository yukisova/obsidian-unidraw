import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "demo", "dist");
fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "demo/main.ts")],
  outfile: path.join(outDir, "demo.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  loader: { ".svg": "text" },
  sourcemap: "inline",
  logLevel: "info",
});

console.log("Demo built: demo/dist/demo.js");
