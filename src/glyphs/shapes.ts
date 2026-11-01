import type { DrawingDocument } from "../core/document";
import type { CellPos, FillMode, LineRoute, SelectionRect, StrokeStyle } from "../core/types";
import {
  arrowGlyph,
  diagonalGlyph,
  directionMask,
  E,
  glyphFor,
  N,
  paintChar,
  paintMask,
  S,
  strokeInfo,
  W,
} from "./box";
import { fillGlyph } from "./fill";

export type ElbowMode = "auto" | "horizontal" | "vertical";

export interface LineOptions {
  style: StrokeStyle;
  route?: LineRoute;
  elbow?: ElbowMode;
  arrowStart?: boolean;
  arrowEnd?: boolean;
}

export interface ShapeOptions {
  style: StrokeStyle;
  fill: FillMode;
  fillChar?: string;
}


function sign(n: number): number {
  return n === 0 ? 0 : n > 0 ? 1 : -1;
}

function posEquals(a: CellPos, b: CellPos): boolean {
  return a.row === b.row && a.col === b.col;
}

function dedupePath(path: CellPos[]): CellPos[] {
  const out: CellPos[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || !posEquals(last, p)) out.push(p);
  }
  return out;
}

export function normalizeRect(a: CellPos, b: CellPos): SelectionRect {
  return {
    r0: Math.min(a.row, b.row),
    r1: Math.max(a.row, b.row),
    c0: Math.min(a.col, b.col),
    c1: Math.max(a.col, b.col),
  };
}

/** Straight staircase path made of 4-connected cells. */
export function staircasePath(a: CellPos, b: CellPos): CellPos[] {
  const path: CellPos[] = [{ row: a.row, col: a.col }];
  const dr = b.row - a.row;
  const dc = b.col - a.col;
  if (dr === 0 && dc === 0) return path;
  const sr = sign(dr);
  const sc = sign(dc);
  const vSteps = Math.abs(dr);
  const hSteps = Math.abs(dc);

  if (vSteps >= hSteps) {
    let currentCol = a.col;
    for (let i = 1; i <= vSteps; i++) {
      const row = a.row + sr * i;
      const prevRow = row - sr;
      const targetCol = hSteps === 0 ? a.col : a.col + Math.round((dc * i) / vSteps);
      // Horizontal run happens on the previous row.
      while (currentCol !== targetCol) {
        currentCol += sign(targetCol - currentCol);
        path.push({ row: prevRow, col: currentCol });
      }
      path.push({ row, col: currentCol });
    }
    while (currentCol !== b.col) {
      currentCol += sign(b.col - currentCol);
      path.push({ row: b.row, col: currentCol });
    }
  } else {
    let currentRow = a.row;
    for (let i = 1; i <= hSteps; i++) {
      const col = a.col + sc * i;
      const prevCol = col - sc;
      const targetRow = vSteps === 0 ? a.row : a.row + Math.round((dr * i) / hSteps);
      while (currentRow !== targetRow) {
        currentRow += sign(targetRow - currentRow);
        path.push({ row: currentRow, col: prevCol });
      }
      path.push({ row: currentRow, col });
    }
    while (currentRow !== b.row) {
      currentRow += sign(b.row - currentRow);
      path.push({ row: currentRow, col: b.col });
    }
  }
  return dedupePath(path);
}

/** Two-segment, right-angle connector. */
export function elbowPath(a: CellPos, b: CellPos, mode: ElbowMode = "auto"): CellPos[] {
  if (a.row === b.row || a.col === b.col) return staircasePath(a, b);
  let horizontalFirst: boolean;
  if (mode === "horizontal") horizontalFirst = true;
  else if (mode === "vertical") horizontalFirst = false;
  else horizontalFirst = Math.abs(b.col - a.col) >= Math.abs(b.row - a.row);
  const corner = horizontalFirst
    ? { row: a.row, col: b.col }
    : { row: b.row, col: a.col };
  const path: CellPos[] = [{ row: a.row, col: a.col }];
  const addRun = (from: CellPos, to: CellPos) => {
    const dr = sign(to.row - from.row);
    const dc = sign(to.col - from.col);
    let r = from.row;
    let c = from.col;
    while (r !== to.row || c !== to.col) {
      if (c !== to.col) c += dc;
      else r += dr;
      path.push({ row: r, col: c });
    }
  };
  addRun(a, corner);
  addRun(corner, b);
  return dedupePath(path);
}

function addMask(map: Map<string, number>, p: CellPos, mask: number): void {
  const key = `${p.row},${p.col}`;
  map.set(key, (map.get(key) ?? 0) | mask);
}

