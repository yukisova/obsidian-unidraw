import { DrawingDocument, WIDE_CONT } from "./document";
import { extractFencedArt } from "./format";
import {
  allObjects,
  clampInt,
  cloneObject,
  cloneObjects,
  createDefaultData,
  createGlobalDoodle,
  createId,
  createLayer,
  createPadding,
  ensureGlobalDoodle,
  getActiveLayer,
  isElementVisible,
  normalizeLayerName,
  objectBounds,
  type CellsObject,
  type CircleObject,
  type DiamondObject,
  type DrawingObject,
  type GroupObject,
  type Layer,
  type LineObject,
  type Padding,
  type RectObject,
  type UnidrawData,
} from "./objects";
import type {
  ArrowStyle,
  LineRoute,
  StrokeStyle,
  TextAlignH,
  TextAlignV,
  TextDirection,
  TextTransform,
  TextWrapMode,
} from "./types";
import { firstGrapheme, graphemes, normalizeText } from "./unicode";
import { renderElement } from "../model/rasterize";

export const UNIDRAW_FORMAT = "unidraw";
export const UNIDRAW_FILE_VERSION = 1;
export const DEFAULT_MIN_COLS = 40;
export const DEFAULT_MIN_ROWS = 20;
export const MAX_CANVAS_COLS = 1200;
export const MAX_CANVAS_ROWS = 800;

const STROKES: StrokeStyle[] = ["light", "heavy", "double", "rounded", "dashed", "ascii"];
const ROUTES: LineRoute[] = ["straight", "diagonal", "elbow"];
const ARROWS: ArrowStyle[] = ["none", "line", "hollow", "solid"];
const FONTS: TextTransform[] = [
  "normal",
  "fullwidth",
  "bold",
  "italic",
  "boldItalic",
  "script",
  "boldScript",
  "fraktur",
  "doubleStruck",
  "sansSerif",
  "sansBold",
  "monospace",
  "circled",
  "squared",
  "smallCaps",
];
const HALIGNS: TextAlignH[] = ["left", "center", "right"];
const VALIGNS: TextAlignV[] = ["top", "middle", "bottom"];
const DIRECTIONS: TextDirection[] = ["horizontal", "vertical"];
const WRAPS: TextWrapMode[] = ["down", "up", "right", "left"];

function pick<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function asChar(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return firstGrapheme(normalizeText(value)) || fallback;
}

function normalizeFill(raw: unknown, filled: boolean, fallbackChar: string): string | null {
  if (raw === null) return null;
  if (typeof raw === "string") {
    return raw === "" ? "" : asChar(raw, fallbackChar);
  }
  return filled ? asChar(fallbackChar, "█") : null;
}

