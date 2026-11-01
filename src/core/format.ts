import { DrawingDocument } from "./document";
import { normalizeText } from "./unicode";

export const FILE_EXTENSION = "unidraw";
export const VIEW_TYPE_UNIDRAW = "unidraw-view";
export const DEFAULT_COLS = 100;
export const DEFAULT_ROWS = 36;
export const MIN_CANVAS_COLS = 80;
export const MIN_CANVAS_ROWS = 30;
export const CANVAS_PADDING_COLS = 14;
export const CANVAS_PADDING_ROWS = 8;

/**
 * Strip an optional markdown code fence. This lets people wrap a drawing in
 * ```unidraw ... ``` inside a note and still open/embed it.
 */
export function extractFencedArt(raw: string): string {
  const match = raw.match(/```(?:unidraw|udraw|ascii-art|text-art)[^\n]*\n([\s\S]*?)\n```/i);
  return match ? match[1] : raw;
}

/** Text exactly as it should be written to a .unidraw file. */
export function serializeDrawing(doc: DrawingDocument): string {
  const text = doc.toText({ trimEnd: true });
  return text.length > 0 ? `${text}\n` : "";
}

/** Parse file contents (or a code block) into a document. */
export function parseDrawing(raw: string, options: { fromEmbed?: boolean } = {}): DrawingDocument {
  let text = raw ?? "";
  if (options.fromEmbed) text = extractFencedArt(text);
  text = normalizeText(text);
  const doc = DrawingDocument.fromText(text);
  const padCols = Math.max(MIN_CANVAS_COLS, doc.cols + CANVAS_PADDING_COLS);
  const padRows = Math.max(MIN_CANVAS_ROWS, doc.rows + CANVAS_PADDING_ROWS);
  doc.ensureSize(Math.min(padCols, 600), Math.min(padRows, 400));
  return doc;
}

/** Build the document for a brand-new drawing. */
export function createBlankDrawing(): DrawingDocument {
  const doc = new DrawingDocument(DEFAULT_COLS, DEFAULT_ROWS);
  return doc;
}

/** Reset a document to a canvas wide enough for the loaded art. */
export function fitDocumentCanvas(doc: DrawingDocument, minCols = MIN_CANVAS_COLS, minRows = MIN_CANVAS_ROWS): void {
  const bounds = doc.contentBounds();
  doc.ensureSize(
    Math.min(600, Math.max(minCols, bounds.cols + CANVAS_PADDING_COLS)),
    Math.min(400, Math.max(minRows, bounds.rows + CANVAS_PADDING_ROWS)),
  );
}

/** Extract a human friendly code block body for reading-mode embeds. */
export function drawingToMarkdown(text: string, language = "unidraw"): string {
  return `\`\`\`${language}\n${text.replace(/\n+$/u, "")}\n\`\`\``;
}

/** A filename-friendly drawing name based on the current time. */
export function defaultDrawingName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `Drawing ${stamp}`;
}
