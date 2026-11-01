import type { DrawingDocument } from "../core/document";
import type { StrokeStyle } from "../core/types";

/** Direction bits for the box-drawing glyph tables. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export interface GlyphStrokeInfo {
  mask: number;
  style: StrokeStyle;
}

/**
 * Unicode box-drawing glyphs indexed by connection mask.
 * index = N(1) | E(2) | S(4) | W(8)
 */
const LIGHT: string[] = [
  " ", "╵", "╶", "└", "╷", "│", "┌", "├", "╴", "┘", "─", "┴", "┐", "┤", "┬", "┼",
];
const HEAVY: string[] = [
  " ", "╹", "╺", "┗", "╻", "┃", "┏", "┣", "╸", "┛", "━", "┻", "┓", "┫", "┳", "╋",
];
const DOUBLE: string[] = [
  " ", "╵", "╶", "╚", "╷", "║", "╔", "╠", "╴", "╝", "═", "╩", "╗", "╣", "╦", "╬",
];
const ROUNDED: string[] = LIGHT.slice();
ROUNDED[N | E] = "╰";
ROUNDED[E | S] = "╭";
ROUNDED[N | W] = "╯";
ROUNDED[S | W] = "╮";
const DASHED: string[] = LIGHT.slice();
DASHED[N | S] = "┆";
DASHED[E | W] = "┄";
const DASH2: string[] = LIGHT.slice();
DASH2[N | S] = "╎";
DASH2[E | W] = "╌";
const DASH4: string[] = LIGHT.slice();
DASH4[N | S] = "┊";
DASH4[E | W] = "┈";
const HEAVY_DASH2: string[] = HEAVY.slice();
HEAVY_DASH2[N | S] = "╏";
HEAVY_DASH2[E | W] = "╍";
const HEAVY_DASH3: string[] = HEAVY.slice();
HEAVY_DASH3[N | S] = "┇";
HEAVY_DASH3[E | W] = "┅";
const HEAVY_DASH4: string[] = HEAVY.slice();
HEAVY_DASH4[N | S] = "┋";
HEAVY_DASH4[E | W] = "┉";
const ASCII: string[] = [
  " ", "|", "-", "+", "|", "|", "+", "+", "-", "+", "-", "+", "+", "+", "+", "+",
];

const TABLES: Record<StrokeStyle, string[]> = {
  light: LIGHT,
  heavy: HEAVY,
  double: DOUBLE,
  rounded: ROUNDED,
  dashed: DASHED,
  dash2: DASH2,
  dash4: DASH4,
  heavyDash2: HEAVY_DASH2,
  heavyDash3: HEAVY_DASH3,
  heavyDash4: HEAVY_DASH4,
  ascii: ASCII,
};

/** Which indices contain glyphs unique to that style (used for reverse lookup). */
const UNIQUE_MASKS: Record<StrokeStyle, number[]> = {
  light: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  heavy: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  double: [3, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15],
  rounded: [N | E, E | S, N | W, S | W],
  dashed: [N | S, E | W],
  dash2: [N | S, E | W],
  dash4: [N | S, E | W],
  heavyDash2: [N | S, E | W],
  heavyDash3: [N | S, E | W],
  heavyDash4: [N | S, E | W],
  ascii: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
};

const REVERSE = new Map<string, GlyphStrokeInfo>();

function register(style: StrokeStyle): void {
  const table = TABLES[style];
  for (const mask of UNIQUE_MASKS[style]) {
    const ch = table[mask];
    if (!ch || ch === " ") continue;
    if (!REVERSE.has(ch)) REVERSE.set(ch, { mask, style });
  }
}

// Rounded and dashed first: their corners/lines are the most specific.
register("double");
register("heavy");
register("heavyDash2");
register("heavyDash3");
register("heavyDash4");
register("rounded");
register("dashed");
register("dash2");
register("dash4");
register("ascii");
register("light");

// Additional dashed variants map back to the dashed stroke family.
for (const [ch, mask] of [
  ["╌", E | W],
  ["╎", N | S],
  ["╍", E | W],
  ["╏", N | S],
] as Array<[string, number]>) {
  REVERSE.set(ch, { mask, style: "dashed" });
}
REVERSE.set("+", { mask: N | E | S | W, style: "ascii" });

