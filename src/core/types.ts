/**
 * Shared types used by the editor, renderer and Obsidian integration.
 */

export type ToolId =
  | "select"
  | "hand"
  | "pencil"
  | "line"
  | "rect"
  | "solidRect"
  | "fill"
  | "circle"
  | "diamond";

export type StrokeStyle = "light" | "heavy" | "double" | "rounded" | "dashed" | "ascii";

export type LineRoute = "straight" | "diagonal" | "elbow";

export type ArrowStyle = "none" | "line" | "hollow" | "solid";

export type TextDirection = "horizontal" | "vertical";

export type TextAlignH = "left" | "center" | "right";

export type TextAlignV = "top" | "middle" | "bottom";

export type TextWrapMode = "down" | "up" | "right" | "left";

export type GridMode = "dots" | "lines" | "none";

export type FillMode =
  | "none"
  | "light"
  | "medium"
  | "dark"
  | "solid"
  | "dots"
  | "checker"
  | "hatch"
  | "custom";

export type TextTransform =
  | "normal"
  | "fullwidth"
  | "bold"
  | "italic"
  | "boldItalic"
  | "script"
  | "boldScript"
  | "fraktur"
  | "doubleStruck"
  | "sansSerif"
  | "sansBold"
  | "monospace"
  | "circled"
  | "squared"
  | "smallCaps";

export type SaveState = "saved" | "saving" | "unsaved" | "error";

export interface CellPos {
  row: number;
  col: number;
}

/** Inclusive, normalised rectangle of cells. */
export interface SelectionRect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export interface StrokeSettings {
  style: StrokeStyle;
  route: LineRoute;
  arrowStart: boolean;
  arrowEnd: boolean;
}

export interface FillSettings {
  mode: FillMode;
  customChar: string;
}

export interface EditorSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  grid: GridMode;
  defaultStroke: StrokeStyle;
  showStatusBar: boolean;
  textTransform: TextTransform;
  drawChar: string;
  fillChar: string;
  shapeFill: FillMode;
  brushSize: number;
}

export const FONT_STACKS: Record<string, string> = {
  obsidian: "",
  menlo: 'Menlo, Monaco, "Courier New", monospace',
  sfmono: '"SF Mono", Menlo, Monaco, monospace',
  jetbrains: '"JetBrains Mono", Menlo, monospace',
  cascadia: '"Cascadia Code", "Cascadia Mono", Menlo, monospace',
  fira: '"Fira Code", Menlo, monospace',
  ibmplex: '"IBM Plex Mono", monospace',
  courier: '"Courier New", Courier, monospace',
};

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontFamily: "obsidian",
  fontSize: 12,
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