function buildMaskMap(path: CellPos[], closed: boolean): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    const b = path[i + 1] ?? (closed ? path[0] : null);
    if (!b) continue;
    const dr = b.row - a.row;
    const dc = b.col - a.col;
    if (Math.abs(dr) + Math.abs(dc) !== 1) continue;
    const forward = directionMask(dr, dc);
    const backward = directionMask(-dr, -dc);
    addMask(map, a, forward);
    addMask(map, b, backward);
  }
  return map;
}

/**
 * Paint a path with junction merging. Free line ends get a full cap, while
 * ends that touch an existing line keep only the connecting direction so the
 * existing line becomes a tee instead of a cross.
 */
function paintPath(
  doc: DrawingDocument,
  path: CellPos[],
  style: StrokeStyle,
  options: { closed?: boolean; capEnds?: boolean } = {},
): void {
  if (path.length === 0) return;
  if (path.length === 1) {
    paintChar(doc, path[0].row, path[0].col, "•");
    return;
  }
  const maskMap = buildMaskMap(path, options.closed ?? false);
  if (!options.closed && (options.capEnds ?? true)) {
    for (const end of [path[0], path[path.length - 1]]) {
      const key = `${end.row},${end.col}`;
      let mask = maskMap.get(key) ?? 0;
      if (!mask) continue;
      const existing = doc.charAt(end.row, end.col);
      const isExistingLine = existing !== " " && strokeInfo(existing) !== null;
      if (isExistingLine) continue;
      // Add the direction opposite to the sole connection (a cap).
      const opposite: number[] = [];
      if (mask & N) opposite.push(S);
      if (mask & S) opposite.push(N);
      if (mask & E) opposite.push(W);
      if (mask & W) opposite.push(E);
      if (opposite.length === 1) {
        mask |= opposite[0];
        maskMap.set(key, mask);
      }
    }
  }
  for (const [key, mask] of maskMap) {
    const [r, c] = key.split(",").map(Number);
    paintMask(doc, r, c, mask, style);
  }
}

function paintDiagonalRun(
  doc: DrawingDocument,
  path: CellPos[],
  dir: [number, number],
  style: StrokeStyle,
): void {
  const ch = diagonalGlyph(dir[0], dir[1], style);
  for (const p of path) paintChar(doc, p.row, p.col, ch);
}

function arrowDirection(path: CellPos[], atEnd: boolean, fallback: [number, number]): [number, number] {
  if (path.length >= 2) {
    if (atEnd) {
      const last = path[path.length - 1];
      const prev = path[path.length - 2];
      return [sign(last.row - prev.row), sign(last.col - prev.col)];
    }
    const first = path[0];
    const second = path[1];
    // The start arrow points outwards, opposite the outgoing segment.
    return [sign(first.row - second.row), sign(first.col - second.col)];
  }
  if (atEnd) return fallback;
  return [-fallback[0], -fallback[1]];
}

function applyArrows(
  doc: DrawingDocument,
  path: CellPos[],
  options: LineOptions,
  fallback: [number, number],
): void {
  if (path.length === 0) return;
  if (path.length === 1) {
    if (options.arrowStart && options.arrowEnd) {
      paintChar(doc, path[0].row, path[0].col, "↔");
    } else if (options.arrowEnd) {
      paintChar(doc, path[0].row, path[0].col, arrowGlyph(fallback[0], fallback[1]));
    } else if (options.arrowStart) {
      paintChar(doc, path[0].row, path[0].col, arrowGlyph(-fallback[0], -fallback[1]));
    }
    return;
  }
  if (options.arrowEnd) {
    const dir = arrowDirection(path, true, fallback);
    const last = path[path.length - 1];
    paintChar(doc, last.row, last.col, arrowGlyph(dir[0], dir[1]));
  }
  if (options.arrowStart) {
    const dir = arrowDirection(path, false, fallback);
    const first = path[0];
    paintChar(doc, first.row, first.col, arrowGlyph(dir[0], dir[1]));
  }
}

