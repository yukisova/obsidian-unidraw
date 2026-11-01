import type { FillMode } from "../core/types";

export interface FillPreset {
  mode: FillMode;
  glyph: string;
}

export const FILL_PRESETS: FillPreset[] = [
  { mode: "none", glyph: " " },
  { mode: "light", glyph: "░" },
  { mode: "medium", glyph: "▒" },
  { mode: "dark", glyph: "▓" },
  { mode: "solid", glyph: "█" },
  { mode: "dots", glyph: "·" },
  { mode: "checker", glyph: "░" },
  { mode: "hatch", glyph: "╱" },
];

/** Return the glyph for a fill mode at a given cell, or " " for empty cells. */
export function fillGlyph(mode: FillMode, r: number, c: number, customChar: string): string {
  switch (mode) {
    case "none":
      return " ";
    case "light":
      return "░";
    case "medium":
      return "▒";
    case "dark":
      return "▓";
    case "solid":
      return "█";
    case "dots":
      return (r + c) % 2 === 0 ? "·" : " ";
    case "checker":
      return (r % 2 === 0) === (c % 2 === 0) ? "░" : " ";
    case "hatch":
      return (r + c) % 3 === 0 ? "╱" : " ";
    case "custom":
      return customChar || " ";
    default:
      return " ";
  }
}

/** A small 3-row sample used in the fill picker cards. */
export function fillPreview(mode: FillMode, customChar: string): string {
  const rows: string[] = [];
  for (let r = 0; r < 3; r++) {
    let line = "";
    for (let c = 0; c < 5; c++) line += fillGlyph(mode, r, c, customChar);
    rows.push(line);
  }
  return rows.join("\n");
}

export function fillLabelKey(mode: FillMode): string {
  return `fill.${mode}`;
}
