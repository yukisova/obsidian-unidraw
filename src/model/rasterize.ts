import { DrawingDocument, WIDE_CONT } from "../core/document";
import type { CellPos, StrokeStyle, TextAlignH, TextAlignV, TextDirection, TextTransform, TextWrapMode } from "../core/types";
import { graphemeWidth, graphemes } from "../core/unicode";
import type { CircleObject, DiamondObject, LineObject, Padding, RectObject, CellsObject } from "../core/objects";
import { getShapeFill, isElementVisible } from "../core/objects";
import { diagonalGlyph, paintMask } from "../glyphs/box";
import { drawDiamond, drawEllipse, drawRectangle } from "../glyphs/shapes";
import { computeLinePath, type LineObstacle } from "./line-path";
import { transformText } from "../glyphs/text-styles";

export const FILL_CLEAR = "\uE000";

function sign(n: number): number {
  return n === 0 ? 0 : n > 0 ? 1 : -1;
}

function put(doc: DrawingDocument, r: number, c: number, ch: string): void {
  if (r < 0 || c < 0) return;
  doc.setGlyph(r, c, ch, true);
}

const CARDINAL_ARROWS: Record<"N" | "E" | "S" | "W", string> = {
  N: "↑",
  E: "→",
  S: "↓",
  W: "←",
};

function adaptiveLineArrow(dr: number, dc: number, fallback: "←" | "→"): string {
  if (dr === 0 && dc === 0) return fallback;
  if (Math.abs(dr) >= Math.abs(dc)) return dr < 0 ? CARDINAL_ARROWS.N : CARDINAL_ARROWS.S;
  return dc < 0 ? CARDINAL_ARROWS.W : CARDINAL_ARROWS.E;
}

function applyLineArrow(
  doc: DrawingDocument,
  cell: CellPos,
  obj: LineObject,
  which: "start" | "end",
  dr: number,
  dc: number,
): void {
  const enabled = which === "start" ? obj.arrowStart !== "none" : obj.arrowEnd !== "none";
  if (!enabled) return;
  const mode = which === "start" ? obj.arrowStartMode ?? "adaptive" : obj.arrowEndMode ?? "adaptive";
  if (mode === "custom") {
    const ch = which === "start" ? obj.arrowStartChar || "←" : obj.arrowEndChar || "→";
    put(doc, cell.row, cell.col, ch);
    return;
  }
  put(doc, cell.row, cell.col, adaptiveLineArrow(dr, dc, which === "start" ? "←" : "→"));
}