/** Draw a straight or elbow line. */
export function drawLine(doc: DrawingDocument, a: CellPos, b: CellPos, options: LineOptions): void {
  const style = options.style;
  const fallback: [number, number] = [sign(b.row - a.row), sign(b.col - a.col)];
  const route = options.route ?? "straight";

  if (a.row === b.row && a.col === b.col) {
    applyArrows(doc, [a], options, fallback);
    if (!options.arrowStart && !options.arrowEnd) paintChar(doc, a.row, a.col, "•");
    return;
  }

  if (route === "elbow") {
    const path = elbowPath(a, b, options.elbow ?? "auto");
    paintPath(doc, path, style, { capEnds: true });
    applyArrows(doc, path, options, fallback);
    return;
  }

  const dr = b.row - a.row;
  const dc = b.col - a.col;
  if (Math.abs(dr) > 0 && Math.abs(dr) === Math.abs(dc)) {
    // Perfect 45° diagonal: diagonal glyphs read better than a staircase.
    const path: CellPos[] = [];
    const steps = Math.abs(dr);
    const sr = sign(dr);
    const sc = sign(dc);
    for (let i = 0; i <= steps; i++) path.push({ row: a.row + sr * i, col: a.col + sc * i });
    paintDiagonalRun(doc, path, [sr, sc], style);
    applyArrows(doc, path, options, fallback);
    return;
  }

  const path = staircasePath(a, b);
  paintPath(doc, path, style, { capEnds: true });
  applyArrows(doc, path, options, fallback);
}

/** Rectangle (with optional rounded corners via the rounded stroke style). */
export function drawRectangle(
  doc: DrawingDocument,
  a: CellPos,
  b: CellPos,
  options: ShapeOptions,
): SelectionRect {
  const rect = normalizeRect(a, b);
  const w = rect.c1 - rect.c0 + 1;
  const h = rect.r1 - rect.r0 + 1;
  if (w <= 0 || h <= 0) return rect;
  if (w === 1 && h === 1) {
    paintChar(doc, rect.r0, rect.c0, glyphFor(N | E | S | W, options.style));
    return rect;
  }
  if (h === 1) {
    paintMask(doc, rect.r0, rect.c0, E, options.style);
    for (let c = rect.c0 + 1; c <= rect.c1 - 1; c++) paintMask(doc, rect.r0, c, E | W, options.style);
    paintMask(doc, rect.r0, rect.c1, W, options.style);
    return rect;
  }
  if (w === 1) {
    paintMask(doc, rect.r0, rect.c0, S, options.style);
    for (let r = rect.r0 + 1; r <= rect.r1 - 1; r++) paintMask(doc, r, rect.c0, N | S, options.style);
    paintMask(doc, rect.r1, rect.c0, N, options.style);
    return rect;
  }

  const path: CellPos[] = [];
  for (let c = rect.c0; c <= rect.c1; c++) path.push({ row: rect.r0, col: c });
  for (let r = rect.r0 + 1; r <= rect.r1; r++) path.push({ row: r, col: rect.c1 });
  for (let c = rect.c1 - 1; c >= rect.c0; c--) path.push({ row: rect.r1, col: c });
  for (let r = rect.r1 - 1; r > rect.r0; r--) path.push({ row: r, col: rect.c0 });
  paintPath(doc, path, options.style, { closed: true });

  if (options.fill !== "none") {
    fillRectInterior(doc, rect, options.fill, options.fillChar ?? "");
  }
  return rect;
}

function shouldFillCell(doc: DrawingDocument, r: number, c: number): boolean {
  const glyph = doc.glyphAt(r, c);
  return !!glyph && (glyph.char === " " || glyph.char === "\u3000");
}

function writeFill(doc: DrawingDocument, r: number, c: number, mode: FillMode, custom: string): void {
  const ch = fillGlyph(mode, r, c, custom);
  if (ch === " " || ch === "") return;
  if (!shouldFillCell(doc, r, c)) return;
  doc.setGlyph(r, c, ch, true);
}

function fillRectInterior(doc: DrawingDocument, rect: SelectionRect, mode: FillMode, custom: string): void {
  for (let r = rect.r0 + 1; r <= rect.r1 - 1; r++) {
    for (let c = rect.c0 + 1; c <= rect.c1 - 1; c++) {
      writeFill(doc, r, c, mode, custom);
    }
  }
}

function fillSpans(
  doc: DrawingDocument,
  rMin: number,
  rMax: number,
  spanForRow: (r: number) => [number, number] | null,
  mode: FillMode,
  custom: string,
): void {
  if (mode === "none") return;
  for (let r = rMin; r <= rMax; r++) {
    const span = spanForRow(r);
    if (!span) continue;
    const [left, right] = span;
    for (let c = left; c <= right; c++) writeFill(doc, r, c, mode, custom);
  }
}

