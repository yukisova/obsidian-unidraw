import type { DrawingDocument } from "../core/document";
import { WIDE_CONT } from "../core/document";
import type { SelectionRect } from "../core/types";
import { graphemeWidth } from "../core/unicode";
import { paintGlyphVector } from "./glyph-painter";

export interface ImageExportOptions {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  scale?: number;
  padding?: number;
  background?: string | null;
  textColor: string;
  /** Optional region; when omitted the tight content bounds are used. */
  region?: SelectionRect | null;
}

export interface RenderedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

function measureCanvas(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  return ctx;
}

/** Render a drawing to a standalone high-resolution canvas. */
export function renderDrawingImage(
  doc: DrawingDocument,
  options: ImageExportOptions,
): RenderedImage | null {
  let region = options.region ?? doc.tightContentBounds();
  if (!region) return null;
  const scale = Math.max(1, options.scale ?? 2);
  const padding = Math.max(0, options.padding ?? 24) * scale;
  const measure = measureCanvas();
  const fontSize = options.fontSize * scale;
  measure.font = `${fontSize}px ${options.fontFamily}`;
  const cellW = measure.measureText("M").width || fontSize * 0.6;
  const cellH = fontSize * options.lineHeight;
  const cols = region.c1 - region.c0 + 1;
  const rows = region.r1 - region.r0 + 1;
  if (cols <= 0 || rows <= 0) return null;

  const width = Math.max(1, Math.ceil(cols * cellW + padding * 2));
  const height = Math.max(1, Math.ceil(rows * cellH + padding * 2));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, width, height);
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.font = `${fontSize}px ${options.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = options.textColor;

  for (let r = region.r0; r <= region.r1; r++) {
    const row = doc.rawRow(r);
    if (!row) continue;
    const y = padding + (r - region.r0 + 0.5) * cellH;
    for (let c = region.c0; c <= region.c1; c++) {
      const raw = row[c];
      if (!raw || raw === " " || raw === WIDE_CONT) continue;
      const glyphWidth = Math.min(2, Math.max(1, graphemeWidth(raw)));
      const x = padding + (c - region.c0 + glyphWidth / 2) * cellW;
      const rectX = padding + (c - region.c0) * cellW;
      const rectY = y - cellH / 2;
      const vector = paintGlyphVector(ctx, raw, rectX, rectY, glyphWidth * cellW, cellH, {
        color: options.textColor,
        fontSize,
      });
      if (!vector) {
        ctx.fillStyle = options.textColor;
        ctx.fillText(raw, x, y);
      }
    }
  }
  return { canvas, width, height };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png"): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type);
    } catch {
      resolve(null);
    }
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyImageToClipboard(canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    const blob = await canvasToBlob(canvas);
    if (!blob) return false;
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
    return true;
  } catch {
    return false;
  }
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.left = "-9999px";
    area.style.top = "0";
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
