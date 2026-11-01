import type { StrokeStyle } from "../core/types";
import { strokeInfo } from "../glyphs/box";

export interface VectorGlyphOptions {
  color: string;
  fontSize: number;
}

const BOX_START = 0x2500;
const BOX_END = 0x257f;
const BLOCK_START = 0x2580;
const BLOCK_END = 0x259f;
const BRAILLE_START = 0x2800;
const BRAILLE_END = 0x28ff;

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

interface CellBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  right: number;
  bottom: number;
}

function makeBox(x: number, y: number, w: number, h: number): CellBox {
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, right: x + w, bottom: y + h };
}

function lineWidths(fontSize: number): { light: number; heavy: number; double: number; gap: number } {
  return {
    light: clamp(fontSize * 0.075, 0.85, fontSize * 0.15),
    heavy: clamp(fontSize * 0.145, 1.4, fontSize * 0.24),
    double: clamp(fontSize * 0.052, 0.75, fontSize * 0.12),
    gap: clamp(fontSize * 0.088, 1.1, fontSize * 0.16),
  };
}

function strokeArms(
  ctx: CanvasRenderingContext2D,
  box: CellBox,
  mask: number,
  offsetX: number,
  offsetY: number,
  overshoot: number,
): void {
  const cx = box.cx + offsetX;
  const cy = box.cy + offsetY;
  ctx.beginPath();
  if (mask & 1) {
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, box.y - overshoot);
  }
  if (mask & 2) {
    ctx.moveTo(cx, cy);
    ctx.lineTo(box.right + overshoot, cy);
  }
  if (mask & 4) {
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, box.bottom + overshoot);
  }
  if (mask & 8) {
    ctx.moveTo(cx, cy);
    ctx.lineTo(box.x - overshoot, cy);
  }
  ctx.stroke();
}

function drawRoundedCorner(
  ctx: CanvasRenderingContext2D,
  box: CellBox,
  mask: number,
  overshoot: number,
): void {
  const radius = Math.min(box.w, box.h) * 0.24;
  const { cx, cy } = box;
  // For a corner, the two arms are joined with a quarter arc near the cell centre.
  if (mask === (1 | 2)) {
    // up + right
    ctx.beginPath();
    ctx.moveTo(cx, box.y - overshoot);
    ctx.lineTo(cx, cy - radius);
    ctx.quadraticCurveTo(cx, cy, cx + radius, cy);
    ctx.lineTo(box.right + overshoot, cy);
    ctx.stroke();
  } else if (mask === (1 | 8)) {
    // up + left
    ctx.beginPath();
    ctx.moveTo(cx, box.y - overshoot);
    ctx.lineTo(cx, cy - radius);
    ctx.quadraticCurveTo(cx, cy, cx - radius, cy);
    ctx.lineTo(box.x - overshoot, cy);
    ctx.stroke();
  } else if (mask === (4 | 2)) {
    // down + right
    ctx.beginPath();
    ctx.moveTo(cx, box.bottom + overshoot);
    ctx.lineTo(cx, cy + radius);
    ctx.quadraticCurveTo(cx, cy, cx + radius, cy);
    ctx.lineTo(box.right + overshoot, cy);
    ctx.stroke();
  } else if (mask === (4 | 8)) {
    // down + left
    ctx.beginPath();
    ctx.moveTo(cx, box.bottom + overshoot);
    ctx.lineTo(cx, cy + radius);
    ctx.quadraticCurveTo(cx, cy, cx - radius, cy);
    ctx.lineTo(box.x - overshoot, cy);
    ctx.stroke();
  } else {
    strokeArms(ctx, box, mask, 0, 0, overshoot);
  }
}

