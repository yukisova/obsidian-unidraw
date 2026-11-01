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
import { normalizeText } from "./unicode";

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ObjectBase {
  id: string;
  /** Legacy hidden flag; kept for backward compatibility. */
  hidden?: boolean;
  /** Element visibility (false hides the element). */
  visible?: boolean;
  /** Locked elements cannot be selected, moved or edited. */
  locked?: boolean;
  /** Global doodle elements cannot be deleted. */
  global?: boolean;
}

export interface LineObject extends ObjectBase {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  style: StrokeStyle;
  route: LineRoute;
  arrowStart: ArrowStyle;
  arrowEnd: ArrowStyle;
}

export interface RectObject extends ObjectBase {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  filled: boolean;
  fillChar: string;
  /** null/undefined = transparent, "" = empty fill, otherwise a fill glyph. */
  fill?: string | null;
  /** Master switch for the optional fill feature. */
  fillEnabled?: boolean;
  /** Master switch for the optional text feature. */
  textEnabled?: boolean;
  style: StrokeStyle;
  /** Optional text label content. */
  text?: string;
  font?: TextTransform;
  hAlign?: TextAlignH;
  vAlign?: TextAlignV;
  direction?: TextDirection;
  wrap?: TextWrapMode;
  padding?: Padding;
  /** The border feature is disabled when true. */
  borderless?: boolean;
}

export interface CircleObject extends ObjectBase {
  kind: "circle";
  x: number;
  y: number;
  w: number;
  h: number;
  style: StrokeStyle;
  fill?: string | null;
}

export interface DiamondObject extends ObjectBase {
  kind: "diamond";
  x: number;
  y: number;
  w: number;
  h: number;
  style: StrokeStyle;
  fill?: string | null;
}

/** A compact array of [row, col, glyph] cells, used for freehand and erasers. */
export type CellTuple = [number, number, string];

export interface CellsObject extends ObjectBase {
  kind: "cells";
  role: "draw" | "erase";
  cells: CellTuple[];
  /** The default global doodle supplied with every frame. */
  global?: boolean;
}

export interface GroupObject extends ObjectBase {
  kind: "group";
  children: DrawingObject[];
}

export type DrawingObject =
  | LineObject
  | RectObject
  | CircleObject
  | DiamondObject
  | CellsObject
  | GroupObject;

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  objects: DrawingObject[];
}

export interface UnidrawData {
  format: "unidraw";
  version: 1;
  minCols: number;
  minRows: number;
  activeLayerId: string;
  layers: Layer[];
}

export interface ObjectBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

let idCounter = 0;

