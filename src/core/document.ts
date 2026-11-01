import {
  displayWidth,
  firstGrapheme,
  graphemeWidth,
  graphemes,
  normalizeText,
} from "./unicode";
import type { SelectionRect } from "./types";

export const BLANK = " ";
/** Internal marker for the second column of a wide grapheme. Never serialised. */
export const WIDE_CONT = "\u0000";
export const MAX_COLS = 600;
export const MAX_ROWS = 400;

export interface DocumentSnapshot {
  cols: number;
  rows: number;
  cells: string[][];
}

export interface GlyphInfo {
  char: string;
  width: number;
  headCol: number;
  continuation: boolean;
}

export interface ContentBounds {
  cols: number;
  rows: number;
}

export interface PasteResult {
  rows: number;
  cols: number;
  r1: number;
  c1: number;
}

function isBlankGlyph(ch: string): boolean {
  return ch === BLANK || ch === "\u3000" || ch === "";
}

function makeRow(cols: number): string[] {
  return new Array<string>(cols).fill(BLANK);
}

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

/**
 * A fixed-size, grapheme-aware character grid.
 *
 * Each cell contains either one grapheme cluster, a blank space, or the
 * WIDE_CONT marker for the second column of a wide glyph. Wide glyphs always
 * stay together; editing one column clears the whole cluster.
 */
export class DrawingDocument {
  cols: number;
  rows: number;
  private cells: string[][];

  constructor(cols = 1, rows = 0, cells?: string[][]) {
    this.cols = Math.max(0, cols);
    this.rows = Math.max(0, rows);
    if (cells) {
      this.cells = cells.map((row) => row.slice(0, this.cols));
      while (this.cells.length < this.rows) this.cells.push(makeRow(this.cols));
      this.cells.length = this.rows;
      for (const row of this.cells) {
        while (row.length < this.cols) row.push(BLANK);
        row.length = this.cols;
      }
    } else {
      this.cells = Array.from({ length: this.rows }, () => makeRow(this.cols));
    }
  }

  static fromText(text: string): DrawingDocument {
    const clean = normalizeText(text ?? "");
    if (!clean) return new DrawingDocument(0, 0);
    let lines = clean.split("\n");
    // A final newline is a file terminator, not an extra blank art row.
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    lines = lines.map((line) => line.replace(/ +$/u, ""));
    const cols = lines.reduce((max, line) => Math.max(max, displayWidth(line)), 0);
    const doc = new DrawingDocument(cols, lines.length);
    for (let r = 0; r < lines.length; r++) {
      let c = 0;
      for (const part of graphemes(lines[r])) {
        if (part === "\n" || part === "\r") continue;
        const width = Math.max(1, graphemeWidth(part));
        if (c + width > cols) break;
        if (width === 2) {
          doc.cells[r][c] = part;
          doc.cells[r][c + 1] = WIDE_CONT;
        } else {
          doc.cells[r][c] = part;
        }
        c += width;
      }
    }
    return doc;
  }

  static fromSnapshot(snapshot: DocumentSnapshot): DrawingDocument {
    return new DrawingDocument(snapshot.cols, snapshot.rows, snapshot.cells);
  }

  clone(): DrawingDocument {
    return new DrawingDocument(this.cols, this.rows, this.cells);
  }

  snapshot(): DocumentSnapshot {
    return { cols: this.cols, rows: this.rows, cells: this.cells.map((row) => row.slice()) };
  }

  restore(snapshot: DocumentSnapshot): void {
    this.cols = snapshot.cols;
    this.rows = snapshot.rows;
    this.cells = snapshot.cells.map((row) => row.slice());
  }

  /** Grow the canvas (never shrinks). */
  ensureSize(cols: number, rows: number): boolean {
    const nextCols = Math.min(MAX_COLS, Math.max(this.cols, cols));
    const nextRows = Math.min(MAX_ROWS, Math.max(this.rows, rows));
    if (nextCols === this.cols && nextRows === this.rows) return false;
    if (nextCols > this.cols) {
      for (const row of this.cells) {
        while (row.length < nextCols) row.push(BLANK);
      }
    }
    while (this.cells.length < nextRows) this.cells.push(makeRow(nextCols));
    this.cols = nextCols;
    this.rows = nextRows;
    return true;
  }