function normalizeObject(raw: unknown): DrawingObject | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const kind = data.kind;
  const id = typeof data.id === "string" && data.id ? data.id : createId();
  const hidden = data.hidden === true ? true : undefined;
  const visible = data.visible === false || hidden ? false : undefined;
  const locked = data.locked === true ? true : undefined;
  const global = data.global === true ? true : undefined;
  if (kind === "line") {
    const object: LineObject = {
      id,
      kind: "line",
      hidden,
      visible,
      locked,
      x1: asNumber(data.x1, 0, -10000, 10000),
      y1: asNumber(data.y1, 0, -10000, 10000),
      x2: asNumber(data.x2, 0, -10000, 10000),
      y2: asNumber(data.y2, 0, -10000, 10000),
      style: pick(STROKES, data.style, "light"),
      route: pick(ROUTES, data.route, "straight"),
      arrowStart: pick(ARROWS, data.arrowStart, "none"),
      arrowEnd: pick(ARROWS, data.arrowEnd, "none"),
    };
    return object;
  }
  if (kind === "rect" || kind === "text") {
    const legacyText = kind === "text";
    const paddingRaw = (data.padding && typeof data.padding === "object" ? data.padding : {}) as Partial<Padding>;
    const parsedFill = normalizeFill(data.fill, data.filled === true, asChar(data.fillChar, "█"));
    const fill = legacyText ? null : parsedFill;
    const rawText = typeof data.text === "string" ? data.text : null;
    const hasText = rawText !== null;
    const textEnabled = data.textEnabled === false ? false : data.textEnabled === true ? true : legacyText || hasText;
    let fillEnabled = data.fillEnabled === false ? false : data.fillEnabled === true ? true : fill !== null;
    const normalizedFill = fillEnabled && fill === null ? "" : fill;
    if (!fillEnabled) fillEnabled = false;
    const object: RectObject = {
      id,
      kind: "rect",
      hidden,
      visible,
      locked,
      x: asNumber(data.x, 0, -10000, 10000),
      y: asNumber(data.y, 0, -10000, 10000),
      w: asNumber(data.w, 1, 1, 10000),
      h: asNumber(data.h, 1, 1, 10000),
      filled: normalizedFill !== null,
      fillChar: normalizedFill && normalizedFill !== "" ? normalizedFill : asChar(data.fillChar, "█"),
      fill: normalizedFill,
      fillEnabled,
      style: pick(STROKES, data.style, "light"),
      borderless: legacyText ? true : data.borderless === true ? true : undefined,
      textEnabled,
    };
    if (legacyText || hasText || textEnabled) {
      object.text = rawText !== null ? rawText.replace(/\r\n?/g, "\n") : "";
      object.font = pick(FONTS, data.font, "normal");
      object.hAlign = pick(HALIGNS, data.hAlign, "left");
      object.vAlign = pick(VALIGNS, data.vAlign, "top");
      object.direction = pick(DIRECTIONS, data.direction, "horizontal");
      object.wrap = pick(WRAPS, data.wrap, "down");
      object.padding = createPadding(paddingRaw);
    }
    return object;
  }
  if (kind === "circle" || kind === "ellipse") {
    const fill = normalizeFill(data.fill, data.filled === true, asChar(data.fillChar, "█"));
    const object: CircleObject = {
      id,
      kind: "circle",
      hidden,
      visible,
      locked,
      x: asNumber(data.x, 0, -10000, 10000),
      y: asNumber(data.y, 0, -10000, 10000),
      w: asNumber(data.w, 1, 1, 10000),
      h: asNumber(data.h, 1, 1, 10000),
      style: pick(STROKES, data.style, "light"),
      fill,
    };
    return object;
  }
  if (kind === "diamond") {
    const fill = normalizeFill(data.fill, data.filled === true, asChar(data.fillChar, "█"));
    const object: DiamondObject = {
      id,
      kind: "diamond",
      hidden,
      visible,
      locked,
      x: asNumber(data.x, 0, -10000, 10000),
      y: asNumber(data.y, 0, -10000, 10000),
      w: asNumber(data.w, 1, 1, 10000),
      h: asNumber(data.h, 1, 1, 10000),
      style: pick(STROKES, data.style, "light"),
      fill,
    };
    return object;
  }
  if (kind === "doodle" || kind === "cells") {
    const rawCells = Array.isArray(data.cells) ? data.cells : [];
    const cells: [number, number, string][] = [];
    for (const entry of rawCells) {
      if (!Array.isArray(entry) || entry.length < 3) continue;
      const r = asNumber(entry[0], 0, -10000, 10000);
      const c = asNumber(entry[1], 0, -10000, 10000);
      const ch = asChar(entry[2], " ");
      cells.push([r, c, ch]);
    }
    const object: CellsObject = {
      id,
      kind: "cells",
      hidden,
      visible,
      locked,
      global,
      role: data.role === "erase" ? "erase" : "draw",
      cells,
    };
    return object;
  }
  if (kind === "group") {
    const children = Array.isArray(data.children)
      ? data.children.map(normalizeObject).filter((object): object is DrawingObject => !!object)
      : [];
    const object: GroupObject = { id, kind: "group", hidden, visible, locked, children };
    return object;
  }
  return null;
}

