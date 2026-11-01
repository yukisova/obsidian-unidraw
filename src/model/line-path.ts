import type { CellPos } from "../core/types";
import type { LineObject } from "../core/objects";

export interface LineObstacle {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Node {
  r: number;
  c: number;
  g: number;
  f: number;
}

function sign(n: number): number {
  return n === 0 ? 0 : n > 0 ? 1 : -1;
}

function routingOf(obj: LineObject): "4way" | "8way" {
  return obj.routing ?? (obj.route === "elbow" ? "4way" : "8way");
}

function bresenham(a: CellPos, b: CellPos): CellPos[] {
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

function cleanEightWayPath(start: CellPos, end: CellPos): CellPos[] {
  const dr = end.row - start.row;
  const dc = end.col - start.col;
  const adr = Math.abs(dr);
  const adc = Math.abs(dc);
  if (adr === 0 || adc === 0 || adr === adc) return bresenham(start, end);
  const sy = sign(dr);
  const sx = sign(dc);
  const path: CellPos[] = [{ ...start }];
  let r = start.row;
  let c = start.col;
  if (adc > adr) {
    const before = Math.floor(adr / 2);
    const after = adr - before;
    for (let i = 0; i < before; i++) path.push({ row: (r += sy), col: (c += sx) });
    const horizontal = adc - adr - 1;
    for (let i = 0; i < horizontal; i++) path.push({ row: r, col: (c += sx) });
    // The final horizontal cell starts the closing diagonal, so it keeps a
    // diagonal glyph instead of creating an adjacent pair of parallel slashes.
    path.push({ row: r, col: (c += sx) });
    for (let i = 0; i < after; i++) path.push({ row: (r += sy), col: (c += sx) });
  } else {
    const before = Math.floor(adc / 2);
    const after = adc - before;
    for (let i = 0; i < before; i++) path.push({ row: (r += sy), col: (c += sx) });
    const vertical = adr - adc - 1;
    for (let i = 0; i < vertical; i++) path.push({ row: (r += sy), col: c });
    path.push({ row: (r += sy), col: c });
    for (let i = 0; i < after; i++) path.push({ row: (r += sy), col: (c += sx) });
  }
  return path;
}

function directPath(obj: LineObject, start: CellPos, end: CellPos): CellPos[] {
  const dr = end.row - start.row;
  const dc = end.col - start.col;
  if (dr === 0 || dc === 0) {
    return bresenham(start, end);
  }
  if (routingOf(obj) === "8way") return cleanEightWayPath(start, end);
  return cleanFourWayPath(start, end);
}

function cleanFourWayPath(start: CellPos, end: CellPos): CellPos[] {
  const dr = end.row - start.row;
  const dc = end.col - start.col;
  const adr = Math.abs(dr);
  const adc = Math.abs(dc);
  if (adr === 0 || adc === 0) return bresenham(start, end);
  const sy = sign(dr);
  const sx = sign(dc);
  const path: CellPos[] = [{ ...start }];
  let r = start.row;
  let c = start.col;
  if (adc >= adr) {
    const before = Math.floor(adc / 2);
    const after = adc - before;
    for (let i = 0; i < before; i++) path.push({ row: r, col: (c += sx) });
    for (let i = 0; i < adr; i++) path.push({ row: (r += sy), col: c });
    for (let i = 0; i < after; i++) path.push({ row: r, col: (c += sx) });
  } else {
    const before = Math.floor(adr / 2);
    const after = adr - before;
    for (let i = 0; i < before; i++) path.push({ row: (r += sy), col: c });
    for (let i = 0; i < adc; i++) path.push({ row: r, col: (c += sx) });
    for (let i = 0; i < after; i++) path.push({ row: (r += sy), col: c });
  }
  return path;
}

function heuristic(r: number, c: number, goal: CellPos, diagonal: boolean): number {
  const dr = Math.abs(goal.row - r);
  const dc = Math.abs(goal.col - c);
  return diagonal ? Math.max(dr, dc) + (Math.SQRT2 - 1) * Math.min(dr, dc) : dr + dc;
}

function search(
  obj: LineObject,
  start: CellPos,
  end: CellPos,
  obstacles: LineObstacle[],
): CellPos[] {
  if (obstacles.length === 0) return directPath(obj, start, end);
  const diagonal = routingOf(obj) === "8way";
  let minR = Math.min(start.row, end.row);
  let maxR = Math.max(start.row, end.row);
  let minC = Math.min(start.col, end.col);
  let maxC = Math.max(start.col, end.col);
  for (const box of obstacles) {
    minR = Math.min(minR, box.y);
    maxR = Math.max(maxR, box.y + box.h - 1);
    minC = Math.min(minC, box.x);
    maxC = Math.max(maxC, box.x + box.w - 1);
  }
  const pad = 6;
  minR = Math.max(0, minR - pad);
  minC = Math.max(0, minC - pad);
  maxR += pad;
  maxC += pad;
  if (maxR < minR || maxC < minC) return directPath(obj, start, end);
  const blocked = new Set<number>();
  const stride = maxC - minC + 1;
  const keyOf = (r: number, c: number): number => (r - minR) * stride + (c - minC);
  const inBounds = (r: number, c: number): boolean => r >= minR && r <= maxR && c >= minC && c <= maxC;
  for (const box of obstacles) {
    for (let r = Math.max(minR, box.y); r <= Math.min(maxR, box.y + box.h - 1); r++) {
      for (let c = Math.max(minC, box.x); c <= Math.min(maxC, box.x + box.w - 1); c++) {
        if ((r === start.row && c === start.col) || (r === end.row && c === end.col)) continue;
        blocked.add(keyOf(r, c));
      }
    }
  }
  const open: Node[] = [{ r: start.row, c: start.col, g: 0, f: heuristic(start.row, start.col, end, diagonal) }];
  const best = new Map<number, number>();
  const parent = new Map<number, number>();
  best.set(keyOf(start.row, start.col), 0);
  const closed = new Set<number>();
  const dirs: Array<[number, number, number]> = diagonal
    ? [
        [-1, 0, 1], [0, 1, 1], [1, 0, 1], [0, -1, 1],
        [-1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [1, 1, Math.SQRT2],
      ]
    : [[-1, 0, 1], [0, 1, 1], [1, 0, 1], [0, -1, 1]];
  let found = false;
  while (open.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIndex].f) bestIndex = i;
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = keyOf(current.r, current.c);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    if (current.r === end.row && current.c === end.col) {
      found = true;
      break;
    }
    for (const [dr, dc, cost] of dirs) {
      const nr = current.r + dr;
      const nc = current.c + dc;
      if (!inBounds(nr, nc)) continue;
      const key = keyOf(nr, nc);
      if (blocked.has(key) || closed.has(key)) continue;
      if (dr !== 0 && dc !== 0) {
        if (blocked.has(keyOf(current.r + dr, current.c)) || blocked.has(keyOf(current.r, current.c + dc))) continue;
      }
      const tentative = current.g + cost;
      if (tentative >= (best.get(key) ?? Infinity)) continue;
      best.set(key, tentative);
      parent.set(key, currentKey);
      open.push({ r: nr, c: nc, g: tentative, f: tentative + heuristic(nr, nc, end, diagonal) });
    }
  }
  if (!found) return directPath(obj, start, end);
  const path: CellPos[] = [];
  let currentKey = keyOf(end.row, end.col);
  for (;;) {
    const r = Math.floor(currentKey / stride) + minR;
    const c = (currentKey % stride) + minC;
    path.push({ row: r, col: c });
    if (r === start.row && c === start.col) break;
    const previous = parent.get(currentKey);
    if (previous === undefined) return directPath(obj, start, end);
    currentKey = previous;
  }
  path.reverse();
  return path;
}

export function computeLinePath(obj: LineObject, obstacles: LineObstacle[]): CellPos[] {
  const start = { row: obj.y1, col: obj.x1 };
  const end = { row: obj.y2, col: obj.x2 };
  if (start.row === end.row && start.col === end.col) return [start];
  const mode = obj.ignoreShapes ?? "all";
  const active = mode === "all"
    ? []
    : mode === "exceptTargets"
      ? obstacles.filter((box) => box.id === obj.startTargetId || box.id === obj.endTargetId)
      : obstacles;
  return search(obj, start, end, active);
}
