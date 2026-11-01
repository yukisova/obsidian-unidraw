import type { DrawingDocument } from "../core/document";
import { WIDE_CONT } from "../core/document";
import type { CellPos, EditorSettings, SelectionRect, ToolId } from "../core/types";
import { FONT_STACKS } from "../core/types";
import { graphemeWidth } from "../core/unicode";
import { paintGlyphVector } from "./glyph-painter";

export interface ThemeColors {
  paper: string;
  paperBorder: string;
  text: string;
  grid: string;
  accent: string;
  accentText: string;
  shadow: string;
  workspace: string;
}

export interface CaretState {
  row: number;
  col: number;
  width: number;
  visible: boolean;
}

export interface RenderViewState {
  doc: DrawingDocument | null;
  /** Union bounds of the current object selection. */
  selection: SelectionRect | null;
  /** A quiet outline used for the non-editable global doodle. */
  softSelection: boolean;
  /** Red text-selection marquee made with the Pan tool and right drag. */
  textSelection: SelectionRect | null;
  /** Red erase preview for right-drag painting tools. */
  previewErase: SelectionRect | null;
  /** Doodles and the global doodle have a selection border but no scale handles. */
  showHandles: boolean;
  /** Bounds of each selected object, in cell coordinates. */
  objectBoxes: SelectionRect[];
  /** Active marquee, in cell coordinates. */
  marquee: SelectionRect | null;
  /** Temporary text box being dragged, in cell coordinates. */
  previewBox: SelectionRect | null;
  hover: CellPos | null;
  caret: CaretState | null;
  measureLabel: string | null;
  measurePoint: { x: number; y: number } | null;
  emptyHint: { title: string; subtitle: string } | null;
  /** Temporary element rendered on the NewElementCanvas. */
  previewDoc: DrawingDocument | null;
  tool: ToolId;
  panning: boolean;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function cssColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed && trimmed !== "rgba(0, 0, 0, 0)" ? trimmed : fallback;
}