/** Render a line object, including all three routing modes and arrow styles. */
export function renderLine(doc: DrawingDocument, obj: LineObject, options?: RenderElementOptions): void {
  const path = computeLinePath(obj, options?.obstacles ?? []);
  if (path.length === 0) return;
  const mode = obj.lineStyle ?? (obj.style === "heavy" ? "bold" : obj.style === "double" ? "double" : obj.style === "ascii" ? "ascii" : "thin");
  const pattern = obj.linePattern ?? "solid";
  const thinPattern: StrokeStyle = pattern === "dash2" ? "dash2" : pattern === "dash3" ? "dashed" : pattern === "dash4" ? "dash4" : "light";
  const boldPattern: StrokeStyle = pattern === "dash2" ? "heavyDash2" : pattern === "dash3" ? "heavyDash3" : pattern === "dash4" ? "heavyDash4" : "heavy";
  const stroke: StrokeStyle = mode === "bold" ? boldPattern : mode === "double" ? "double" : mode === "ascii" ? "ascii" : thinPattern;
  const config = obj.interruptEnabled === true ? obj.interrupt : undefined;
  const segment = config ? Math.max(1, Math.round(config.segment)) : 0;
  const gap = config ? Math.max(1, Math.round(config.gap)) : 0;
  const offset = config ? Math.max(0, Math.round(config.offset)) : 0;
  const period = segment + gap;
  const keep = (index: number): boolean => {
    if (!config) return true;
    const phase = ((index - offset) % period + period) % period;
    return phase < segment;
  };
  if (path.length === 1) {
    const only = path[0];
    if (obj.arrowStart !== "none") applyLineArrow(doc, only, obj, "start", 0, 0);
    else if (obj.arrowEnd !== "none") applyLineArrow(doc, only, obj, "end", 0, 0);
    else put(doc, only.row, only.col, mode === "filled" ? obj.lineFillChar || "█" : "•");
    return;
  }
  for (let i = 0; i < path.length; i++) {
    if (!keep(i)) continue;
    const cell = path[i];
    if (mode === "filled") {
      put(doc, cell.row, cell.col, obj.lineFillChar || "█");
      continue;
    }
    const prev = path[i - 1];
    const next = path[i + 1];
    const diagonalNeighbor = prev && (prev.row !== cell.row && prev.col !== cell.col)
      ? prev
      : next && (next.row !== cell.row && next.col !== cell.col)
        ? next
        : null;
    if (diagonalNeighbor) {
      const dr = sign(diagonalNeighbor.row - cell.row);
      const dc = sign(diagonalNeighbor.col - cell.col);
      put(doc, cell.row, cell.col, diagonalGlyph(dr, dc, stroke));
      continue;
    }
    let mask = 0;
    for (const neighbor of [prev, next]) {
      if (!neighbor) continue;
      const dr = sign(neighbor.row - cell.row);
      const dc = sign(neighbor.col - cell.col);
      if (dr < 0) mask |= 1;
      if (dc > 0) mask |= 2;
      if (dr > 0) mask |= 4;
      if (dc < 0) mask |= 8;
    }
    if (mask) paintMask(doc, cell.row, cell.col, mask, stroke);
  }
  const first = path[0];
  const second = path[1];
  const beforeLast = path[path.length - 2];
  const last = path[path.length - 1];
  applyLineArrow(doc, first, obj, "start", sign(first.row - second.row), sign(first.col - second.col));
  applyLineArrow(doc, last, obj, "end", sign(last.row - beforeLast.row), sign(last.col - beforeLast.col));
}

export interface RenderElementOptions {
  /** The text label of this object is hidden while its in-canvas editor is open. */
  skipTextId?: string;
  /** Full shape bounds used by obstacle-aware line routing. */
  obstacles?: LineObstacle[];
}

export function renderRect(
  doc: DrawingDocument,
  obj: RectObject,
  options?: RenderElementOptions,
): void {
  const border = obj.borderless !== true;
  const fill = getShapeFill(obj);
  if (obj.w === 1 && obj.h === 1) {
    if (border) {
      put(doc, obj.y, obj.x, "□");
      return;
    }
    if (fill !== null && fill !== "") {
      put(doc, obj.y, obj.x, fill);
      return;
    }
  }
  if (border) {
    const interrupted = obj.interruptEnabled === true && !!obj.interrupt;
    if (interrupted) {
      const borderDoc = new DrawingDocument(doc.cols, doc.rows);
      drawRectangle(
        borderDoc,
        { row: obj.y, col: obj.x },
        { row: obj.y + obj.h - 1, col: obj.x + obj.w - 1 },
        { style: obj.style, fill: "none" },
      );
      applyInterruptPattern(borderDoc, obj);
      overlayNonBlank(borderDoc, doc);
      if (fill !== null) fillRectOnly(doc, obj, fill);
    } else {
      drawRectangle(
        doc,
        { row: obj.y, col: obj.x },
        { row: obj.y + obj.h - 1, col: obj.x + obj.w - 1 },
        fill === null
          ? { style: obj.style, fill: "none" }
          : { style: obj.style, fill: "custom", fillChar: fill === "" ? FILL_CLEAR : fill },
      );
    }
  } else if (fill !== null) {
    fillRectOnly(doc, obj, fill);
  }
  if (options?.skipTextId !== obj.id && obj.textEnabled !== false && typeof obj.text === "string" && obj.text.length > 0) {
    renderText(doc, {
      x: obj.x,
      y: obj.y,
      w: obj.w,
      h: obj.h,
      text: obj.text,
      font: obj.font ?? "normal",
      hAlign: obj.hAlign ?? "left",
      vAlign: obj.vAlign ?? "top",
      direction: obj.direction ?? "horizontal",
      wrap: obj.wrap ?? "down",
      padding: obj.padding ?? { top: 0, right: 1, bottom: 0, left: 1 },
    });
  }
}

