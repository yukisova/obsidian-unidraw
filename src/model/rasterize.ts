import { DrawingDocument, WIDE_CONT } from "../core/document";
import type { CellPos, ArrowStyle, LineRoute, StrokeStyle, TextAlignH, TextAlignV, TextDirection, TextTransform, TextWrapMode } from "../core/types";
import { graphemeWidth, graphemes } from "../core/unicode";
import type { CircleObject, DiamondObject, GroupObject, LineObject, Padding, RectObject, CellsObject } from "../core/objects";
import { getShapeFill, isElementVisible } from "../core/objects";
import { diagonalGlyph, paintMask } from "../glyphs/box";
import { drawDiamond, drawEllipse, drawRectangle } from "../glyphs/shapes";
import { transformText } from "../glyphs/text-styles";

export const FILL_CLEAR = "\uE000";

type Dir = "N" | "E" | "S" | "W" | "NE" | "SE" | "SW" | "NW";

const ARROW_CHARS: Record<Exclude<ArrowStyle, "none">, Record<Dir, string>> = {
  line: { N: "↑", E: "→", S: "↓", W: "←", NE: "↗", SE: "↘", SW: "↙", NW: "↖" },
  hollow: { N: "△", E: "▷", S: "▽", W: "◁", NE: "⇗", SE: "⇘", SW: "⇙", NW: "⇖" },
  solid: { N: "▲", E: "▶", S: "▼", W: "◀", NE: "⬈", SE: "⬊", SW: "⬋", NW: "⬉" },
};

function sign(n: number): number {
  return n === 0 ? 0 : n > 0 ? 1 : -1;
}

function dirFromDelta(dr: number, dc: number): Dir {
  if (dr < 0 && dc > 0) return "NE";
  if (dr > 0 && dc > 0) return "SE";
  if (dr > 0 && dc < 0) return "SW";
  if (dr < 0 && dc < 0) return "NW";
  if (dr < 0) return "N";
  if (dr > 0) return "S";
  if (dc > 0) return "E";
  return "W";
}

function arrowChar(style: ArrowStyle, dr: number, dc: number): string | null {
  if (style === "none") return null;
  return ARROW_CHARS[style][dirFromDelta(dr, dc)];
}

function put(doc: DrawingDocument, r: number, c: number, ch: string): void {
  if (r < 0 || c < 0) return;
  doc.setGlyph(r, c, ch, true);
}

function paintAxisPath(doc: DrawingDocument, points: CellPos[], style: StrokeStyle): void {
  if (points.length === 0) return;
  if (points.length === 1) {
    paintMask(doc, points[0].row, points[0].col, 0, style);
    return;
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    const next = points[i + 1];
    let mask = 0;
    if (prev) {
      const dr = sign(prev.row - p.row);
      const dc = sign(prev.col - p.col);
      if (dr < 0) mask |= 1;
      if (dc > 0) mask |= 2;
      if (dr > 0) mask |= 4;
      if (dc < 0) mask |= 8;
    }
    if (next) {
      const dr = sign(next.row - p.row);
      const dc = sign(next.col - p.col);
      if (dr < 0) mask |= 1;
      if (dc > 0) mask |= 2;
      if (dr > 0) mask |= 4;
      if (dc < 0) mask |= 8;
    }
    if (mask) paintMask(doc, p.row, p.col, mask, style);
  }
}

function plotPath(
  doc: DrawingDocument,
  points: CellPos[],
  style: StrokeStyle,
  options: { diagonal?: boolean } = {},
): void {
  if (points.length === 0) return;
  if (options.diagonal) {
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const next = points[i + 1] ?? points[i - 1];
      if (!next) continue;
      const dr = sign(next.row - p.row);
      const dc = sign(next.col - p.col);
      if (dr !== 0 && dc !== 0) put(doc, p.row, p.col, diagonalGlyph(dr, dc, style));
      else {
        let mask = 0;
        if (dr < 0) mask |= 1;
        if (dc > 0) mask |= 2;
        if (dr > 0) mask |= 4;
        if (dc < 0) mask |= 8;
        if (mask) paintMask(doc, p.row, p.col, mask, style);
      }
    }
    return;
  }
  paintAxisPath(doc, points, style);
}

function diagonalSegment(a: CellPos, steps: number, sr: number, sc: number): CellPos[] {
  const points: CellPos[] = [];
  for (let i = 0; i <= steps; i++) points.push({ row: a.row + sr * i, col: a.col + sc * i });
  return points;
}

function horizontalSegment(a: CellPos, count: number): CellPos[] {
  const points: CellPos[] = [];
  const sc = sign(count);
  for (let i = 0; i <= Math.abs(count); i++) points.push({ row: a.row, col: a.col + sc * i });
  return points;
}

function verticalSegment(a: CellPos, count: number): CellPos[] {
  const points: CellPos[] = [];
  const sr = sign(count);
  for (let i = 0; i <= Math.abs(count); i++) points.push({ row: a.row + sr * i, col: a.col });
  return points;
}

