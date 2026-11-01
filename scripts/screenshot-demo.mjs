import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs", "screenshots");
const chrome =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9300 + (process.pid % 400);
const profile = path.join("/tmp", `unidraw-chrome-${process.pid}`);

if (!fs.existsSync(chrome)) {
  console.error(`Chrome not found at ${chrome}. Set CHROME_PATH to override.`);
  process.exit(1);
}
if (!fs.existsSync(path.join(root, "demo", "dist", "demo.js"))) {
  console.error("Demo bundle is missing. Run `npm run demo` first.");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(profile, { recursive: true, force: true });

const child = spawn(
  chrome,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    "--disable-breakpad",
    "--crash-dumps-dir=/tmp",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--mute-audio",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPageTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const page = targets.find((target) => target.type === "page");
      if (page) return page;
    } catch {
      /* Chrome is still starting. */
    }
    await sleep(120);
  }
  throw new Error("Chrome DevTools endpoint did not become ready");
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
        return;
      }
      if (data.method) {
        for (const fn of this.listeners.get(data.method) ?? []) fn(data.params);
      }
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
}

async function evalValue(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Evaluation failed");
  }
  return result.result?.value;
}

const scenes = [
  { name: "unidraw-overview-dark", query: "scene=overview&theme=dark" },
  { name: "unidraw-overview-light", query: "scene=overview&theme=light" },
  { name: "unidraw-selection", query: "scene=selection&theme=dark" },
  { name: "unidraw-characters", query: "scene=palette&theme=dark" },
  { name: "unidraw-templates", query: "scene=templates&theme=light" },
  { name: "unidraw-help", query: "scene=help&theme=dark" },
];

let client;
try {
  const page = await getPageTarget();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  client = new CdpClient(ws);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1560,
    height: 1000,
    deviceScaleFactor: 2,
    mobile: false,
  });

  for (const scene of scenes) {
    const url = `file://${path.join(root, "demo", "index.html")}?${scene.query}&still=1`;
    await client.send("Page.navigate", { url });
    for (let i = 0; i < 100; i++) {
      const ready = await evalValue(client, "Boolean(window.__demoReady)").catch(() => false);
      if (ready) break;
      await sleep(80);
    }
    await sleep(450);
    const shot = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });
    const output = path.join(outDir, `${scene.name}.png`);
    fs.writeFileSync(output, Buffer.from(shot.data, "base64"));
    console.log(`Captured docs/screenshots/${scene.name}.png`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  client?.ws.close();
  child.kill("SIGKILL");
  await sleep(300);
  fs.rmSync(profile, { recursive: true, force: true });
}