function applyInterruptPattern(doc: DrawingDocument, obj: RectObject): void {
  const config = obj.interrupt;
  if (!config) return;
  const segment = Math.max(1, Math.round(config.segment));
  const gap = Math.max(1, Math.round(config.gap));
  const offset = Math.max(0, Math.round(config.offset));
  const period = segment + gap;
  const keep = (index: number): boolean => {
    const phase = ((index - offset) % period + period) % period;
    return phase < segment;
  };
  const cells: Array<[number, number]> = [];
  if (obj.h === 1) {
    for (let c = obj.x; c < obj.x + obj.w; c++) cells.push([obj.y, c]);
  } else if (obj.w === 1) {
    for (let r = obj.y; r < obj.y + obj.h; r++) cells.push([r, obj.x]);
  } else {
    for (let c = obj.x; c < obj.x + obj.w; c++) cells.push([obj.y, c]);
    for (let r = obj.y + 1; r < obj.y + obj.h - 1; r++) cells.push([r, obj.x + obj.w - 1]);
    for (let c = obj.x + obj.w - 1; c >= obj.x; c--) cells.push([obj.y + obj.h - 1, c]);
    for (let r = obj.y + obj.h - 2; r > obj.y; r--) cells.push([r, obj.x]);
  }
  for (let index = 0; index < cells.length; index++) {
    if (keep(index)) continue;
    const [r, c] = cells[index];
    doc.erase(r, c);
  }
}

function fillRectOnly(doc: DrawingDocument, obj: RectObject, fill: string): void {
  for (let r = obj.y + 1; r <= obj.y + obj.h - 2; r++) {
    for (let c = obj.x + 1; c <= obj.x + obj.w - 2; c++) {
      if (fill === "") doc.erase(r, c);
      else put(doc, r, c, fill);
    }
  }
}

export function renderDiamond(doc: DrawingDocument, obj: DiamondObject): void {
  if (obj.w === 1 && obj.h === 1) {
    put(doc, obj.y, obj.x, "◇");
    return;
  }
  const fill = getShapeFill(obj);
  drawDiamond(
    doc,
    { row: obj.y, col: obj.x },
    { row: obj.y + obj.h - 1, col: obj.x + obj.w - 1 },
    fill === null
      ? { style: obj.style, fill: "none" }
      : { style: obj.style, fill: "custom", fillChar: fill === "" ? FILL_CLEAR : fill },
  );
}

export function renderCircle(doc: DrawingDocument, obj: CircleObject): void {
  if (obj.w === 1 && obj.h === 1) {
    put(doc, obj.y, obj.x, "○");
    return;
  }
  const fill = getShapeFill(obj);
  drawEllipse(
    doc,
    { row: obj.y, col: obj.x },
    { row: obj.y + obj.h - 1, col: obj.x + obj.w - 1 },
    fill === null
      ? { style: obj.style, fill: "none" }
      : { style: obj.style, fill: "custom", fillChar: fill === "" ? FILL_CLEAR : fill },
  );
}

export function renderCells(doc: DrawingDocument, obj: CellsObject): void {
  for (const [r, c, ch] of obj.cells) {
    if (r < 0 || c < 0) continue;
    if (obj.role === "erase" || ch === " " || ch === "") doc.erase(r, c);
    else put(doc, r, c, ch);
  }
}

interface TextLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  font: TextTransform;
  hAlign: TextAlignH;
  vAlign: TextAlignV;
  direction: TextDirection;
  wrap: TextWrapMode;
  padding: Padding;
}

interface TextLine {
  text: string;
  width: number;
}

function measureText(text: string): number {
  let width = 0;
  for (const g of graphemes(text)) width += Math.max(1, graphemeWidth(g));
  return width;
}