function normalizeLayer(raw: unknown, index: number): Layer {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const objects = Array.isArray(data.objects)
    ? data.objects.map(normalizeObject).filter((object): object is DrawingObject => !!object)
    : [];
  return {
    id: typeof data.id === "string" && data.id ? data.id : createId("layer"),
    name: normalizeLayerName(data.name, `Layer ${index + 1}`),
    visible: data.visible !== false,
    locked: data.locked === true,
    objects,
  };
}

function makeLegacyData(raw: string): UnidrawData {
  const text = normalizeText(extractFencedArt(raw));
  const doc = DrawingDocument.fromText(text);
  const cells: [number, number, string][] = [];
  for (let r = 0; r < doc.rows; r++) {
    for (let c = 0; c < doc.cols; c++) {
      const glyph = doc.glyphAt(r, c);
      if (!glyph || glyph.continuation || glyph.char === " " || glyph.char === "\u3000") continue;
      cells.push([r, glyph.headCol, glyph.char]);
    }
  }
  const layer = createLayer("Frame", [createGlobalDoodle()]);
  const global = ensureGlobalDoodle(layer);
  if (cells.length > 0) global.cells = cells;
  return {
    format: "unidraw",
    version: 1,
    minCols: Math.max(DEFAULT_MIN_COLS, Math.min(MAX_CANVAS_COLS, doc.cols)),
    minRows: Math.max(DEFAULT_MIN_ROWS, Math.min(MAX_CANVAS_ROWS, doc.rows)),
    activeLayerId: layer.id,
    layers: [layer],
  };
}

/** Parse a .unidraw file. JSON is native; legacy plain-text art is imported. */
export function parseUnidraw(raw: string): UnidrawData {
  let text = (raw ?? "").replace(/^\uFEFF/, "");
  text = extractFencedArt(text).trim();
  if (!text) return createDefaultData();
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as Partial<UnidrawData> & { layers?: unknown };
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.layers)) {
        return normalizeData(parsed as Partial<UnidrawData>);
      }
    } catch {
      // Fall through to legacy plain text.
    }
  }
  return makeLegacyData(text);
}

export function normalizeData(raw: Partial<UnidrawData>): UnidrawData {
  const rawLayers = Array.isArray(raw.layers) ? raw.layers : [];
  const layers = rawLayers.map((layer, index) => normalizeLayer(layer, index));
  // The element model uses a single frame. Flatten legacy layers bottom-to-top
  // while preserving their stacking order and visibility/lock state.
  const objects: DrawingObject[] = [];
  for (const layer of layers) {
    for (const object of layer.objects) {
      if (!layer.visible) object.visible = false;
      if (layer.locked) object.locked = true;
      objects.push(object);
    }
  }
  const frame = createLayer("Frame", objects);
  const global = ensureGlobalDoodle(frame);
  global.global = true;
  return {
    format: "unidraw",
    version: 1,
    minCols: asNumber(raw.minCols, DEFAULT_MIN_COLS, 4, MAX_CANVAS_COLS),
    minRows: asNumber(raw.minRows, DEFAULT_MIN_ROWS, 4, MAX_CANVAS_ROWS),
    activeLayerId: frame.id,
    layers: [frame],
  };
}