export function createId(prefix = "o"): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createPadding(value: Partial<Padding> = {}): Padding {
  return {
    top: clampInt(value.top, 0, 20, 0),
    right: clampInt(value.right, 0, 20, 1),
    bottom: clampInt(value.bottom, 0, 20, 0),
    left: clampInt(value.left, 0, 20, 1),
  };
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

export function createLayer(name: string, objects: DrawingObject[] = []): Layer {
  return {
    id: createId("layer"),
    name: name.trim() || "Layer",
    visible: true,
    locked: false,
    objects,
  };
}

export function createGlobalDoodle(): CellsObject {
  return { id: createId("doodle"), kind: "cells", role: "draw", global: true, cells: [] };
}

export function createDefaultData(minCols = 40, minRows = 20): UnidrawData {
  const layer = createLayer("Frame", [createGlobalDoodle()]);
  return {
    format: "unidraw",
    version: 1,
    minCols,
    minRows,
    activeLayerId: layer.id,
    layers: [layer],
  };
}

export function cloneObject<T extends DrawingObject>(object: T): T {
  return JSON.parse(JSON.stringify(object)) as T;
}

export function cloneObjects(objects: DrawingObject[]): DrawingObject[] {
  return objects.map((object) => cloneObject(object));
}

export function cloneWithNewIds(objects: DrawingObject[]): DrawingObject[] {
  return objects.map((object) => {
    const clone = cloneObject(object);
    clone.id = createId();
    return clone;
  });
}

export function isElementVisible(object: DrawingObject): boolean {
  return object.hidden !== true && object.visible !== false;
}

export function isElementLocked(object: DrawingObject): boolean {
  return object.locked === true;
}

export function getShapeFill(object: RectObject | CircleObject | DiamondObject): string | null {
  if (object.kind === "rect" && object.fillEnabled === false) return null;
  if (object.kind === "rect" && object.fill === undefined) {
    return object.filled ? object.fillChar || "█" : null;
  }
  return object.fill ?? null;
}

export function isDoodle(object: DrawingObject): object is CellsObject {
  return object.kind === "cells" && object.role === "draw";
}

export function isInternalObject(object: DrawingObject): boolean {
  return object.kind === "cells" && object.role === "erase";
}

export function objectBounds(object: DrawingObject): ObjectBounds | null {
  switch (object.kind) {
    case "line": {
      const x = Math.min(object.x1, object.x2);
      const y = Math.min(object.y1, object.y2);
      return {
        x,
        y,
        w: Math.max(1, Math.abs(object.x2 - object.x1) + 1),
        h: Math.max(1, Math.abs(object.y2 - object.y1) + 1),
      };
    }
    case "rect":
    case "circle":
    case "diamond":
      return { x: object.x, y: object.y, w: Math.max(1, object.w), h: Math.max(1, object.h) };
    case "cells": {
      if (object.cells.length === 0) return null;
      let minR = Infinity;
      let maxR = -Infinity;
      let minC = Infinity;
      let maxC = -Infinity;
      for (const [r, c] of object.cells) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
      return { x: minC, y: minR, w: Math.max(1, maxC - minC + 1), h: Math.max(1, maxR - minR + 1) };
    }
    case "group":
      return boundsOfObjects(object.children);
  }
}

export function boundsOfObjects(objects: DrawingObject[]): ObjectBounds | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let found = false;
  for (const object of objects) {
    if (object.hidden) continue;
    const bounds = objectBounds(object);
    if (!bounds) continue;
    found = true;
    x0 = Math.min(x0, bounds.x);
    y0 = Math.min(y0, bounds.y);
    x1 = Math.max(x1, bounds.x + bounds.w - 1);
    y1 = Math.max(y1, bounds.y + bounds.h - 1);
  }
  if (!found) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function allObjects(data: UnidrawData, options: { includeHidden?: boolean } = {}): DrawingObject[] {
  const result: DrawingObject[] = [];
  for (const layer of data.layers) {
    for (const object of layer.objects) {
      if (!options.includeHidden && object.hidden) continue;
      result.push(object);
    }
  }
  return result;
}

export function getActiveLayer(data: UnidrawData): Layer | null {
  return data.layers.find((layer) => layer.id === data.activeLayerId) ?? data.layers[0] ?? null;
}

export function getLayer(data: UnidrawData, id: string): Layer | null {
  return data.layers.find((layer) => layer.id === id) ?? null;
}

export function findObject(
  data: UnidrawData,
  id: string,
): { layer: Layer; object: DrawingObject; index: number } | null {
  for (const layer of data.layers) {
    const index = layer.objects.findIndex((object) => object.id === id);
    if (index >= 0) return { layer, object: layer.objects[index], index };
  }
  return null;
}

export function removeObjectById(data: UnidrawData, id: string): DrawingObject | null {
  for (const layer of data.layers) {
    const index = layer.objects.findIndex((object) => object.id === id);
    if (index >= 0) return layer.objects.splice(index, 1)[0];
  }
  return null;
}

export function translateObject(object: DrawingObject, dr: number, dc: number): void {
  switch (object.kind) {
    case "line":
      object.x1 += dc;
      object.x2 += dc;
      object.y1 += dr;
      object.y2 += dr;
      break;
    case "rect":
    case "circle":
    case "diamond":
      object.x += dc;
      object.y += dr;
      break;
    case "cells":
      object.cells = object.cells.map(([r, c, ch]) => [r + dr, c + dc, ch] as CellTuple);
      break;
    case "group":
      for (const child of object.children) translateObject(child, dr, dc);
      break;
  }
}

export function setObjectBounds(object: DrawingObject, bounds: ObjectBounds): void {
  const w = Math.max(1, Math.round(bounds.w));
  const h = Math.max(1, Math.round(bounds.h));
  const old = objectBounds(object);
  if (!old) return;
  switch (object.kind) {
    case "line": {
      const mapX = (x: number) => bounds.x + (old.w <= 1 ? 0 : ((x - old.x) / (old.w - 1)) * (w - 1));
      const mapY = (y: number) => bounds.y + (old.h <= 1 ? 0 : ((y - old.y) / (old.h - 1)) * (h - 1));
      object.x1 = Math.round(mapX(object.x1));
      object.x2 = Math.round(mapX(object.x2));
      object.y1 = Math.round(mapY(object.y1));
      object.y2 = Math.round(mapY(object.y2));
      break;
    }
    case "rect":
    case "circle":
    case "diamond":
      object.x = Math.round(bounds.x);
      object.y = Math.round(bounds.y);
      object.w = w;
      object.h = h;
      break;
    case "cells": {
      const sx = old.w <= 1 ? 1 : w / old.w;
      const sy = old.h <= 1 ? 1 : h / old.h;
      const next = new Map<string, string>();
      for (const [r, c, ch] of object.cells) {
        const nr = Math.round(bounds.y + (r - old.y) * sy);
        const nc = Math.round(bounds.x + (c - old.x) * sx);
        next.set(`${nr},${nc}`, ch);
      }
      object.cells = Array.from(next.entries()).map(([key, ch]) => {
        const [r, c] = key.split(",").map(Number);
        return [r, c, ch] as CellTuple;
      });
      break;
    }
    case "group": {
      const sx = old.w <= 1 ? 1 : w / old.w;
      const sy = old.h <= 1 ? 1 : h / old.h;
      for (const child of object.children) {
        const b = objectBounds(child);
        if (!b) continue;
        setObjectBounds(child, {
          x: Math.round(bounds.x + (b.x - old.x) * sx),
          y: Math.round(bounds.y + (b.y - old.y) * sy),
          w: Math.max(1, Math.round(b.w * sx)),
          h: Math.max(1, Math.round(b.h * sy)),
        });
      }
      break;
    }
  }
}

export function moveObjectTo(object: DrawingObject, x: number, y: number): void {
  const bounds = objectBounds(object);
  if (!bounds) return;
  translateObject(object, Math.round(y) - bounds.y, Math.round(x) - bounds.x);
}

export function normalizeLayerName(name: unknown, fallback: string): string {
  const text = normalizeText(typeof name === "string" ? name : "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, 60);
}

export function objectsInLayer(layer: Layer, includeHidden = false): DrawingObject[] {
  return includeHidden
    ? layer.objects
    : layer.objects.filter((object) => !isInternalObject(object) && isElementVisible(object));
}

export function ensureGlobalDoodle(layer: Layer): CellsObject {
  let global = layer.objects.find(
    (object): object is CellsObject => object.kind === "cells" && object.global === true,
  );
  if (!global) {
    global = createGlobalDoodle();
    layer.objects.unshift(global);
  } else if (layer.objects[0] !== global) {
    layer.objects = [global, ...layer.objects.filter((object) => object !== global)];
  }
  return global;
}

export function groupBounds(children: DrawingObject[]): ObjectBounds | null {
  return boundsOfObjects(children);
}
