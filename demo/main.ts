import "./dom-polyfills";
import { UnidrawEditorUI, type UnidrawUIHost, type UnidrawUISettings } from "../src/ui/editor-ui";
import { createLayer, createPadding, type RectObject } from "../src/core/objects";
import { parseUnidraw, serializeUnidraw } from "../src/core/file-format";
import { SAMPLE_ART } from "./sample";

import mousePointer2 from "lucide-static/icons/mouse-pointer-2.svg";
import hand from "lucide-static/icons/hand.svg";
import pencil from "lucide-static/icons/pencil.svg";
import eraser from "lucide-static/icons/eraser.svg";
import paintBucket from "lucide-static/icons/paint-bucket.svg";
import pipette from "lucide-static/icons/pipette.svg";
import minus from "lucide-static/icons/minus.svg";
import moveUpRight from "lucide-static/icons/move-up-right.svg";
import square from "lucide-static/icons/square.svg";
import circle from "lucide-static/icons/circle.svg";
import diamond from "lucide-static/icons/diamond.svg";
import triangle from "lucide-static/icons/triangle.svg";
import typeIcon from "lucide-static/icons/type.svg";
import undo2 from "lucide-static/icons/undo-2.svg";
import redo2 from "lucide-static/icons/redo-2.svg";
import gridIcon from "lucide-static/icons/grid.svg";
import grid3x3 from "lucide-static/icons/grid-3x3.svg";
import grid2x2 from "lucide-static/icons/grid-2x2.svg";
import zoomIn from "lucide-static/icons/zoom-in.svg";
import zoomOut from "lucide-static/icons/zoom-out.svg";
import maximize from "lucide-static/icons/maximize.svg";
import layoutTemplate from "lucide-static/icons/layout-template.svg";
import copyIcon from "lucide-static/icons/copy.svg";
import helpCircle from "lucide-static/icons/help-circle.svg";
import downloadIcon from "lucide-static/icons/download.svg";
import codeIcon from "lucide-static/icons/code.svg";
import imageIcon from "lucide-static/icons/image.svg";
import fileText from "lucide-static/icons/file-text.svg";
import plusIcon from "lucide-static/icons/plus.svg";
import xIcon from "lucide-static/icons/x.svg";
import sparkles from "lucide-static/icons/sparkles.svg";
import smile from "lucide-static/icons/smile.svg";
import shapes from "lucide-static/icons/shapes.svg";
import layersIcon from "lucide-static/icons/layers.svg";
import eye from "lucide-static/icons/eye.svg";
import eyeOff from "lucide-static/icons/eye-off.svg";
import lock from "lucide-static/icons/lock.svg";
import unlock from "lucide-static/icons/unlock.svg";
import chevronUp from "lucide-static/icons/chevron-up.svg";
import chevronDown from "lucide-static/icons/chevron-down.svg";
import chevronsUp from "lucide-static/icons/chevrons-up.svg";
import chevronsDown from "lucide-static/icons/chevrons-down.svg";
import globe from "lucide-static/icons/globe.svg";
import bold from "lucide-static/icons/bold.svg";
import equal from "lucide-static/icons/equal.svg";
import terminal from "lucide-static/icons/terminal.svg";
import moreHorizontal from "lucide-static/icons/more-horizontal.svg";
import ellipsisVertical from "lucide-static/icons/ellipsis-vertical.svg";
import trash from "lucide-static/icons/trash.svg";
import alignLeft from "lucide-static/icons/align-left.svg";
import alignCenter from "lucide-static/icons/align-center.svg";
import alignRight from "lucide-static/icons/align-right.svg";
import alignStartVertical from "lucide-static/icons/align-start-vertical.svg";
import alignCenterVertical from "lucide-static/icons/align-center-vertical.svg";
import alignEndVertical from "lucide-static/icons/align-end-vertical.svg";
import mergeIcon from "lucide-static/icons/merge.svg";

const ICONS: Record<string, string> = {
  "mouse-pointer-2": mousePointer2,
  hand,
  pencil,
  eraser,
  "paint-bucket": paintBucket,
  pipette,
  minus,
  "move-up-right": moveUpRight,
  square,
  circle,
  diamond,
  triangle,
  type: typeIcon,
  "undo-2": undo2,
  "redo-2": redo2,
  grid: gridIcon,
  "grid-3x3": grid3x3,
  "grid-2x2": grid2x2,
  "zoom-in": zoomIn,
  "zoom-out": zoomOut,
  maximize,
  "layout-template": layoutTemplate,
  copy: copyIcon,
  "help-circle": helpCircle,
  download: downloadIcon,
  code: codeIcon,
  image: imageIcon,
  "file-text": fileText,
  plus: plusIcon,
  x: xIcon,
  sparkles,
  smile,
  shapes,
  layers: layersIcon,
  eye,
  "eye-off": eyeOff,
  lock,
  unlock,
  "chevron-up": chevronUp,
  "chevron-down": chevronDown,
  "chevrons-up": chevronsUp,
  "chevrons-down": chevronsDown,
  globe,
  bold,
  equal,
  terminal,
  "more-horizontal": moreHorizontal,
  "ellipsis-vertical": ellipsisVertical,
  trash,
  "align-left": alignLeft,
  "align-center": alignCenter,
  "align-right": alignRight,
  "align-start-vertical": alignStartVertical,
  "align-center-vertical": alignCenterVertical,
  "align-end-vertical": alignEndVertical,
  merge: mergeIcon,
};