function ellipseExtents(rect: SelectionRect): { left: number[]; right: number[] } {
  const w = rect.c1 - rect.c0 + 1;
  const h = rect.r1 - rect.r0 + 1;
  const centerC = (rect.c0 + rect.c1 + 1) / 2;
  const centerR = (rect.r0 + rect.r1 + 1) / 2;
  const radiusC = w / 2;
  const radiusR = h / 2;
  const left: number[] = [];
  const right: number[] = [];
  for (let r = rect.r0; r <= rect.r1; r++) {
    const dy = (r + 0.5 - centerR) / radiusR;
    const inside = Math.max(0, 1 - dy * dy);
    const dx = radiusC * Math.sqrt(inside);
    const l = Math.max(rect.c0, Math.min(rect.c1, Math.ceil(centerC - dx - 0.5)));
    const rr = Math.max(rect.c0, Math.min(rect.c1, Math.floor(centerC + dx - 0.5)));
    if (l <= rr) {
      left.push(l);
      right.push(rr);
    } else {
      const mid = Math.max(rect.c0, Math.min(rect.c1, Math.round(centerC - 0.5)));
      left.push(mid);
      right.push(mid);
    }
  }
  return { left, right };
}

function buildEllipsePath(rect: SelectionRect): CellPos[] {
  const { left, right } = ellipseExtents(rect);
  const path: CellPos[] = [];
  let row = rect.r0;
  let col = left[0];
  const push = (r: number, c: number) => {
    const last = path[path.length - 1];
    if (!last || last.row !== r || last.col !== c) path.push({ row: r, col: c });
  };
  push(row, col);
  while (col < right[0]) {
    col++;
    push(row, col);
  }
  for (let i = 1; i < left.length; i++) {
    const target = right[i];
    while (col !== target) {
      col += Math.sign(target - col);
      push(row, col);
    }
    row = rect.r0 + i;
    push(row, col);
  }
  while (col > left[left.length - 1]) {
    col--;
    push(row, col);
  }
  for (let i = left.length - 2; i >= 0; i--) {
    const target = left[i];
    while (col !== target) {
      col += Math.sign(target - col);
      push(row, col);
    }
    row = rect.r0 + i;
    push(row, col);
  }
  return path;
}

/** Ellipse outline + interior fill. */
export function drawEllipse(
  doc: DrawingDocument,
  a: CellPos,
  b: CellPos,
  options: ShapeOptions,
): SelectionRect {
  const rect = normalizeRect(a, b);
  const w = rect.c1 - rect.c0 + 1;
  const h = rect.r1 - rect.r0 + 1;
  if (w <= 1 || h <= 1) {
    if (h === 1) {
      const path: CellPos[] = [];
      for (let c = rect.c0; c <= rect.c1; c++) path.push({ row: rect.r0, col: c });
      paintPath(doc, path, options.style, { capEnds: true });
    } else if (w === 1) {
      const path: CellPos[] = [];
      for (let r = rect.r0; r <= rect.r1; r++) path.push({ row: r, col: rect.c0 });
      paintPath(doc, path, options.style, { capEnds: true });
    } else {
      paintChar(doc, rect.r0, rect.c0, glyphFor(N | E | S | W, options.style));
    }
    return rect;
  }
  const path = buildEllipsePath(rect);
  paintPath(doc, path, options.style, { closed: true });
  if (options.fill !== "none") {
    const { left, right } = ellipseExtents(rect);
    fillSpans(
      doc,
      rect.r0 + 1,
      rect.r1 - 1,
      (r) => {
        const index = r - rect.r0;
        const l = left[index] ?? rect.c0;
        const rr = right[index] ?? rect.c1;
        return l + 1 <= rr - 1 ? [l + 1, rr - 1] : null;
      },
      options.fill,
      options.fillChar ?? "",
    );
  }
  return rect;
}

function paintDiagonalEdge(doc: DrawingDocument, a: CellPos, b: CellPos, style: StrokeStyle): CellPos[] {
  const dr = b.row - a.row;
  const dc = b.col - a.col;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  if (steps === 0) return [a];
  const sr = sign(dr);
  const sc = sign(dc);
  const path: CellPos[] = [];
  for (let i = 0; i <= steps; i++) {
    const r = a.row + Math.round((dr * i) / steps);
    const c = a.col + Math.round((dc * i) / steps);
    path.push({ row: r, col: c });
  }
  const unique = dedupePath(path);
  if (Math.abs(dr) >= Math.abs(dc)) {
    paintDiagonalRun(doc, unique, [sr, sc], style);
  } else {
    paintDiagonalRun(doc, unique, [sr, sc], style);
  }
  return unique;
}