  resize(cols: number, rows: number): void {
    const nextCols = clamp(Math.floor(cols), 0, MAX_COLS);
    const nextRows = clamp(Math.floor(rows), 0, MAX_ROWS);
    const next: string[][] = [];
    for (let r = 0; r < nextRows; r++) {
      const row = this.cells[r]?.slice(0, nextCols) ?? makeRow(nextCols);
      while (row.length < nextCols) row.push(BLANK);
      // A wide glyph clipped by the new right edge becomes a blank.
      if (nextCols > 0 && row[nextCols - 1] === WIDE_CONT) {
        row[nextCols - 1] = BLANK;
        if (nextCols >= 2) row[nextCols - 2] = BLANK;
      }
      next.push(row);
    }
    this.cols = nextCols;
    this.rows = nextRows;
    this.cells = next;
  }

  inBounds(r: number, c: number): boolean {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  raw(r: number, c: number): string {
    if (!this.inBounds(r, c)) return BLANK;
    return this.cells[r][c] ?? BLANK;
  }

  /**
   * Read-only access to a row for the renderer. Do not mutate the returned
   * array; write through the document methods instead.
   */
  rawRow(r: number): string[] | null {
    if (r < 0 || r >= this.rows) return null;
    return this.cells[r] ?? null;
  }

  /** Visible character at a cell, resolving continuation cells to their head. */
  charAt(r: number, c: number): string {
    if (!this.inBounds(r, c)) return BLANK;
    const raw = this.cells[r][c];
    if (raw === WIDE_CONT) {
      const head = this.cells[r][c - 1];
      return head && head !== WIDE_CONT ? head : BLANK;
    }
    return raw ?? BLANK;
  }

  glyphAt(r: number, c: number): GlyphInfo | null {
    if (!this.inBounds(r, c)) return null;
    const raw = this.cells[r][c];
    if (raw === WIDE_CONT) {
      const headCol = c - 1;
      const head = headCol >= 0 ? this.cells[r][headCol] : BLANK;
      if (head && head !== WIDE_CONT && head !== BLANK) {
        return { char: head, width: 2, headCol, continuation: true };
      }
      return { char: BLANK, width: 1, headCol: c, continuation: false };
    }
    if (!raw || raw === BLANK) {
      return { char: BLANK, width: 1, headCol: c, continuation: false };
    }
    const width = Math.max(1, graphemeWidth(raw));
    return {
      char: raw,
      width: width === 2 && this.cells[r][c + 1] === WIDE_CONT ? 2 : 1,
      headCol: c,
      continuation: false,
    };
  }

  private clearClusterAt(r: number, c: number): void {
    if (!this.inBounds(r, c)) return;
    const row = this.cells[r];
    const raw = row[c];
    if (raw === WIDE_CONT) {
      row[c] = BLANK;
      if (c - 1 >= 0) row[c - 1] = BLANK;
      return;
    }
    if (raw && raw !== BLANK) {
      const width = graphemeWidth(raw);
      row[c] = BLANK;
      if (width === 2 && c + 1 < this.cols && row[c + 1] === WIDE_CONT) {
        row[c + 1] = BLANK;
      }
    }
  }

  /**
   * Write a grapheme. Wide glyphs occupy two cells. If the glyph does not fit
   * and `grow` is false, nothing is written.
   */
  setGlyph(r: number, c: number, glyph: string, grow = false): boolean {
    if (r < 0 || c < 0 || r >= MAX_ROWS) return false;
    const graph = firstGrapheme(glyph);
    const ch = !graph || graph === "\n" || graph === "\r" || graph === "\t" ? BLANK : graph;
    const width = ch === BLANK ? 1 : Math.min(2, Math.max(1, graphemeWidth(ch)));
    if (c >= this.cols || r >= this.rows) {
      if (!grow) return false;
      this.ensureSize(Math.min(MAX_COLS, Math.max(this.cols, c + width + 1)), Math.max(this.rows, r + 1));
      if (c >= this.cols) return false;
    }
    if (width === 2 && c + 1 >= this.cols) {
      if (!grow) return false;
      this.ensureSize(Math.min(MAX_COLS, c + width + 1), this.rows);
      if (c + 1 >= this.cols) return false;
    }
    // Remove any existing wide cluster touched by this write.
    this.clearClusterAt(r, c);
    if (width === 2) this.clearClusterAt(r, c + 1);
    const row = this.cells[r];
    row[c] = ch;
    if (width === 2) row[c + 1] = WIDE_CONT;
    return true;
  }

  /** Fast path for the overwhelmingly common single-column glyph. */
  setChar(r: number, c: number, ch: string, grow = false): boolean {
    return this.setGlyph(r, c, ch, grow);
  }

  erase(r: number, c: number): void {
    if (!this.inBounds(r, c)) return;
    this.clearClusterAt(r, c);
    this.cells[r][c] = BLANK;
  }

  clearRegion(rect: SelectionRect): void {
    for (let r = rect.r0; r <= rect.r1; r++) {
      for (let c = rect.c0; c <= rect.c1; c++) this.erase(r, c);
    }
  }

  /** True if the row has any visible glyph. */
  private rowHasContent(r: number): boolean {
    const row = this.cells[r];
    for (let c = 0; c < this.cols; c++) {
      const raw = row[c];
      if (!raw || raw === BLANK || raw === WIDE_CONT || isBlankGlyph(raw)) continue;
      return true;
    }
    return false;
  }

  private lineWidthDisplay(r: number): number {
    const row = this.cells[r];
    let last = 0;
    for (let c = 0; c < this.cols; c++) {
      const raw = row[c];
      if (!raw || raw === BLANK || raw === WIDE_CONT || isBlankGlyph(raw)) continue;
      const width = raw === WIDE_CONT ? 1 : Math.max(1, graphemeWidth(raw));
      last = Math.max(last, c + width);
    }
    return last;
  }

  contentBounds(): ContentBounds {
    let rows = 0;
    let cols = 0;
    for (let r = 0; r < this.rows; r++) {
      if (this.rowHasContent(r)) rows = r + 1;
      cols = Math.max(cols, this.lineWidthDisplay(r));
    }
    if (rows === 0) return { cols: 0, rows: 0 };
    return { cols, rows };
  }

  /** Tight bounding box around visible glyphs, including leading margins. */
  tightContentBounds(): SelectionRect | null {
    let r0 = Number.POSITIVE_INFINITY;
    let r1 = -1;
    let c0 = Number.POSITIVE_INFINITY;
    let c1 = -1;
    for (let r = 0; r < this.rows; r++) {
      const row = this.cells[r];
      for (let c = 0; c < this.cols; c++) {
        const raw = row[c];
        if (!raw || raw === BLANK || raw === WIDE_CONT || isBlankGlyph(raw)) continue;
        r0 = Math.min(r0, r);
        r1 = Math.max(r1, r);
        c0 = Math.min(c0, c);
        const width = Math.max(1, graphemeWidth(raw));
        c1 = Math.max(c1, c + width - 1);
      }
    }
    if (r1 < 0 || c1 < 0) return null;
    return { r0, r1, c0, c1 };
  }

  isEmpty(): boolean {
    const bounds = this.contentBounds();
    return bounds.rows === 0 || bounds.cols === 0;
  }

  /** Serialise to visible text lines. Continuation markers are omitted. */
  toLines(trimEnd = false): string[] {
    const out: string[] = [];
    for (let r = 0; r < this.rows; r++) {
      let line = "";
      for (let c = 0; c < this.cols; c++) {
        const raw = this.cells[r][c];
        if (raw === WIDE_CONT) continue;
        line += raw || BLANK;
      }
      out.push(trimEnd ? line.replace(/[ \u3000]+$/u, "") : line);
    }
    return out;
  }

  /**
   * Text of the drawing. Trailing spaces and trailing blank rows are removed
   * so saved files stay compact and diff-friendly.
   */
  toText(options: { trimEnd?: boolean; keepTrailingBlankRows?: boolean } = {}): string {
    const trimEnd = options.trimEnd ?? true;
    const lines = this.toLines(trimEnd);
    if (!options.keepTrailingBlankRows) {
      while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    }
    return lines.join("\n");
  }

  /** Text for copy/export, with no trailing blank rows. */
  trimmedText(): string {
    return this.toText({ trimEnd: true });
  }

  /** Extract a rectangular region as pasteable text. */
  extractRegion(rect: SelectionRect): string[] {
    const out: string[] = [];
    for (let r = rect.r0; r <= rect.r1; r++) {
      if (r < 0 || r >= this.rows) {
        out.push(" ".repeat(Math.max(0, rect.c1 - rect.c0 + 1)));
        continue;
      }
      let line = "";
      for (let c = rect.c0; c <= rect.c1; c++) {
        if (c < 0 || c >= this.cols) {
          line += BLANK;
          continue;
        }
        const raw = this.cells[r][c];
        if (raw === WIDE_CONT) {
          const head = c - 1 >= 0 ? this.cells[r][c - 1] : BLANK;
          if (c - 1 < rect.c0) {
            // Cut through a wide glyph; do not emit an orphan continuation.
            line += BLANK;
          } else if (head && head !== WIDE_CONT && head !== BLANK) {
            // Already emitted with its head; nothing to add.
          }
          continue;
        }
        const width = raw && raw !== BLANK ? Math.max(1, graphemeWidth(raw)) : 1;
        if (width === 2 && c + 1 > rect.c1) {
          line += BLANK;
          c += 0;
          continue;
        }
        line += raw || BLANK;
        if (width === 2) {
          // The continuation cell will be skipped by the loop naturally.
        }
      }
      out.push(line);
    }
    return out;
  }

  /**
   * Paste text at a cell. Returns the affected rectangle and grows the canvas
   * as needed. Wide glyphs are handled by setGlyph.
   */
  pasteTextAt(r0: number, c0: number, text: string, grow = true): PasteResult {
    const clean = normalizeText(text ?? "");
    let lines = clean.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    let maxWidth = 0;
    for (const line of lines) maxWidth = Math.max(maxWidth, displayWidth(line));
    if (grow) {
      this.ensureSize(
        Math.min(MAX_COLS, Math.max(this.cols, c0 + maxWidth + 1)),
        Math.min(MAX_ROWS, Math.max(this.rows, r0 + lines.length + 1)),
      );
    }
    let r1 = r0;
    let c1 = c0;
    for (let i = 0; i < lines.length; i++) {
      const r = r0 + i;
      if (r < 0 || r >= this.rows) continue;
      let c = c0;
      for (const part of graphemes(lines[i])) {
        if (part === "\r" || part === "\n") continue;
        const width = Math.max(1, graphemeWidth(part));
        if (c >= this.cols) break;
        this.setGlyph(r, c, part, grow);
        c1 = Math.max(c1, c + width - 1);
        c += width;
      }
      r1 = Math.max(r1, r);
    }
    return { rows: lines.length, cols: maxWidth, r1, c1 };
  }

  /** Copy a region into a new document, used for transforms. */
  copyRegion(rect: SelectionRect): DrawingDocument {
    const w = Math.max(0, rect.c1 - rect.c0 + 1);
    const h = Math.max(0, rect.r1 - rect.r0 + 1);
    const doc = new DrawingDocument(w, h);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const glyph = this.glyphAt(rect.r0 + r, rect.c0 + c);
        if (!glyph || glyph.char === BLANK) continue;
        if (glyph.continuation) continue;
        doc.setGlyph(r, c, glyph.char);
      }
    }
    return doc;
  }
}