const params = new URLSearchParams(window.location.search);
const scene = params.get("scene") ?? "overview";
const theme = params.get("theme") === "light" ? "light" : "dark";
const language = params.get("lang") === "zh" ? "zh" : "en";

document.body.classList.toggle("theme-light", theme === "light");
document.body.classList.toggle("theme-dark", theme === "dark");
document.documentElement.style.colorScheme = theme;
document.body.dataset.scene = scene;
if (params.get("still") === "1") document.body.classList.add("demo-still");

const settings: UnidrawUISettings = {
  language,
  fontFamily: "menlo",
  fontSize: 16,
  lineHeight: 1.18,
  grid: "lines",
  defaultStroke: "light",
  showStatusBar: true,
  textTransform: "normal",
  drawChar: "█",
  fillChar: "█",
  shapeFill: "none",
  brushSize: 1,
};

const DEMO_NOTE_ID = "demo-note";
const DEMO_BOX_ID = "demo-note-box";

function buildDemoFile(): string {
  const data = parseUnidraw(SAMPLE_ART);
  data.layers[0].name = "Artwork";
  const notes = createLayer("Notes");
  const box: RectObject = {
    id: DEMO_BOX_ID,
    kind: "rect",
    x: 3,
    y: 31,
    w: 49,
    h: 8,
    filled: false,
    fillChar: "█",
    style: "rounded",
  };
  const text: RectObject = {
    id: DEMO_NOTE_ID,
    kind: "rect",
    x: 6,
    y: 33,
    w: 43,
    h: 4,
    filled: false,
    fillChar: " ",
    fill: null,
    fillEnabled: false,
    style: "light",
    borderless: true,
    textEnabled: true,
    text: "Elements have their own z-order.\nSelect one, then drag or edit.",
    font: "bold",
    hAlign: "left",
    vAlign: "middle",
    direction: "horizontal",
    wrap: "down",
    padding: createPadding({ top: 0, right: 1, bottom: 0, left: 1 }),
  };
  notes.objects.push(box, text);
  data.layers.push(notes);
  data.activeLayerId = notes.id;
  data.minCols = Math.max(data.minCols, 54);
  data.minRows = Math.max(data.minRows, 42);
  return serializeUnidraw(data);
}

const DEMO_FILE = buildDemoFile();

let saveTimer = 0;
let ui: UnidrawEditorUI | null = null;

const host: UnidrawUIHost = {
  icon: (el, name) => {
    const svg = ICONS[name];
    if (svg) {
      el.innerHTML = svg;
    }
  },
  tooltip: (el, text) => {
    el.setAttribute("title", text);
  },
  isActive: () => true,
  getSettings: () => settings,
  getVersion: () => "0.2.19",
  requestSave: () => {
    if (!ui) return;
    ui.setSaveState("unsaved");
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => ui?.setSaveState("saved"), 500);
  },
  saveNow: () => {
    ui?.setSaveState("saving");
    window.setTimeout(() => ui?.setSaveState("saved"), 320);
  },
  getFileName: () => "unidraw-demo",
  insertIntoNote: () => true,
};

const app = document.getElementById("app");
if (!app) throw new Error("Missing #app");
ui = new UnidrawEditorUI(app, host);
ui.loadText(scene === "blank" ? "" : DEMO_FILE);
ui.setSaveState("saved");

const editor = ui.getEditor();
const tabLabel = document.querySelector<HTMLElement>(".demo-tab-label");
if (tabLabel) tabLabel.textContent = "unidraw-demo.unidraw";

function clickAction(action: string): void {
  const button = document.querySelector<HTMLElement>(`[data-action="${action}"]`);
  button?.click();
}

function openPaletteScene(): void {
  const toolButton = document.querySelector<HTMLButtonElement>('[data-tool="pencil"]');
  toolButton?.click();
  requestAnimationFrame(() => {
    const charButton = document.querySelector<HTMLElement>(".unidraw-char-swatch");
    charButton?.click();
  });
}

function setupScene(): void {
  if (!ui) return;
  switch (scene) {
    case "selection":
      editor.setTool("select");
      editor.selectObjects([DEMO_NOTE_ID]);
      break;
    case "palette":
      openPaletteScene();
      break;
    case "templates":
      clickAction("templates");
      break;
    case "fill":
      editor.setTool("fill");
      break;
    case "export":
      clickAction("export");
      break;
    case "help":
      clickAction("help");
      break;
    default:
      break;
  }
}

function simulateHover(): void {
  const canvas = document.querySelector<HTMLCanvasElement>(".unidraw-canvas");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + rect.width * 0.42,
      clientY: rect.top + rect.height * 0.32,
      pointerId: 1,
      pointerType: "mouse",
    }),
  );
}

async function ready(): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    /* Font loading is best effort. */
  }
  setupScene();
  document.body.classList.add("demo-ready");
  (window as Window & { __demoReady?: boolean }).__demoReady = true;
}

(window as Window & { __unidrawDemo?: unknown }).__unidrawDemo = {
  ui,
  editor,
  scene,
  theme,
};

void ready();