export class CanvasRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly interactiveCanvas: HTMLCanvasElement;
  readonly previewCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private interactiveCtx: CanvasRenderingContext2D;
  private previewCtx: CanvasRenderingContext2D;
  private staticDirty = true;
  private overlayDirty = true;
  private previewDirty = true;
  private stage: HTMLElement;
  private settings: EditorSettings;
  private state: RenderViewState;
  private colors: ThemeColors;
  private baseCellW = 9;
  private baseCellH = 18;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private raf = 0;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private mediaQuery: MediaQueryList | null = null;
  private mediaHandler: (() => void) | null = null;
  private probe: HTMLDivElement | null = null;
  private firstLayout = true;
  private userAdjustedView = false;
  zoom = 1;
  panX = 0;
  panY = 0;
  onViewChange: (() => void) | null = null;

  constructor(stage: HTMLElement, settings: EditorSettings, initialState: RenderViewState) {
    this.stage = stage;
    this.settings = settings;
    this.state = initialState;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "unidraw-canvas unidraw-static-canvas";
    this.canvas.tabIndex = 0;
    stage.appendChild(this.canvas);
    this.interactiveCanvas = document.createElement("canvas");
    this.interactiveCanvas.className = "unidraw-canvas unidraw-interactive-canvas";
    stage.appendChild(this.interactiveCanvas);
    this.previewCanvas = document.createElement("canvas");
    this.previewCanvas.className = "unidraw-canvas unidraw-new-element-canvas";
    stage.appendChild(this.previewCanvas);
    const ctx = this.canvas.getContext("2d");
    const interactiveCtx = this.interactiveCanvas.getContext("2d");
    const previewCtx = this.previewCanvas.getContext("2d");
    if (!ctx || !interactiveCtx || !previewCtx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    this.interactiveCtx = interactiveCtx;
    this.previewCtx = previewCtx;
    this.colors = this.readColors();
    this.ctx.textBaseline = "middle";
    this.measureFont();
    this.observe();
    void this.loadFonts();
    this.scheduleRender();
  }

  private observe(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
      if (this.firstLayout) {
        this.firstLayout = false;
        this.fit();
      } else if (!this.userAdjustedView) {
        this.fit();
      }
      this.scheduleRender();
      this.onViewChange?.();
    });
    this.resizeObserver.observe(this.stage);

    this.themeObserver = new MutationObserver(() => {
      this.refreshTheme();
    });
    this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    if (typeof window.matchMedia === "function") {
      this.mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      this.mediaHandler = () => this.refreshTheme();
      this.mediaQuery.addEventListener("change", this.mediaHandler);
    }
  }

  private async loadFonts(): Promise<void> {
    try {
      const family = this.fontFamily();
      if (document.fonts && family) {
        await document.fonts.load(`${this.settings.fontSize}px ${family}`);
        await document.fonts.ready;
      }
    } catch {
      /* Font loading is best effort. */
    }
    this.measureFont();
    if (!this.userAdjustedView) this.fit();
    this.markAllDirty();
    this.scheduleRender();
    this.onViewChange?.();
  }

  refreshTheme(): void {
    this.colors = this.readColors();
    this.markAllDirty();
    this.scheduleRender();
  }

  private readColors(): ThemeColors {
    if (this.probe) this.probe.remove();
    const probe = document.createElement("div");
    probe.className = "unidraw-theme-probe";
    probe.setAttribute("aria-hidden", "true");
    const entries: Array<[keyof ThemeColors, string]> = [
      ["paper", "unidraw-probe-paper"],
      ["paperBorder", "unidraw-probe-paper-border"],
      ["text", "unidraw-probe-text"],
      ["grid", "unidraw-probe-grid"],
      ["accent", "unidraw-probe-accent"],
      ["accentText", "unidraw-probe-accent-text"],
      ["shadow", "unidraw-probe-shadow"],
      ["workspace", "unidraw-probe-workspace"],
    ];
    const spans: Record<string, HTMLElement> = {};
    for (const [, cls] of entries) {
      const span = document.createElement("span");
      span.className = cls;
      probe.appendChild(span);
      spans[cls] = span;
    }
    this.stage.appendChild(probe);
    // Reading each child's computed color resolves CSS variables and color-mix.
    const result = {} as ThemeColors;
    for (const [key, cls] of entries) {
      result[key] = cssColor(getComputedStyle(spans[cls]).color, "#888");
    }
    this.probe = probe;
    return result;
  }

  private fontFamily(): string {
    const key = this.settings.fontFamily;
    if (key && key in FONT_STACKS) {
      const stack = FONT_STACKS[key];
      if (stack) return stack;
    }
    if (key && !(key in FONT_STACKS) && !key.startsWith("obsidian")) return key;
    const cssVar = getComputedStyle(this.stage).getPropertyValue("--font-monospace").trim();
    return cssVar || "Menlo, Monaco, monospace";
  }

  private measureFont(): void {
    this.ctx.font = `${this.settings.fontSize}px ${this.fontFamily()}`;
    const metrics = this.ctx.measureText("M");
    const width = metrics.width > 0 ? metrics.width : this.settings.fontSize * 0.6;
    this.baseCellW = width;
    this.baseCellH = this.settings.fontSize * this.settings.lineHeight;
  }

  getAppearance(): { fontFamily: string; colors: ThemeColors } {
    return { fontFamily: this.fontFamily(), colors: { ...this.colors } };
  }

  setSettings(settings: EditorSettings): void {
    this.settings = settings;
    this.measureFont();
    this.markAllDirty();
    this.scheduleRender();
    this.onViewChange?.();
  }

  setState(patch: Partial<RenderViewState>): void {
    const docChanged = Object.prototype.hasOwnProperty.call(patch, "doc") && patch.doc !== this.state.doc;
    const previewChanged =
      (Object.prototype.hasOwnProperty.call(patch, "previewDoc") && patch.previewDoc !== this.state.previewDoc) ||
      Object.prototype.hasOwnProperty.call(patch, "previewBox") ||
      Object.prototype.hasOwnProperty.call(patch, "previewErase");
    this.state = { ...this.state, ...patch };
    if (docChanged) this.staticDirty = true;
    if (previewChanged) this.previewDirty = true;
    this.overlayDirty = true;
    this.scheduleRender();
  }

  setPreviewDoc(doc: DrawingDocument | null): void {
    if (this.state.previewDoc === doc) return;
    this.state = { ...this.state, previewDoc: doc };
    this.previewDirty = true;
    this.scheduleRender();
  }

  private markAllDirty(): void {
    this.staticDirty = true;
    this.overlayDirty = true;
    this.previewDirty = true;
  }

  getState(): RenderViewState {
    return this.state;
  }

  getCellMetrics(): { w: number; h: number } {
    return { w: this.baseCellW * this.zoom, h: this.baseCellH * this.zoom };
  }

  getZoom(): number {
    return this.zoom;
  }

  getPan(): { x: number; y: number } {
    return { x: this.panX, y: this.panY };
  }

  /** Unzoomed cell size, useful for aspect-corrected circles. */
  getBaseCellMetrics(): { w: number; h: number } {
    return { w: this.baseCellW, h: this.baseCellH };
  }

  private resizeCanvas(): void {
    const rect = this.stage.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = Math.max(1, Math.round(rect.width));
    this.cssH = Math.max(1, Math.round(rect.height));
    const targetW = Math.round(this.cssW * this.dpr);
    const targetH = Math.round(this.cssH * this.dpr);
    for (const canvas of [this.canvas, this.interactiveCanvas, this.previewCanvas]) {
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.setCssStyles({
          width: `${this.cssW}px`,
          height: `${this.cssH}px`,
        });
        this.staticDirty = true;
        this.overlayDirty = true;
        this.previewDirty = true;
      }
    }
    this.clampPan();
  }

  private doc(): DrawingDocument | null {
    return this.state.doc;
  }

  private boardRect(): { x: number; y: number; w: number; h: number } {
    const doc = this.doc();
    const { w, h } = this.getCellMetrics();
    return {
      x: this.panX,
      y: this.panY,
      w: Math.max(0, (doc?.cols ?? 0) * w),
      h: Math.max(0, (doc?.rows ?? 0) * h),
    };
  }

  fit(options: { padding?: number; maxZoom?: number } = {}): void {
    this.resizeCanvas();
    const doc = this.state.doc;
    if (!doc || doc.cols <= 0 || doc.rows <= 0) {
      this.zoom = 1;
      this.centerBoard();
      this.markAllDirty();
      this.scheduleRender();
      this.onViewChange?.();
      return;
    }
    const padding = options.padding ?? 54;
    const maxZoom = options.maxZoom ?? 1.5;
    const tight = doc.tightContentBounds();
    const bounds = tight ?? { r0: 0, c0: 0, r1: Math.max(0, doc.rows - 1), c1: Math.max(0, doc.cols - 1) };
    const contentCols = Math.max(1, bounds.c1 - bounds.c0 + 1);
    const contentRows = Math.max(1, bounds.r1 - bounds.r0 + 1);
    const availW = Math.max(40, this.cssW - padding * 2);
    const availH = Math.max(40, this.cssH - padding * 2);
    const rawZoom = Math.min(
      availW / (contentCols * this.baseCellW),
      availH / (contentRows * this.baseCellH),
      maxZoom,
    );
    this.zoom = clamp(rawZoom, MIN_ZOOM, MAX_ZOOM);
    const cellW = this.baseCellW * this.zoom;
    const cellH = this.baseCellH * this.zoom;
    this.panX = (this.cssW - contentCols * cellW) / 2 - bounds.c0 * cellW;
    this.panY = (this.cssH - contentRows * cellH) / 2 - bounds.r0 * cellH;
    this.userAdjustedView = false;
    this.clampPan();
    this.markAllDirty();
    this.scheduleRender();
    this.onViewChange?.();
  }

  private centerBoard(): void {
    const doc = this.state.doc;
    if (!doc) return;
    const { w, h } = this.getCellMetrics();
    const boardW = doc.cols * w;
    const boardH = doc.rows * h;
    this.panX = Math.round((this.cssW - boardW) / 2);
    this.panY = Math.round((this.cssH - boardH) / 2);
  }

  setZoom(nextZoom: number, anchor?: { x: number; y: number }): void {
    const clamped = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(clamped - this.zoom) < 0.0001) return;
    this.userAdjustedView = true;
    const ax = anchor?.x ?? this.cssW / 2;
    const ay = anchor?.y ?? this.cssH / 2;
    const worldX = (ax - this.panX) / this.zoom;
    const worldY = (ay - this.panY) / this.zoom;
    this.zoom = clamped;
    this.panX = ax - worldX * this.zoom;
    this.panY = ay - worldY * this.zoom;
    this.clampPan();
    this.markAllDirty();
    this.scheduleRender();
    this.onViewChange?.();
  }

  zoomIn(anchor?: { x: number; y: number }): void {
    const next = ZOOM_STEPS.find((step) => step > this.zoom + 0.001) ?? MAX_ZOOM;
    this.setZoom(next, anchor);
  }

  zoomOut(anchor?: { x: number; y: number }): void {
    const reversed = [...ZOOM_STEPS].reverse();
    const next = reversed.find((step) => step < this.zoom - 0.001) ?? MIN_ZOOM;
    this.setZoom(next, anchor);
  }

  resetZoom(): void {
    this.setZoom(1);
  }

  panBy(dx: number, dy: number): void {
    this.userAdjustedView = true;
    this.panX += dx;
    this.panY += dy;
    this.clampPan();
    this.markAllDirty();
    this.scheduleRender();
  }

  setPan(x: number, y: number): void {
    this.userAdjustedView = true;
    this.panX = x;
    this.panY = y;
    this.clampPan();
    this.markAllDirty();
    this.scheduleRender();
  }

  private clampAxis(position: number, boardSize: number, stageSize: number): number {
    if (boardSize <= 0 || stageSize <= 0) return position;
    const margin = 48;
    if (boardSize + margin * 2 <= stageSize) {
      // Small board: keep it fully visible, with a little breathing room.
      const min = margin;
      const max = stageSize - boardSize - margin;
      return min <= max ? clamp(position, min, max) : (stageSize - boardSize) / 2;
    }
    // Large board: keep at least a slice of it visible.
    const min = margin - boardSize;
    const max = stageSize - margin;
    return clamp(position, min, max);
  }

  private clampPan(): void {
    const board = this.boardRect();
    if (board.w <= 0 || board.h <= 0) return;
    this.panX = this.clampAxis(this.panX, board.w, this.cssW);
    this.panY = this.clampAxis(this.panY, board.h, this.cssH);
  }

  screenToCell(clientX: number, clientY: number, allowOutside = false): CellPos | null {
    const doc = this.state.doc;
    if (!doc) return null;
    const rect = this.stage.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { w, h } = this.getCellMetrics();
    if (w <= 0 || h <= 0) return null;
    const col = Math.floor((x - this.panX) / w);
    const row = Math.floor((y - this.panY) / h);
    if (!allowOutside && (row < 0 || col < 0 || row >= doc.rows || col >= doc.cols)) return null;
    return { row: Math.max(0, row), col: Math.max(0, col) };
  }

  /** Convert a screen point to stage-relative coordinates for overlays. */
  screenPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.stage.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  stagePointToCell(x: number, y: number): CellPos | null {
    const doc = this.state.doc;
    if (!doc) return null;
    const { w, h } = this.getCellMetrics();
    if (w <= 0 || h <= 0) return null;
    return {
      row: Math.max(0, Math.floor((y - this.panY) / h)),
      col: Math.max(0, Math.floor((x - this.panX) / w)),
    };
  }

  cellToScreen(row: number, col: number): { x: number; y: number } {
    const { w, h } = this.getCellMetrics();
    return { x: this.panX + col * w, y: this.panY + row * h };
  }

  visibleRange(): { r0: number; r1: number; c0: number; c1: number } {
    const doc = this.state.doc;
    const { w, h } = this.getCellMetrics();
    if (!doc || w <= 0 || h <= 0) return { r0: 0, r1: -1, c0: 0, c1: -1 };
    return {
      r0: Math.max(0, Math.floor(-this.panY / h) - 1),
      r1: Math.min(doc.rows - 1, Math.ceil((this.cssH - this.panY) / h) + 1),
      c0: Math.max(0, Math.floor(-this.panX / w) - 1),
      c1: Math.min(doc.cols - 1, Math.ceil((this.cssW - this.panX) / w) + 1),
    };
  }

  scheduleRender(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private drawEmptyHint(ctx: CanvasRenderingContext2D): void {
    const hint = this.state.emptyHint;
    if (!hint) return;
    const board = this.boardRect();
    const cx = Math.min(this.cssW - 80, Math.max(80, this.panX + board.w / 2));
    const cy = Math.min(this.cssH - 60, Math.max(60, this.panY + board.h / 2));
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = this.colors.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillText(hint.title, cx, cy - 8);
    ctx.globalAlpha = 0.3;
    ctx.font = `12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillText(hint.subtitle, cx, cy + 18);
    ctx.restore();
  }

  private drawObjectOverlays(ctx: CanvasRenderingContext2D): void {
    const { w, h } = this.getCellMetrics();
    if (w <= 0 || h <= 0) return;
    const rectFor = (box: SelectionRect) => ({
      x: this.panX + box.c0 * w,
      y: this.panY + box.r0 * h,
      w: Math.max(1, (box.c1 - box.c0 + 1) * w),
      h: Math.max(1, (box.r1 - box.r0 + 1) * h),
    });

    const selectionColor = "#4c8dff";
    const textBox = this.state.textSelection;
    if (textBox) {
      const r = rectFor(textBox);
      ctx.save();
      ctx.fillStyle = "#e5534b";
      ctx.globalAlpha = 0.1;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "#e5534b";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.max(1, Math.round(r.w)), Math.max(1, Math.round(r.h)));
      ctx.restore();
    }
    if (this.state.softSelection) {
      const board = this.boardRect();
      ctx.save();
      ctx.strokeStyle = selectionColor;
      ctx.fillStyle = selectionColor;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 7]);
      ctx.strokeRect(Math.round(board.x) + 0.5, Math.round(board.y) + 0.5, Math.max(1, Math.round(board.w) - 1), Math.max(1, Math.round(board.h) - 1));
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.strokeStyle = selectionColor;
    ctx.fillStyle = selectionColor;
    // Individual selected object outlines.
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const box of this.state.objectBoxes) {
      const r = rectFor(box);
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    }

    // Marquee.
    if (this.state.marquee) {
      const r = rectFor(this.state.marquee);
      ctx.globalAlpha = 0.1;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    }

    // Selection union + corner handles.
    if (this.state.selection) {
      const r = rectFor(this.state.selection);
      ctx.globalAlpha = 0.95;
      ctx.setLineDash([]);
      ctx.lineWidth = 1.4;
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
      if (this.state.showHandles === false) {
        ctx.restore();
        return;
      }
      const size = 7;
      const points = [
        { x: r.x, y: r.y },
        { x: r.x + r.w, y: r.y },
        { x: r.x, y: r.y + r.h },
        { x: r.x + r.w, y: r.y + r.h },
      ];
      for (const p of points) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = this.colors.paper;
        ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
        ctx.strokeStyle = selectionColor;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(Math.round(p.x - size / 2) + 0.5, Math.round(p.y - size / 2) + 0.5, size - 1, size - 1);
      }
    }
    ctx.restore();
  }

  private drawMeasureBadge(ctx: CanvasRenderingContext2D): void {
    const label = this.state.measureLabel;
    const point = this.state.measurePoint;
    if (!label || !point) return;
    ctx.save();
    ctx.font = `600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    const paddingX = 8;
    const width = ctx.measureText(label).width + paddingX * 2;
    const height = 22;
    let x = point.x + 16;
    let y = point.y + 20;
    if (x + width > this.cssW - 8) x = point.x - width - 16;
    if (y + height > this.cssH - 8) y = point.y - height - 16;
    ctx.fillStyle = this.colors.accent;
    roundRectPath(ctx, x, y, width, height, 6);
    ctx.fill();
    ctx.fillStyle = this.colors.accentText;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + width / 2, y + height / 2 + 0.5);
    ctx.restore();
  }

  private renderStatic(): void {
    this.resizeCanvas();
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    const doc = this.state.doc;
    if (!doc || doc.cols <= 0 || doc.rows <= 0) return;
    const board = this.boardRect();
    const { w, h } = this.getCellMetrics();
    const radius = 6;

    // Board shadow and paper.
    ctx.save();
    ctx.shadowColor = this.colors.shadow;
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 9;
    ctx.fillStyle = this.colors.paper;
    roundRectPath(ctx, board.x, board.y, board.w, board.h, radius);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = this.colors.paperBorder;
    ctx.lineWidth = 1;
    roundRectPath(ctx, board.x + 0.5, board.y + 0.5, board.w - 1, board.h - 1, radius);
    ctx.stroke();
    ctx.restore();

    // Clip all grid/art to the board.
    ctx.save();
    ctx.beginPath();
    ctx.rect(board.x, board.y, board.w, board.h);
    ctx.clip();

    // Grid.
    const drawGrid = this.settings.grid !== "none" && this.zoom >= 0.45;
    if (drawGrid) {
      const range = this.visibleRange();
      ctx.save();
      ctx.strokeStyle = this.colors.grid;
      ctx.fillStyle = this.colors.grid;
      ctx.globalAlpha = this.settings.grid === "lines" ? 0.18 : 0.5;
      if (this.settings.grid === "lines") {
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let c = range.c0; c <= range.c1 + 1; c++) {
          const x = Math.round(this.panX + c * w) + 0.5;
          ctx.moveTo(x, Math.max(board.y, 0));
          ctx.lineTo(x, Math.min(board.y + board.h, this.cssH));
        }
        for (let r = range.r0; r <= range.r1 + 1; r++) {
          const y = Math.round(this.panY + r * h) + 0.5;
          ctx.moveTo(Math.max(board.x, 0), y);
          ctx.lineTo(Math.min(board.x + board.w, this.cssW), y);
        }
        ctx.stroke();
      } else {
        const step = this.zoom >= 1.3 ? 1 : 2;
        for (let r = Math.ceil(range.r0 / step) * step; r <= range.r1 + 1; r += step) {
          for (let c = Math.ceil(range.c0 / step) * step; c <= range.c1 + 1; c += step) {
            const x = this.panX + c * w;
            const y = this.panY + r * h;
            const size = this.zoom >= 1.5 ? 1.5 : 1;
            ctx.fillRect(Math.round(x * dpr) / dpr, Math.round(y * dpr) / dpr, size, size);
          }
        }
      }
      ctx.restore();
    }

    // Empty state hint.
    if (doc.isEmpty() && !this.state.caret) {
      this.drawEmptyHint(ctx);
    }

    // Characters.
    const range = this.visibleRange();
    const font = `${this.settings.fontSize * this.zoom}px ${this.fontFamily()}`;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = this.colors.text;
    const visibleW = this.cssW;
    const visibleH = this.cssH;
    for (let r = range.r0; r <= range.r1; r++) {
      const row = doc.rawRow(r);
      if (!row) continue;
      const y = this.panY + (r + 0.5) * h;
      if (y < -h || y > visibleH + h) continue;
      for (let c = range.c0; c <= range.c1; c++) {
        const raw = row[c];
        if (!raw || raw === " " || raw === WIDE_CONT) continue;
        const width = Math.max(1, graphemeWidth(raw));
        const x = this.panX + (c + width / 2) * w;
        if (x < -w * 2 || x > visibleW + w * 2) continue;
        const rectX = this.panX + c * w;
        const rectY = this.panY + r * h;
        const vector = paintGlyphVector(ctx, raw, rectX, rectY, width * w, h, {
          color: this.colors.text,
          fontSize: this.settings.fontSize * this.zoom,
        });
        if (!vector) {
          ctx.fillStyle = this.colors.text;
          ctx.fillText(raw, x, y);
        }
      }
    }

    ctx.restore();
  }

  private drawCharsOnCanvas(
    ctx: CanvasRenderingContext2D,
    doc: DrawingDocument,
    options: { fontScale?: number; alpha?: number; clipBoard?: boolean } = {},
  ): void {
    this.resizeCanvas();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    if (!doc || doc.cols <= 0 || doc.rows <= 0) return;
    const board = this.boardRect();
    const { w, h } = this.getCellMetrics();
    ctx.save();
    if (options.clipBoard !== false) {
      ctx.beginPath();
      ctx.rect(board.x, board.y, board.w, board.h);
      ctx.clip();
    }
    const range = this.visibleRange();
    ctx.font = `${this.settings.fontSize * this.zoom * (options.fontScale ?? 1)}px ${this.fontFamily()}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = this.colors.text;
    ctx.globalAlpha = options.alpha ?? 1;
    for (let r = range.r0; r <= range.r1; r++) {
      const row = doc.rawRow(r);
      if (!row) continue;
      const y = this.panY + (r + 0.5) * h;
      for (let c = range.c0; c <= range.c1; c++) {
        const raw = row[c];
        if (!raw || raw === " " || raw === WIDE_CONT) continue;
        const width = Math.max(1, graphemeWidth(raw));
        const rectX = this.panX + c * w;
        const rectY = this.panY + r * h;
        const vector = paintGlyphVector(ctx, raw, rectX, rectY, width * w, h, {
          color: this.colors.text,
          fontSize: this.settings.fontSize * this.zoom,
        });
        if (!vector) {
          const x = this.panX + (c + width / 2) * w;
          ctx.fillText(raw, x, y);
        }
      }
    }
    ctx.restore();
  }

  private renderInteractive(): void {
    this.resizeCanvas();
    const ctx = this.interactiveCtx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    const doc = this.state.doc;
    const { w, h } = this.getCellMetrics();
    if (doc && w > 0 && h > 0) {
      if (this.state.hover && this.zoom >= 0.5) {
        const glyph = doc.glyphAt(this.state.hover.row, this.state.hover.col);
        const width = glyph?.width ?? 1;
        const headCol = glyph?.headCol ?? this.state.hover.col;
        const x = this.panX + headCol * w;
        const y = this.panY + this.state.hover.row * h;
        ctx.save();
        ctx.fillStyle = this.colors.accent;
        ctx.globalAlpha = 0.055;
        ctx.fillRect(x, y, width * w, h);
        ctx.globalAlpha = 0.65;
        ctx.strokeStyle = this.colors.accent;
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.max(1, Math.round(width * w) - 1), Math.max(1, Math.round(h) - 1));
        ctx.restore();
      }
      if (this.state.caret?.visible) {
        const caret = this.state.caret;
        const x = this.panX + caret.col * w;
        const y = this.panY + caret.row * h;
        ctx.save();
        ctx.fillStyle = this.colors.accent;
        ctx.globalAlpha = 0.2;
        ctx.fillRect(x, y, caret.width * w, h);
        ctx.globalAlpha = 1;
        ctx.fillRect(x, y, Math.max(1.5, 1.5 * this.zoom), h);
        ctx.restore();
      }
    }
    this.drawObjectOverlays(ctx);
    this.drawMeasureBadge(ctx);
  }

  private drawPreviewBox(ctx: CanvasRenderingContext2D): void {
    const box = this.state.previewBox;
    if (!box) return;
    const { w, h } = this.getCellMetrics();
    const r = {
      x: this.panX + box.c0 * w,
      y: this.panY + box.r0 * h,
      w: Math.max(1, (box.c1 - box.c0 + 1) * w),
      h: Math.max(1, (box.r1 - box.r0 + 1) * h),
    };
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 3]);
    ctx.strokeStyle = "#4c8dff";
    ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    ctx.restore();
  }

  private renderPreview(): void {
    const ctx = this.previewCtx;
    const doc = this.state.previewDoc;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    if (doc) this.drawCharsOnCanvas(ctx, doc, { clipBoard: true });
    this.drawPreviewBox(ctx);
    const erase = this.state.previewErase;
    if (erase) {
      const { w, h } = this.getCellMetrics();
      const r = {
        x: this.panX + erase.c0 * w,
        y: this.panY + erase.r0 * h,
        w: Math.max(1, (erase.c1 - erase.c0 + 1) * w),
        h: Math.max(1, (erase.r1 - erase.r0 + 1) * h),
      };
      ctx.save();
      ctx.fillStyle = "#e5534b";
      ctx.globalAlpha = 0.12;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = "#e5534b";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
      ctx.restore();
    }
  }

  render(): void {
    this.resizeCanvas();
    if (this.staticDirty) {
      this.renderStatic();
      this.staticDirty = false;
    }
    if (this.overlayDirty) {
      this.renderInteractive();
      this.overlayDirty = false;
    }
    if (this.previewDirty) {
      this.renderPreview();
      this.previewDirty = false;
    }
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
    if (this.mediaQuery && this.mediaHandler) {
      this.mediaQuery.removeEventListener("change", this.mediaHandler);
    }
    this.probe?.remove();
    this.canvas.remove();
    this.interactiveCanvas.remove();
    this.previewCanvas.remove();
  }
}