function drawBoxGlyph(
  ctx: CanvasRenderingContext2D,
  box: CellBox,
  mask: number,
  style: StrokeStyle,
  fontSize: number,
): void {
  const width = lineWidths(fontSize);
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";
  ctx.setLineDash([]);
  const overshoot = 0.62;

  if (style === "double") {
    ctx.lineWidth = width.double;
    ctx.lineCap = "round";
    const gap = width.gap;
    strokeArms(ctx, box, mask, -gap, -gap, overshoot + gap);
    strokeArms(ctx, box, mask, gap, gap, overshoot + gap);
  } else if (style === "rounded") {
    ctx.lineWidth = width.light;
    ctx.lineCap = "butt";
    drawRoundedCorner(ctx, box, mask, overshoot);
  } else if (style === "heavy") {
    ctx.lineWidth = width.heavy;
    ctx.lineCap = "square";
    strokeArms(ctx, box, mask, 0, 0, overshoot);
  } else if (style === "dashed") {
    ctx.lineWidth = Math.max(1, width.light * 0.9);
    ctx.lineCap = "butt";
    ctx.setLineDash([width.light * 3.4, width.light * 2.1]);
    strokeArms(ctx, box, mask, 0, 0, overshoot);
  } else {
    ctx.lineWidth = width.light;
    ctx.lineCap = "square";
    strokeArms(ctx, box, mask, 0, 0, overshoot);
  }
  ctx.restore();
}

function drawDiagonals(
  ctx: CanvasRenderingContext2D,
  box: CellBox,
  cp: number,
  fontSize: number,
): void {
  const width = lineWidths(fontSize);
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = width.light;
  ctx.lineCap = "butt";
  ctx.setLineDash([]);
  const overshoot = 0.62;
  if (cp === 0x2571) {
    ctx.beginPath();
    ctx.moveTo(box.x - overshoot, box.bottom + overshoot);
    ctx.lineTo(box.right + overshoot, box.y - overshoot);
    ctx.stroke();
  } else if (cp === 0x2572) {
    ctx.beginPath();
    ctx.moveTo(box.x - overshoot, box.y - overshoot);
    ctx.lineTo(box.right + overshoot, box.bottom + overshoot);
    ctx.stroke();
  } else if (cp === 0x2573) {
    ctx.beginPath();
    ctx.moveTo(box.x - overshoot, box.bottom + overshoot);
    ctx.lineTo(box.right + overshoot, box.y - overshoot);
    ctx.moveTo(box.x - overshoot, box.y - overshoot);
    ctx.lineTo(box.right + overshoot, box.bottom + overshoot);
    ctx.stroke();
  }
  ctx.restore();
}

function fillCell(ctx: CanvasRenderingContext2D, box: CellBox, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = ctx.fillStyle;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}

function drawBlockGlyph(ctx: CanvasRenderingContext2D, box: CellBox, cp: number): boolean {
  const { x, y, w, h, right, bottom } = box;
  switch (cp) {
    case 0x2580: // upper half block
      fillCell(ctx, { ...box, h: h / 2 });
      return true;
    case 0x2581:
    case 0x2582:
    case 0x2583:
    case 0x2584:
    case 0x2585:
    case 0x2586:
    case 0x2587:
    case 0x2588: {
      // lower 1/8 ... full block
      const fraction = (cp - 0x2580) / 8;
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(x, bottom - h * fraction, w, h * fraction);
      ctx.restore();
      return true;
    }
    case 0x2589:
    case 0x258a:
    case 0x258b:
    case 0x258c:
    case 0x258d:
    case 0x258e:
    case 0x258f: {
      // left 7/8 ... 1/8
      const fraction = (0x2590 - cp) / 8;
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(x, y, w * fraction, h);
      ctx.restore();
      return true;
    }
    case 0x2590: // right half
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(x + w / 2, y, w / 2, h);
      ctx.restore();
      return true;
    case 0x2591:
      fillCell(ctx, box, 0.2);
      return true;
    case 0x2592:
      fillCell(ctx, box, 0.42);
      return true;
    case 0x2593:
      fillCell(ctx, box, 0.68);
      return true;
    case 0x2594: // upper one eighth
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(x, y, w, h / 8);
      ctx.restore();
      return true;
    case 0x2595: // right one eighth
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(right - w / 8, y, w / 8, h);
      ctx.restore();
      return true;
    case 0x2596: // lower left
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(x, y + h / 2, w / 2, h / 2);
      ctx.restore();
      return true;
    case 0x2597: // lower right
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(x + w / 2, y + h / 2, w / 2, h / 2);
      ctx.restore();
      return true;
    case 0x2598: // upper left
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(x, y, w / 2, h / 2);
      ctx.restore();
      return true;
    case 0x2599: // upper left + upper right + lower left
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(x, y, w, h / 2);
      ctx.fillRect(x, y + h / 2, w / 2, h / 2);
      ctx.restore();
      return true;
    case 0x259a: // upper left + lower right
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(x, y, w / 2, h / 2);
      ctx.fillRect(x + w / 2, y + h / 2, w / 2, h / 2);
      ctx.restore();
      return true;
    case 0x259b: // upper left + upper right + lower left
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(x, y, w, h / 2);
      ctx.fillRect(x, y + h / 2, w / 2, h / 2);
      ctx.restore();
      return true;
    case 0x259c: // upper left + upper right + lower right
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(x, y, w, h / 2);
      ctx.fillRect(x + w / 2, y + h / 2, w / 2, h / 2);
      ctx.restore();
      return true;
    case 0x259d: // upper right
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(x + w / 2, y, w / 2, h / 2);
      ctx.restore();
      return true;
    case 0x259e: // upper right + lower left
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(x + w / 2, y, w / 2, h / 2);
      ctx.fillRect(x, y + h / 2, w / 2, h / 2);
      ctx.restore();
      return true;
    case 0x259f: // upper right + lower left + lower right
      ctx.save();
      ctx.fillStyle = ctx.fillStyle;
      ctx.fillRect(x, y + h / 2, w, h / 2);
      ctx.fillRect(x + w / 2, y, w / 2, h / 2);
      ctx.restore();
      return true;
    default:
      return false;
  }
}