function wrapLine(text: string, maxWidth: number): TextLine[] {
  if (maxWidth <= 0) return [];
  const result: TextLine[] = [];
  let current = "";
  let width = 0;
  const push = (value: string): void => {
    if (value.length > 0) result.push({ text: value, width: measureText(value) });
  };
  for (const g of graphemes(text)) {
    if (g === "\r") continue;
    const gw = Math.max(1, graphemeWidth(g));
    if (width + gw > maxWidth && current.length > 0) {
      const spaceIndex = current.lastIndexOf(" ");
      if (spaceIndex > 0) {
        const head = current.slice(0, spaceIndex);
        const tail = current.slice(spaceIndex + 1);
        push(head);
        current = tail;
      } else {
        push(current);
        current = "";
      }
      width = measureText(current);
    }
    if (current.length === 0 && g === " ") continue;
    current += g;
    width += gw;
  }
  push(current);
  return result;
}

function alignOffset(align: TextAlignH, inner: number, width: number): number {
  if (align === "center") return Math.max(0, Math.floor((inner - width) / 2));
  if (align === "right") return Math.max(0, inner - width);
  return 0;
}

function alignVOffset(align: TextAlignV, inner: number, height: number): number {
  if (align === "middle") return Math.max(0, Math.floor((inner - height) / 2));
  if (align === "bottom") return Math.max(0, inner - height);
  return 0;
}

function layoutHorizontal(doc: DrawingDocument, obj: TextLayout, transformed: string): void {
  const innerX = obj.x + obj.padding.left;
  const innerY = obj.y + obj.padding.top;
  const innerW = Math.max(0, obj.w - obj.padding.left - obj.padding.right);
  const innerH = Math.max(0, obj.h - obj.padding.top - obj.padding.bottom);
  if (innerW <= 0 || innerH <= 0) return;
  const paragraphs = transformed.replace(/\r\n?/g, "\n").split("\n");
  const lines: TextLine[] = [];
  for (const paragraph of paragraphs) {
    const wrapped = wrapLine(paragraph, innerW);
    for (const line of wrapped) lines.push(line);
  }
  const visible = lines.slice(0, innerH);
  const vOffset = alignVOffset(obj.vAlign, innerH, visible.length);
  for (let i = 0; i < visible.length; i++) {
    const line = visible[i];
    const targetRow = obj.wrap === "up"
      ? innerY + innerH - 1 - (vOffset + i)
      : innerY + vOffset + i;
    if (targetRow < innerY || targetRow >= innerY + innerH) continue;
    let col = innerX + alignOffset(obj.hAlign, innerW, line.width);
    for (const g of graphemes(line.text)) {
      const w = Math.max(1, graphemeWidth(g));
      if (col + w > innerX + innerW) break;
      if (g !== " " && g !== "\u3000") put(doc, targetRow, col, g);
      col += w;
    }
  }
}

function layoutVertical(doc: DrawingDocument, obj: TextLayout, transformed: string): void {
  const innerX = obj.x + obj.padding.left;
  const innerY = obj.y + obj.padding.top;
  const innerW = Math.max(0, obj.w - obj.padding.left - obj.padding.right);
  const innerH = Math.max(0, obj.h - obj.padding.top - obj.padding.bottom);
  if (innerW <= 0 || innerH <= 0) return;
  const paragraphs = transformed.replace(/\r\n?/g, "\n").split("\n");
  const allChars: string[] = [];
  for (const paragraph of paragraphs) {
    for (const g of graphemes(paragraph)) {
      if (g === "\r") continue;
      allChars.push(g);
    }
    allChars.push("\n");
  }
  let maxGlyphWidth = 1;
  for (const g of allChars) {
    if (g === "\n") continue;
    maxGlyphWidth = Math.max(maxGlyphWidth, graphemeWidth(g));
  }
  const colW = maxGlyphWidth;
  const capacity = Math.max(1, Math.floor(innerW / colW));
  const columns: string[][] = [];
  let column: string[] = [];
  for (const g of allChars) {
    if (g === "\n" || column.length >= innerH) {
      if (column.length > 0) columns.push(column);
      column = [];
      if (g === "\n") continue;
    }
    column.push(g);
  }
  if (column.length > 0) columns.push(column);
  const visible = columns.slice(0, capacity);
  const hOffset = alignOffset(obj.hAlign, innerW, visible.length * colW);
  for (let i = 0; i < visible.length; i++) {
    const colIndex = obj.wrap === "left" ? visible.length - 1 - i : i;
    const x = innerX + hOffset + colIndex * colW;
    const chars = visible[i];
    const vOffset = alignVOffset(obj.vAlign, innerH, chars.length);
    for (let j = 0; j < chars.length; j++) {
      const g = chars[j];
      const w = Math.max(1, graphemeWidth(g));
      const row = innerY + vOffset + j;
      if (row >= innerY + innerH) break;
      if (x + w > innerX + innerW) break;
      if (g !== " " && g !== "\u3000") put(doc, row, x, g);
    }
  }
}