/** Diamond outline + interior fill. */
export function drawDiamond(
  doc: DrawingDocument,
  a: CellPos,
  b: CellPos,
  options: ShapeOptions,
): SelectionRect {
  const rect = normalizeRect(a, b);
  const w = rect.c1 - rect.c0 + 1;
  const h = rect.r1 - rect.r0 + 1;
  if (w <= 2 || h <= 2) {
    if (h === 1) drawLine(doc, { row: rect.r0, col: rect.c0 }, { row: rect.r0, col: rect.c1 }, { style: options.style });
    else if (w === 1) drawLine(doc, { row: rect.r0, col: rect.c0 }, { row: rect.r1, col: rect.c0 }, { style: options.style });
    else drawRectangle(doc, a, b, options);
    return rect;
  }
  const midC = Math.round((rect.c0 + rect.c1) / 2);
  const midR = Math.round((rect.r0 + rect.r1) / 2);
  const topLeft = { row: rect.r0, col: midC };
  const topRight = { row: rect.r0, col: Math.min(rect.c1, midC + 1) };
  const right = { row: midR, col: rect.c1 };
  const bottomRight = { row: rect.r1, col: Math.min(rect.c1, midC + 1) };
  const bottomLeft = { row: rect.r1, col: midC };
  const left = { row: midR, col: rect.c0 };
  paintDiagonalEdge(doc, topLeft, left, options.style);
  paintDiagonalEdge(doc, left, bottomLeft, options.style);
  paintDiagonalEdge(doc, topRight, right, options.style);
  paintDiagonalEdge(doc, right, bottomRight, options.style);

  if (options.fill !== "none") {
    const radiusC = w / 2;
    const radiusR = h / 2;
    const centerC = (rect.c0 + rect.c1) / 2;
    const centerR = (rect.r0 + rect.r1) / 2;
    fillSpans(
      doc,
      rect.r0 + 1,
      rect.r1 - 1,
      (r) => {
        const t = Math.abs(r - centerR) / radiusR;
        if (t >= 1) return null;
        const half = radiusC * (1 - t) - 1;
        if (half < 0) return null;
        return [Math.ceil(centerC - half), Math.floor(centerC + half)];
      },
      options.fill,
      options.fillChar ?? "",
    );
  }
  return rect;
}

/** Triangle outline + interior fill. */
export function drawTriangle(
  doc: DrawingDocument,
  a: CellPos,
  b: CellPos,
  options: ShapeOptions,
): SelectionRect {
  const rect = normalizeRect(a, b);
  const w = rect.c1 - rect.c0 + 1;
  const h = rect.r1 - rect.r0 + 1;
  if (h <= 1 || w <= 1) {
    if (h === 1) drawLine(doc, { row: rect.r0, col: rect.c0 }, { row: rect.r0, col: rect.c1 }, { style: options.style });
    else drawLine(doc, { row: rect.r0, col: rect.c0 }, { row: rect.r1, col: rect.c0 }, { style: options.style });
    return rect;
  }
  const midC = Math.round((rect.c0 + rect.c1) / 2);
  const topLeft = { row: rect.r0, col: midC };
  const topRight = { row: rect.r0, col: Math.min(rect.c1, midC + 1) };
  const bottomLeft = { row: rect.r1, col: rect.c0 };
  const bottomRight = { row: rect.r1, col: rect.c1 };
  paintDiagonalEdge(doc, topLeft, bottomLeft, options.style);
  paintDiagonalEdge(doc, topRight, bottomRight, options.style);
  if (w >= 3) {
    const base: CellPos[] = [];
    for (let c = rect.c0 + 1; c <= rect.c1 - 1; c++) base.push({ row: rect.r1, col: c });
    if (base.length > 0) paintPath(doc, base, options.style, { capEnds: true });
  }

  if (options.fill !== "none") {
    const centerC = (rect.c0 + rect.c1) / 2;
    const half = w / 2;
    fillSpans(
      doc,
      rect.r0 + 1,
      rect.r1 - 1,
      (r) => {
        const t = (r - rect.r0) / (rect.r1 - rect.r0);
        const left = centerC - half * t + 1;
        const right = centerC + half * t - 1;
        return left <= right ? [Math.ceil(left), Math.floor(right)] : null;
      },
      options.fill,
      options.fillChar ?? "",
    );
  }
  return rect;
}

/** Paint a simple cell block (used by templates and paste previews). */
export function paintTextBlock(doc: DrawingDocument, r: number, c: number, text: string): void {
  doc.pasteTextAt(r, c, text, true);
}