function drawBrailleGlyph(ctx: CanvasRenderingContext2D, box: CellBox, cp: number): boolean {
  const bits = cp - BRAILLE_START;
  if (bits === 0) return true;
  const radius = Math.min(box.w, box.h) * 0.09;
  const colX = [box.x + box.w * 0.33, box.x + box.w * 0.67];
  const rowY = [box.y + box.h * 0.2, box.y + box.h * 0.4, box.y + box.h * 0.6, box.y + box.h * 0.8];
  const positions: Array<[number, number, number]> = [
    [0, 0, 1],
    [0, 1, 2],
    [0, 2, 4],
    [1, 0, 8],
    [1, 1, 16],
    [1, 2, 32],
    [0, 3, 64],
    [1, 3, 128],
  ];
  ctx.save();
  ctx.fillStyle = ctx.fillStyle;
  for (const [col, row, bit] of positions) {
    if (!(bits & bit)) continue;
    ctx.beginPath();
    ctx.arc(colX[col], rowY[row], radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return true;
}

/**
 * Paint one cell using vector geometry for characters where font glyphs have
 * seams or inconsistent weights. Returns false if the character should be
 * drawn with fillText instead.
 */
export function paintGlyphVector(
  ctx: CanvasRenderingContext2D,
  ch: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: VectorGlyphOptions,
): boolean {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return false;
  const box = makeBox(x, y, width, height);

  if (cp >= BOX_START && cp <= BOX_END) {
    if (cp === 0x2571 || cp === 0x2572 || cp === 0x2573) {
      drawDiagonals(ctx, box, cp, options.fontSize);
      return true;
    }
    const info = strokeInfo(ch);
    if (!info || info.mask === 0) return false;
    drawBoxGlyph(ctx, box, info.mask, info.style, options.fontSize);
    return true;
  }

  if (cp >= BLOCK_START && cp <= BLOCK_END) {
    return drawBlockGlyph(ctx, box, cp);
  }
  if (cp >= BRAILLE_START && cp <= BRAILLE_END) {
    return drawBrailleGlyph(ctx, box, cp);
  }
  return false;
}

export function isVectorGlyph(ch: string): boolean {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return false;
  if (cp >= BOX_START && cp <= BOX_END) return true;
  if (cp >= BLOCK_START && cp <= BLOCK_END) return true;
  if (cp >= BRAILLE_START && cp <= BRAILLE_END) return true;
  return false;
}