/** Bresenham line points (one cell per major-axis step). */
function bresenhamLine(a: CellPos, b: CellPos): CellPos[] {
  const points: CellPos[] = [];
  let x0 = a.col;
  let y0 = a.row;
  const x1 = b.col;
  const y1 = b.row;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    points.push({ row: y0, col: x0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return points;
}

function plotStraight(doc: DrawingDocument, a: CellPos, b: CellPos, style: StrokeStyle): void {
  const points = bresenhamLine(a, b);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const next = points[i + 1];
    const prev = points[i - 1];
    const step = next ?? p;
    const dr = sign(step.row - p.row);
    const dc = sign(step.col - p.col);
    if (dr !== 0 && dc !== 0) {
      put(doc, p.row, p.col, diagonalGlyph(dr, dc, style));
      continue;
    }
    let mask = 0;
    if (prev) {
      const pdr = sign(prev.row - p.row);
      const pdc = sign(prev.col - p.col);
      if (pdr < 0) mask |= 1;
      if (pdc > 0) mask |= 2;
      if (pdr > 0) mask |= 4;
      if (pdc < 0) mask |= 8;
    }
    if (next) {
      const ndr = sign(next.row - p.row);
      const ndc = sign(next.col - p.col);
      if (ndr < 0) mask |= 1;
      if (ndc > 0) mask |= 2;
      if (ndr > 0) mask |= 4;
      if (ndc < 0) mask |= 8;
    }
    if (mask) paintMask(doc, p.row, p.col, mask, style);
  }
}

function lineEndpoints(obj: LineObject): [CellPos, CellPos] {
  return [
    { row: obj.y1, col: obj.x1 },
    { row: obj.y2, col: obj.x2 },
  ];
}

function applyArrow(
  doc: DrawingDocument,
  cell: CellPos,
  style: ArrowStyle,
  dr: number,
  dc: number,
): void {
  const ch = arrowChar(style, dr, dc);
  if (ch) put(doc, cell.row, cell.col, ch);
}

/** Render a line object, including all three routing modes and arrow styles. */
export function renderLine(doc: DrawingDocument, obj: LineObject): void {
  const [start, end] = lineEndpoints(obj);
  const dr = end.row - start.row;
  const dc = end.col - start.col;
  if (dr === 0 && dc === 0) {
    put(doc, start.row, start.col, "•");
    return;
  }
  if (obj.route === "elbow") {
    const horizontalFirst = Math.abs(dc) >= Math.abs(dr);
    const corner = horizontalFirst
      ? { row: start.row, col: end.col }
      : { row: end.row, col: start.col };
    const first = horizontalFirst
      ? horizontalSegment(start, corner.col - start.col)
      : verticalSegment(start, corner.row - start.row);
    const second = horizontalFirst
      ? verticalSegment({ row: corner.row, col: corner.col }, end.row - corner.row)
      : horizontalSegment({ row: corner.row, col: corner.col }, end.col - corner.col);
    const points = first.concat(second.slice(1));
    paintAxisPath(doc, points, obj.style);
    const lastDir = points.length > 1
      ? [sign(points[points.length - 1].row - points[points.length - 2].row), sign(points[points.length - 1].col - points[points.length - 2].col)]
      : [sign(dr), sign(dc)];
    const firstDir = points.length > 1
      ? [sign(points[0].row - points[1].row), sign(points[0].col - points[1].col)]
      : [-sign(dr), -sign(dc)];
    applyArrow(doc, start, obj.arrowStart, firstDir[0], firstDir[1]);
    applyArrow(doc, end, obj.arrowEnd, lastDir[0], lastDir[1]);
    return;
  }
  if (obj.route === "diagonal") {
    const d = Math.min(Math.abs(dr), Math.abs(dc));
    const bend = { row: start.row + sign(dr) * d, col: start.col + sign(dc) * d };
    const diagonalPoints = diagonalSegment(start, d, sign(dr), sign(dc));
    plotPath(doc, diagonalPoints, obj.style, { diagonal: true });
    if (Math.abs(dc) > Math.abs(dr)) {
      const remainder = horizontalSegment(bend, end.col - bend.col);
      paintAxisPath(doc, remainder, obj.style);
    } else if (Math.abs(dr) > Math.abs(dc)) {
      const remainder = verticalSegment(bend, end.row - bend.row);
      paintAxisPath(doc, remainder, obj.style);
    }
    applyArrow(doc, start, obj.arrowStart, -sign(dr), -sign(dc));
    if (Math.abs(dc) > Math.abs(dr)) applyArrow(doc, end, obj.arrowEnd, 0, sign(dc));
    else applyArrow(doc, end, obj.arrowEnd, sign(dr), 0);
    return;
  }
  plotStraight(doc, start, end, obj.style);
  const firstDir = pointsDirection(start, end);
  if (Math.abs(dr) === 0) {
    applyArrow(doc, start, obj.arrowStart, 0, -sign(dc));
    applyArrow(doc, end, obj.arrowEnd, 0, sign(dc));
  } else if (Math.abs(dc) === 0) {
    applyArrow(doc, start, obj.arrowStart, -sign(dr), 0);
    applyArrow(doc, end, obj.arrowEnd, sign(dr), 0);
  } else {
    const points = bresenhamLine(start, end);
    const p0 = points[Math.min(1, points.length - 1)];
    const p1 = points[points.length - 1];
    const before = points[Math.max(0, points.length - 2)];
    applyArrow(doc, start, obj.arrowStart, sign(start.row - p0.row), sign(start.col - p0.col));
    applyArrow(doc, end, obj.arrowEnd, sign(p1.row - before.row), sign(p1.col - before.col));
    void firstDir;
  }
}

function pointsDirection(a: CellPos, b: CellPos): [number, number] {
  return [sign(b.row - a.row), sign(b.col - a.col)];
}

export interface RenderElementOptions {
  /** The text label of this object is hidden while its in-canvas editor is open. */
  skipTextId?: string;
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
    for (const child of object.children) renderElement(target, child, options);
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
      renderLine(doc, object);
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