export function glyphFor(mask: number, style: StrokeStyle): string {
  if (mask <= 0) return " ";
  const table = TABLES[style] ?? LIGHT;
  return table[mask & 15] ?? " ";
}

export function strokeInfo(ch: string): GlyphStrokeInfo | null {
  if (!ch || ch === " ") return null;
  return REVERSE.get(ch) ?? null;
}

export function isLineGlyph(ch: string): boolean {
  return strokeInfo(ch) !== null;
}

export function styleWeight(style: StrokeStyle): number {
  switch (style) {
    case "heavy":
    case "heavyDash2":
    case "heavyDash3":
    case "heavyDash4":
      return 6;
    case "double":
      return 5;
    case "light":
      return 4;
    case "rounded":
      return 3;
    case "dashed":
    case "dash2":
    case "dash4":
      return 2;
    case "ascii":
      return 1;
  }
}

export function mergeStrokeStyle(a: StrokeStyle, b: StrokeStyle): StrokeStyle {
  if (a === b) return a;
  return styleWeight(a) >= styleWeight(b) ? a : b;
}

/**
 * Add a line connection to a cell. Existing box-drawing glyphs are merged so
 * crossings become ┼, tees, corners, double joints, etc.
 */
export function paintMask(
  doc: DrawingDocument,
  r: number,
  c: number,
  mask: number,
  style: StrokeStyle,
): void {
  if (mask <= 0) return;
  if (r < 0 || c < 0) return;
  const existing = doc.glyphAt(r, c);
  if (!existing || !existing.char || existing.char === " ") {
    doc.setGlyph(r, c, glyphFor(mask, style), true);
    return;
  }
  if (existing.continuation) {
    // A line drawn through a wide character replaces that character's column.
    doc.setGlyph(r, c, glyphFor(mask, style), true);
    return;
  }
  const info = strokeInfo(existing.char);
  if (!info) {
    doc.setGlyph(r, c, glyphFor(mask, style), true);
    return;
  }
  const mergedMask = info.mask | mask;
  const mergedStyle = mergeStrokeStyle(info.style, style);
  doc.setGlyph(r, c, glyphFor(mergedMask, mergedStyle), true);
}

export function paintChar(doc: DrawingDocument, r: number, c: number, ch: string): void {
  if (r < 0 || c < 0) return;
  doc.setGlyph(r, c, ch, true);
}

export function directionMask(dr: number, dc: number): number {
  let mask = 0;
  if (dr < 0) mask |= N;
  if (dr > 0) mask |= S;
  if (dc > 0) mask |= E;
  if (dc < 0) mask |= W;
  return mask;
}

export function horizontalGlyph(style: StrokeStyle): string {
  return glyphFor(E | W, style);
}

export function verticalGlyph(style: StrokeStyle): string {
  return glyphFor(N | S, style);
}

/** Diagonal line glyph. Rows grow downwards, so signs matching means `╲`. */
export function diagonalGlyph(dr: number, dc: number, style: StrokeStyle): string {
  if (style === "ascii") return dr * dc > 0 ? "\\" : "/";
  return dr * dc > 0 ? "╲" : "╱";
}

export function arrowGlyph(dr: number, dc: number): string {
  if (dr === 0) return dc >= 0 ? "→" : "←";
  if (dc === 0) return dr > 0 ? "↓" : "↑";
  if (dr > 0) return dc > 0 ? "↘" : "↙";
  return dc > 0 ? "↗" : "↖";
}

export function reverseDirection(dr: number, dc: number): [number, number] {
  return [-dr, -dc];
}

/** Samples used by the UI stroke-style segmented control. */
export const STROKE_SAMPLES: Array<{ style: StrokeStyle; glyph: string }> = [
  { style: "light", glyph: "─" },
  { style: "heavy", glyph: "━" },
  { style: "double", glyph: "═" },
  { style: "rounded", glyph: "╭" },
  { style: "dashed", glyph: "┄" },
  { style: "ascii", glyph: "+" },
];