export function renderText(doc: DrawingDocument, obj: TextLayout): void {
  if (!obj.text) return;
  const transformed = transformText(obj.text, obj.font);
  if (obj.direction === "vertical") layoutVertical(doc, obj, transformed);
  else layoutHorizontal(doc, obj, transformed);
}

function overlayNonBlank(source: DrawingDocument, target: DrawingDocument): void {
  const rows = Math.min(source.rows, target.rows);
  const cols = Math.min(source.cols, target.cols);
  for (let r = 0; r < rows; r++) {
    const row = source.rawRow(r);
    if (!row) continue;
    for (let c = 0; c < cols; c++) {
      const raw = row[c];
      if (!raw || raw === " ") continue;
      if (raw === FILL_CLEAR) {
        target.erase(r, c);
        continue;
      }
      if (raw === WIDE_CONT) continue;
      target.setGlyph(r, c, raw, true);
    }
  }
}

/**
 * Render one element as an independent layer.
 *
 * Each shape is rasterized into its own temporary document first, so its
 * corners and junctions never consider another element's glyphs. The result
 * is then overprinted in element order. This is what keeps overlapping
 * rectangles/lines visually independent instead of turning crossings into
 * ╬/┼ glyphs. Erase objects still clear the target layer directly.
 */
export function renderElement(
  target: DrawingDocument,
  object: import("../core/objects").DrawingObject,
  options?: RenderElementOptions,
): void {
  if (!isElementVisible(object)) return;
  if (object.kind === "group") {
    if (object.renderMode === "merge") {
      const groupDoc = new DrawingDocument(target.cols, target.rows);
      for (const child of object.children) renderObject(groupDoc, child, options);
      overlayNonBlank(groupDoc, target);
    } else {
      for (const child of object.children) renderElement(target, child, options);
    }
    return;
  }
  if (object.kind === "cells") {
    renderCells(target, object);
    return;
  }
  const isolated = new DrawingDocument(target.cols, target.rows);
  renderObject(isolated, object, options);
  overlayNonBlank(isolated, target);
}

export function renderObject(
  doc: DrawingDocument,
  object: import("../core/objects").DrawingObject,
  options?: RenderElementOptions,
): void {
  if (!isElementVisible(object)) return;
  switch (object.kind) {
    case "line":
      renderLine(doc, object, options);
      break;
    case "rect":
      renderRect(doc, object, options);
      break;
    case "circle":
      renderCircle(doc, object);
      break;
    case "diamond":
      renderDiamond(doc, object);
      break;
    case "cells":
      renderCells(doc, object);
      break;
    case "group":
      for (const child of object.children) renderObject(doc, child, options);
      break;
  }
}

export function rasterizeObject(
  object: import("../core/objects").DrawingObject,
  cols: number,
  rows: number,
): DrawingDocument {
  const doc = new DrawingDocument(Math.max(1, cols), Math.max(1, rows));
  renderObject(doc, object);
  return doc;
}

export function textFontSample(font: TextTransform): string {
  return transformText("Unidraw", font);
}

export { measureText };