export function serializeUnidraw(data: UnidrawData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export interface ComposedDrawing {
  doc: DrawingDocument;
  cols: number;
  rows: number;
  contentBounds: { x: number; y: number; w: number; h: number } | null;
}

function isContentObject(object: DrawingObject): boolean {
  return !(object.kind === "cells" && object.role === "erase");
}

function provisionalExtent(data: UnidrawData): { cols: number; rows: number } {
  let cols = Math.max(1, data.minCols);
  let rows = Math.max(1, data.minRows);
  for (const layer of data.layers) {
    if (!layer.visible) continue;
    for (const object of layer.objects) {
      if (!isElementVisible(object) || !isContentObject(object)) continue;
      const bounds = objectBounds(object);
      if (!bounds) continue;
      cols = Math.max(cols, bounds.x + bounds.w);
      rows = Math.max(rows, bounds.y + bounds.h);
    }
  }
  return {
    cols: Math.min(MAX_CANVAS_COLS, Math.max(1, cols)),
    rows: Math.min(MAX_CANVAS_ROWS, Math.max(1, rows)),
  };
}

function renderComposite(data: UnidrawData, cols: number, rows: number, exclude?: Set<string>): DrawingDocument {
  const out = new DrawingDocument(cols, rows);
  for (const layer of data.layers) {
    if (!layer.visible) continue;
    const layerDoc = new DrawingDocument(cols, rows);
    for (const object of layer.objects) {
      if (!isElementVisible(object) || exclude?.has(object.id)) continue;
      renderElement(layerDoc, object);
    }
    for (let r = 0; r < rows; r++) {
      const row = layerDoc.rawRow(r);
      if (!row) continue;
      for (let c = 0; c < cols; c++) {
        const raw = row[c];
        if (!raw || raw === " " || raw === WIDE_CONT) continue;
        out.setGlyph(r, c, raw, true);
      }
    }
  }
  return out;
}

/** Composite all visible layers into a character grid for display/export. */
export function composeData(
  data: UnidrawData,
  exclude?: Set<string>,
  keepExtent = false,
): ComposedDrawing {
  const provisional = provisionalExtent(data);
  const first = renderComposite(data, provisional.cols, provisional.rows, exclude);
  const tight = first.tightContentBounds();
  const cols = keepExtent
    ? provisional.cols
    : Math.min(MAX_CANVAS_COLS, Math.max(1, data.minCols, tight ? tight.c1 + 1 : 1));
  const rows = keepExtent
    ? provisional.rows
    : Math.min(MAX_CANVAS_ROWS, Math.max(1, data.minRows, tight ? tight.r1 + 1 : 1));
  const doc =
    cols === provisional.cols && rows === provisional.rows
      ? first
      : renderComposite(data, cols, rows, exclude);
  return {
    doc,
    cols,
    rows,
    contentBounds: tight ? { x: tight.c0, y: tight.r0, w: tight.c1 - tight.c0 + 1, h: tight.r1 - tight.r0 + 1 } : null,
  };
}

export function composedText(data: UnidrawData): string {
  return composeData(data).doc.trimmedText();
}

export interface MergeResult {
  targetLayerId: string;
  targetLayerName: string;
  mergedCount: number;
}

export function canMergeLayers(data: UnidrawData, ids: string[]): { ok: boolean; reason?: "empty" | "locked" | "missing" } {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return { ok: false, reason: "empty" };
  const selected: Layer[] = [];
  for (const id of unique) {
    const layer = data.layers.find((item) => item.id === id);
    if (!layer) return { ok: false, reason: "missing" };
    if (layer.locked) return { ok: false, reason: "locked" };
    selected.push(layer);
  }
  return { ok: true };
}

function combinedObjects(data: UnidrawData, selected: Layer[], newIds = false): DrawingObject[] {
  const sorted = [...selected].sort((a, b) => data.layers.indexOf(a) - data.layers.indexOf(b));
  const result: DrawingObject[] = [];
  for (const layer of sorted) {
    for (const object of layer.objects) {
      const copy = cloneObject(object);
      if (newIds) copy.id = createId();
      if (!layer.visible) copy.hidden = true;
      result.push(copy);
    }
  }
  return result;
}

/**
 * Merge selected layers into the topmost selected layer, or into a new layer.
 * The originals remain untouched when `intoNew` is true.
 */
export function mergeLayers(data: UnidrawData, ids: string[], intoNew = false): MergeResult | null {
  const check = canMergeLayers(data, ids);
  if (!check.ok) return null;
  const unique = Array.from(new Set(ids));
  const selected = unique
    .map((id) => data.layers.find((layer) => layer.id === id))
    .filter((layer): layer is Layer => !!layer);
  const sorted = [...selected].sort((a, b) => data.layers.indexOf(a) - data.layers.indexOf(b));
  if (sorted.length === 0) return null;
  const target = sorted[sorted.length - 1];
  const objects = combinedObjects(data, sorted, intoNew);
  if (intoNew) {
    const index = data.layers.indexOf(target);
    const layer = createLayer(uniqueLayerName(data, "Merged"), objects);
    data.layers.splice(Math.max(0, index + 1), 0, layer);
    data.activeLayerId = layer.id;
    return { targetLayerId: layer.id, targetLayerName: layer.name, mergedCount: sorted.length };
  }
  target.objects = objects;
  for (const layer of sorted) {
    if (layer.id === target.id) continue;
    const index = data.layers.indexOf(layer);
    if (index >= 0) data.layers.splice(index, 1);
  }
  data.activeLayerId = target.id;
  return { targetLayerId: target.id, targetLayerName: target.name, mergedCount: sorted.length };
}

export function uniqueLayerName(data: UnidrawData, base: string): string {
  const names = new Set(data.layers.map((layer) => layer.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function nextLayerName(data: UnidrawData): string {
  let n = 1;
  const names = new Set(data.layers.map((layer) => layer.name));
  while (names.has(`Layer ${n}`)) n++;
  return `Layer ${n}`;
}

export function addLayer(data: UnidrawData, name?: string): Layer {
  const layer = createLayer(name || nextLayerName(data));
  const index = data.layers.findIndex((item) => item.id === data.activeLayerId);
  data.layers.splice(index >= 0 ? index + 1 : data.layers.length, 0, layer);
  data.activeLayerId = layer.id;
  return layer;
}

export function duplicateObjectsForPaste(objects: DrawingObject[], dx = 2, dy = 2): DrawingObject[] {
  return objects.map((object) => {
    const copy = cloneObject(object);
    copy.id = createId();
    shiftObject(copy, dx, dy);
    return copy;
  });
}

export function shiftObject(object: DrawingObject, dx: number, dy: number): void {
  switch (object.kind) {
    case "line":
      object.x1 += dx;
      object.x2 += dx;
      object.y1 += dy;
      object.y2 += dy;
      break;
    case "rect":
    case "circle":
      object.x += dx;
      object.y += dy;
      break;
    case "cells":
      object.cells = object.cells.map(([r, c, ch]) => [r + dy, c + dx, ch] as [number, number, string]);
      break;
  }
}

export function clampDataToNonNegative(data: UnidrawData): void {
  let minX = 0;
  let minY = 0;
  for (const object of allObjects(data, { includeHidden: true })) {
    const b = objectBounds(object);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
  }
  if (minX >= 0 && minY >= 0) return;
  for (const object of allObjects(data, { includeHidden: true })) shiftObject(object, -minX, -minY);
}

export function activeLayer(data: UnidrawData): Layer | null {
  return getActiveLayer(data);
}

export function dataAsText(data: UnidrawData): string {
  return composedText(data);
}

export function objectCount(data: UnidrawData): number {
  return data.layers.reduce((sum, layer) => sum + layer.objects.length, 0);
}

export function cloneData(data: UnidrawData): UnidrawData {
  return JSON.parse(JSON.stringify(data)) as UnidrawData;
}

export function cloneLayerObjects(objects: DrawingObject[]): DrawingObject[] {
  return cloneObjects(objects);
}

export function layerObjectMap(data: UnidrawData): Map<string, DrawingObject> {
  const result = new Map<string, DrawingObject>();
  for (const layer of data.layers) for (const object of layer.objects) result.set(object.id, object);
  return result;
}

export function ensureGraphemeChar(value: string, fallback = "█"): string {
  const parts = graphemes(value);
  return parts[0] || fallback;
}
