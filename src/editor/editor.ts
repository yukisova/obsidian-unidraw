import { DrawingDocument, WIDE_CONT } from "../core/document";
import {
  addLayer as addLayerToData,
  canMergeLayers,
  cloneData,
  composeData,
  duplicateObjectsForPaste,
  mergeLayers as mergeLayersInData,
  parseUnidraw,
  serializeUnidraw,
  shiftObject,
  uniqueLayerName,
} from "../core/file-format";
import {
  boundsOfObjects,
  cloneObject,
  createPadding,
  findObject,
  getActiveLayer,
  getLayer,
  allObjects,
  objectBounds,
  removeObjectById,
  setObjectBounds,
  translateObject,
  type CellsObject,
  type CircleObject,
  type DiamondObject,
  type DrawingObject,
  type GroupObject,
  type CellTuple,
  type Layer,
  type LineObject,
  type RectFillMode,
  type RectInterrupt,
  type RectObject,
  type UnidrawData,
  ensureGlobalDoodle,
  createId,
  isDoodle,
  isElementLocked,
  isElementVisible,
  isInternalObject,
  getShapeFill,
} from "../core/objects";
import type {
  ArrowStyle,
  CellPos,
  EditorSettings,
  GridMode,
  LineRoute,
  SelectionRect,
  StrokeStyle,
  TextAlignH,
  TextAlignV,
  TextDirection,
  TextTransform,
  TextWrapMode,
  ToolId,
} from "../core/types";
import type { MessageKey, Translator } from "../core/i18n";
import { codePointLabel, firstGrapheme, graphemeWidth, graphemes } from "../core/unicode";
import { CanvasRenderer, type RenderViewState } from "../render/renderer";
import { renderElement, renderCells, type RenderElementOptions } from "../model/rasterize";
import { drawEllipse } from "../glyphs/shapes";
import { drawingToMarkdown } from "../core/format";
import { copyTextToClipboard } from "../render/export-image";

export interface TextEditRequest {
  objectId: string;
  box: SelectionRect;
  text: string;
  font: TextTransform;
}

export interface EditorHooks {
  isActive: () => boolean;
  isModalOpen: () => boolean;
  requestSave: () => void;
  saveNow: () => void;
  statusChanged: () => void;
  notify: (key: MessageKey, vars?: Record<string, string | number>) => void;
  openHelp: () => void;
  requestText: (request: TextEditRequest) => void;
  requestElementContextMenu?: (clientX: number, clientY: number) => void;
  settingsChanged?: () => void;
}

export interface EditorOptions {
  stage: HTMLElement;
  settings: EditorSettings;
  t: Translator;
  hooks: EditorHooks;
}

export interface EditorStatus {
  tool: ToolId;
  hoverRow: number | null;
  hoverCol: number | null;
  hoverChar: string;
  hoverCode: string;
  selectionWidth: number;
  selectionHeight: number;
  hasSelection: boolean;
  selectionCount: number;
  artCols: number;
  artRows: number;
  canvasCols: number;
  canvasRows: number;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  grid: GridMode;
  textEditing: boolean;
  drawChar: string;
  saveState?: "saved" | "saving" | "unsaved" | "error";
  activeLayerName: string;
  layerCount: number;
  objectCount: number;
  gridSize: number;
}

type Handle = "nw" | "ne" | "sw" | "se";

type Gesture =
  | { type: "pan"; startX: number; startY: number; panX: number; panY: number }
  | { type: "marquee"; start: CellPos; current: CellPos; additive: boolean; moved: boolean }
  | {
      type: "pencil";
      before: string;
      object: CellsObject;
      last: CellPos;
      erase: boolean;
      changed: boolean;
    }
  | {
      type: "shape";
      before: string;
      object: LineObject | RectObject | DiamondObject;
      start: CellPos;
      current: CellPos;
      mode: "line" | "hollow" | "solid" | "diamond";
      erase: boolean;
      changed: boolean;
    }
  | {
      type: "circle";
      before: string;
      object: DrawingObject | null;
      start: CellPos;
      current: CellPos;
      erase: boolean;
      changed: boolean;
    }
  | { type: "textSelect"; start: CellPos; current: CellPos; moved: boolean }
  | {
      type: "move";
      before: string;
      start: CellPos;
      last: CellPos;
      originals: Array<{ id: string; object: DrawingObject }>;
      bounds: { x: number; y: number; w: number; h: number };
      moved: boolean;
    }
  | {
      type: "resize";
      before: string;
      handle: Handle;
      originals: Array<{ id: string; object: DrawingObject }>;
      bounds: { x: number; y: number; w: number; h: number };
      start: CellPos;
      changed: boolean;
      right?: boolean;
      moved?: boolean;
    };

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const HANDLE_HIT = 9;
const PASTE_OFFSET = 2;

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

function normalizeRect(a: CellPos, b: CellPos): SelectionRect {
  return {
    r0: Math.min(a.row, b.row),
    c0: Math.min(a.col, b.col),
    r1: Math.max(a.row, b.row),
    c1: Math.max(a.col, b.col),
  };
}

function boxFromBounds(x: number, y: number, w: number, h: number): SelectionRect {
  return { r0: y, c0: x, r1: y + Math.max(1, h) - 1, c1: x + Math.max(1, w) - 1 };
}

function boundsToBox(bounds: { x: number; y: number; w: number; h: number }): SelectionRect {
  return boxFromBounds(bounds.x, bounds.y, bounds.w, bounds.h);
}

function boxToBounds(box: SelectionRect): { x: number; y: number; w: number; h: number } {
  return { x: box.c0, y: box.r0, w: box.c1 - box.c0 + 1, h: box.r1 - box.r0 + 1 };
}

function contains(box: SelectionRect, row: number, col: number): boolean {
  return row >= box.r0 && row <= box.r1 && col >= box.c0 && col <= box.c1;
}

function insideBox(inner: SelectionRect, outer: SelectionRect): boolean {
  return inner.r0 >= outer.r0 && inner.c0 >= outer.c0 && inner.r1 <= outer.r1 && inner.c1 <= outer.c1;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

function isMac(): boolean {
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

function modKey(e: KeyboardEvent | MouseEvent | PointerEvent): boolean {
  // Support both conventions, including the explicit Ctrl-click workflow.
  return e.metaKey || e.ctrlKey;
}

function arrowStyleIcon(style: ArrowStyle): string {
  return style === "none" ? "—" : style === "line" ? "→" : style === "hollow" ? "▷" : "▶";
}

export class Editor {
  private stage: HTMLElement;
  private settings: EditorSettings;
  private t: Translator;
  private hooks: EditorHooks;
  private data: UnidrawData;
  private composed: ReturnType<typeof composeData>;
  private renderer: CanvasRenderer;
  private statusRaf = 0;
  private tool: ToolId = "select";
  private strokeStyle: StrokeStyle;
  private route: LineRoute = "straight";
  private arrowStartStyle: ArrowStyle = "none";
  private arrowEndStyle: ArrowStyle = "none";
  private drawChar: string;
  private fillChar: string;
  private textFont: TextTransform;
  private paintDoodle: CellsObject | null = null;
  private textSelection: SelectionRect | null = null;
  private suppressContextMenuUntil = 0;
  private lastTextSelectionDrag = false;
  private selection = new Set<string>();
  private selectedLayers = new Set<string>();
  private hover: CellPos | null = null;
  private gesture: Gesture | null = null;
  private pendingText: TextEditRequest | null = null;
  private pendingBefore: string | null = null;
  private textEditingId: string | null = null;
  private pendingCreatedObjectId: string | null = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private clipboard: DrawingObject[] = [];
  private spaceDown = false;
  private preSpaceTool: ToolId | null = null;
  private suppressSave = false;
  private saveState: EditorStatus["saveState"] = "saved";
  private abort = new AbortController();
  private fittedOnce = false;

  constructor(options: EditorOptions) {
    this.stage = options.stage;
    this.settings = options.settings;
    this.t = options.t;
    this.hooks = options.hooks;
    this.strokeStyle = options.settings.defaultStroke;
    this.drawChar = firstGrapheme(options.settings.drawChar) || "█";
    this.fillChar = firstGrapheme(options.settings.fillChar) || "█";
    this.textFont = options.settings.textTransform || "normal";
    this.data = parseUnidraw("");
    ensureGlobalDoodle(getActiveLayer(this.data) ?? this.data.layers[0]);
    this.composed = composeData(this.data);
    this.selectedLayers.add(this.data.activeLayerId);

    const composed = this.composed;
    const initial: RenderViewState = {
      doc: composed.doc,
      selection: null,
      softSelection: false,
      textSelection: null,
      previewErase: null,
      showHandles: true,
      objectBoxes: [],
      marquee: null,
      previewBox: null,
      previewDoc: null,
      hover: null,
      caret: null,
      measureLabel: null,
      measurePoint: null,
      emptyHint: { title: this.t("empty.title"), subtitle: this.t("empty.subtitle") },
      tool: this.tool,
      panning: false,
    };
    this.renderer = new CanvasRenderer(options.stage, options.settings, initial);
    this.renderer.onViewChange = () => this.hooks.statusChanged();
    this.renderer.setState({ doc: composed.doc });
    this.bind();
    this.refresh(false);
    this.hooks.statusChanged();
  }

  // ---------------------------------------------------------------- lifecycle

  private bind(): void {
    const signal = this.abort.signal;
    this.stage.addEventListener("pointerdown", (e) => this.onPointerDown(e), { signal });
    this.stage.addEventListener("pointermove", (e) => this.onPointerMove(e), { signal });
    this.stage.addEventListener("pointerup", (e) => this.onPointerUp(e), { signal });
    this.stage.addEventListener("pointercancel", () => this.cancelGesture(), { signal });
    this.stage.addEventListener("pointerleave", () => this.clearHover(), { signal });
    this.stage.addEventListener("contextmenu", (e) => e.preventDefault(), { signal });
    this.stage.addEventListener("dblclick", (e) => this.onDoubleClick(e), { signal });
    this.stage.addEventListener("wheel", (e) => this.onWheel(e), { signal, passive: false });
    document.addEventListener("keydown", (e) => this.onKeyDown(e), { signal, capture: true });
    document.addEventListener("keyup", (e) => this.onKeyUp(e), { signal, capture: true });
  }

  destroy(): void {
    if (this.statusRaf) cancelAnimationFrame(this.statusRaf);
    this.abort.abort();
    this.renderer.destroy();
  }

  getStage(): HTMLElement {
    return this.stage;
  }

  getCanvas(): HTMLCanvasElement {
    return this.renderer.canvas;
  }

  getDoc(): DrawingDocument {
    return this.composed.doc;
  }

  getData(): UnidrawData {
    return this.data;
  }

  getTool(): ToolId {
    return this.tool;
  }

  isTextEditing(): boolean {
    return this.pendingText !== null;
  }

  getSettings(): EditorSettings {
    return this.settings;
  }

  setTranslator(t: Translator): void {
    this.t = t;
    this.refresh(false);
  }

  loadText(raw: string): void {
    this.pendingText = null;
    this.pendingBefore = null;
    this.gesture = null;
    this.selection.clear();
    this.selectedLayers.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.data = parseUnidraw(raw);
    if (!this.data.layers.some((layer) => layer.id === this.data.activeLayerId)) {
      this.data.activeLayerId = this.data.layers[0]?.id ?? "";
    }
    const active = getActiveLayer(this.data) ?? this.data.layers[0];
    if (active) ensureGlobalDoodle(active);
    this.selectedLayers.add(this.data.activeLayerId);
    this.fittedOnce = false;
    this.composed = composeData(this.data);
    this.refresh(false);
    window.requestAnimationFrame(() => {
      this.fitView();
      this.fittedOnce = true;
    });
  }

  applySettings(settings: EditorSettings): void {
    const fontChanged =
      this.settings.fontFamily !== settings.fontFamily ||
      this.settings.fontSize !== settings.fontSize ||
      this.settings.lineHeight !== settings.lineHeight;
    this.settings = settings;
    this.renderer.setSettings(settings);
    this.refresh(false);
    if (fontChanged) window.requestAnimationFrame(() => this.renderer.fit());
  }

  setSaveState(state: EditorStatus["saveState"]): void {
    this.saveState = state;
    this.hooks.statusChanged();
  }

  // --------------------------------------------------------------- public state

  getStatus(): EditorStatus {
    const selectionBounds = this.getSelectionBounds();
    const composed = this.composed;
    const active = getActiveLayer(this.data);
    const hover = this.hover && composed.doc.glyphAt(this.hover.row, this.hover.col);
    return {
      tool: this.tool,
      hoverRow: this.hover?.row ?? null,
      hoverCol: this.hover?.col ?? null,
      hoverChar: hover?.char ?? "",
      hoverCode: hover?.char ? codePointLabel(hover.char) : "",
      selectionWidth: selectionBounds ? selectionBounds.c1 - selectionBounds.c0 + 1 : 0,
      selectionHeight: selectionBounds ? selectionBounds.r1 - selectionBounds.r0 + 1 : 0,
      hasSelection: this.selection.size > 0,
      selectionCount: this.selection.size,
      artCols: composed.doc.contentBounds().cols,
      artRows: composed.doc.contentBounds().rows,
      canvasCols: composed.cols,
      canvasRows: composed.rows,
      zoom: this.renderer.getZoom(),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      grid: this.settings.grid,
      textEditing: this.pendingText !== null,
      drawChar: this.drawChar,
      saveState: this.saveState,
      activeLayerName: active?.name ?? "",
      layerCount: this.data.layers.length,
      objectCount: allObjects(this.data).length,
      gridSize: this.settings.fontSize,
    };
  }

  getArtText(): string {
    return this.composed.doc.trimmedText();
  }

  getFileText(): string {
    return serializeUnidraw(this.data);
  }

  /** The new text editor is modal; this keeps the view's save hook compatible. */
  commitPendingText(): void {
    // Nothing to flush: text is committed by the modal's Apply action.
  }

  insertTemplate(art: string): void {
    const layer = this.requireWritableLayer();
    if (!layer) return;
    const cells: Array<[number, number, string]> = [];
    const rows = art.replace(/\r\n?/g, "\n").split("\n");
    for (let r = 0; r < rows.length; r++) {
      let col = 0;
      for (const g of graphemes(rows[r])) {
        const w = Math.max(1, graphemeWidth(g));
        if (g !== " " && g !== "\u3000") cells.push([r, col, g]);
        col += w;
      }
    }
    if (cells.length === 0) return;
    const before = this.snapshot();
    const object: CellsObject = { id: createObjectId(), kind: "cells", role: "draw", cells };
    layer.objects.push(object);
    this.selection = new Set([object.id]);
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  hasSelection(): boolean {
    return this.selection.size > 0;
  }

  getBoxClientRect(box: SelectionRect): { left: number; top: number; width: number; height: number } {
    const topLeft = this.renderer.cellToScreen(box.r0, box.c0);
    const bottomRight = this.renderer.cellToScreen(box.r1 + 1, box.c1 + 1);
    const stage = this.stage.getBoundingClientRect();
    return {
      left: stage.left + topLeft.x,
      top: stage.top + topLeft.y,
      width: Math.max(1, bottomRight.x - topLeft.x),
      height: Math.max(1, bottomRight.y - topLeft.y),
    };
  }

  getSelectionBounds(): { r0: number; c0: number; r1: number; c1: number } | null {
    const bounds = this.selectedBounds();
    return bounds ? boundsToBox(bounds) : null;
  }

  getSelectedObjects(): DrawingObject[] {
    return this.selectedObjects().map((entry) => entry.object);
  }

  selectObjects(ids: string[]): void {
    const found = ids
      .map((id) => findObject(this.data, id))
      .filter((item): item is NonNullable<typeof item> => !!item && !item.object.hidden);
    this.selection = new Set(found.map((item) => item.object.id));
    const first = found[0];
    if (first) {
      this.data.activeLayerId = first.layer.id;
      this.selectedLayers = new Set([first.layer.id]);
    }
    this.refresh(false);
  }

  /** Select every visible object intersecting a rectangle (used by demos/tests). */
  setSelection(rect: SelectionRect | null): void {
    if (!rect) {
      this.clearSelection();
      return;
    }
    const found = this.data.layers
      .filter((layer) => layer.visible && !layer.locked)
      .flatMap((layer) => layer.objects)
      .filter((object) => {
        if (object.hidden) return false;
        const b = objectBounds(object);
        if (!b) return false;
        return !(b.x + b.w - 1 < rect.c0 || b.x > rect.c1 || b.y + b.h - 1 < rect.r0 || b.y > rect.r1);
      });
    this.selection = new Set(found.map((object) => object.id));
    const first = found[0];
    if (first) {
      const layer = this.layerForObject(first);
      if (layer) {
        this.data.activeLayerId = layer.id;
        this.selectedLayers = new Set([layer.id]);
      }
    }
    this.refresh(false);
  }

  getAppearance(): { fontFamily: string; colors: import("../render/renderer").ThemeColors } {
    return this.renderer.getAppearance();
  }

  /** Viewport coordinates of a cell centre, useful for UI automation. */
  getCellClientPoint(row: number, col: number): { x: number; y: number } {
    const point = this.renderer.cellToScreen(row, col);
    const rect = this.renderer.canvas.getBoundingClientRect();
    const metrics = this.renderer.getCellMetrics();
    return { x: rect.left + point.x + metrics.w / 2, y: rect.top + point.y + metrics.h / 2 };
  }

  /** Viewport coordinates of a cell boundary, used by selection handles. */
  getCellBoundaryClientPoint(row: number, col: number): { x: number; y: number } {
    const point = this.renderer.cellToScreen(row, col);
    const rect = this.renderer.canvas.getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  }

  getDataSnapshot(): string {
    return serializeUnidraw(this.data);
  }

  // --------------------------------------------------------------- tool settings

  setTool(tool: ToolId): void {
    this.tool = tool;
    this.cancelGesture();
    this.renderer.setState({ tool });
    this.updateCursor();
    this.refresh(false);
  }

  setStrokeStyle(style: StrokeStyle): void {
    this.strokeStyle = style;
    this.applyToStylebar();
  }

  getStrokeStyle(): StrokeStyle {
    return this.strokeStyle;
  }

  setRoute(route: LineRoute): void {
    this.route = route;
    this.applyToStylebar();
  }

  getRoute(): LineRoute {
    return this.route;
  }

  setArrowStyles(start: ArrowStyle, end: ArrowStyle): void {
    this.arrowStartStyle = start;
    this.arrowEndStyle = end;
    this.applyToStylebar();
  }

  setArrowStartStyle(style: ArrowStyle): void {
    this.arrowStartStyle = style;
    this.applyToStylebar();
  }

  setArrowEndStyle(style: ArrowStyle): void {
    this.arrowEndStyle = style;
    this.applyToStylebar();
  }

  getArrowStyles(): { start: ArrowStyle; end: ArrowStyle } {
    return { start: this.arrowStartStyle, end: this.arrowEndStyle };
  }

  setDrawChar(ch: string): void {
    this.drawChar = firstGrapheme(ch) || "█";
    this.applyToStylebar();
  }

  getDrawChar(): string {
    return this.drawChar;
  }

  setFillChar(ch: string): void {
    this.fillChar = firstGrapheme(ch) || "█";
    this.applyToStylebar();
  }

  getFillChar(): string {
    return this.fillChar;
  }

  setTextFont(font: TextTransform): void {
    this.textFont = font;
    this.applyToStylebar();
  }

  getTextFont(): TextTransform {
    return this.textFont;
  }

  setGrid(mode: GridMode): void {
    this.settings.grid = mode;
    this.renderer.setSettings(this.settings);
    this.applyToStylebar();
    this.hooks.settingsChanged?.();
  }

  getGrid(): GridMode {
    return this.settings.grid;
  }

  toggleGrid(): void {
    this.setGrid(this.settings.grid === "none" ? "lines" : "none");
  }

  setGridSize(size: number): void {
    const allowed = [4, 8, 12, 16];
    this.settings.fontSize = allowed.includes(size) ? size : 12;
    this.renderer.setSettings(this.settings);
    this.hooks.settingsChanged?.();
    this.refresh(false);
    window.requestAnimationFrame(() => this.renderer.fit());
  }

  private applyToStylebar(): void {
    this.refresh(false);
  }

  // ----------------------------------------------------------------- history

  private snapshot(): string {
    return serializeUnidraw(this.data);
  }

  private pushHistory(before: string): void {
    if (before === this.snapshot()) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  private change(fn: () => void, options: { save?: boolean } = {}): void {
    const before = this.snapshot();
    fn();
    this.pushHistory(before);
    this.refresh();
    if (options.save !== false) this.hooks.requestSave();
  }

  undo(): void {
    if (this.undoStack.length === 0) {
      this.hooks.notify("notice.undo");
      return;
    }
    const current = this.snapshot();
    const previous = this.undoStack.pop() as string;
    this.redoStack.push(current);
    this.restore(previous);
    this.hooks.notify("notice.undo");
    this.hooks.requestSave();
  }

  redo(): void {
    if (this.redoStack.length === 0) {
      this.hooks.notify("notice.redo");
      return;
    }
    const current = this.snapshot();
    const next = this.redoStack.pop() as string;
    this.undoStack.push(current);
    this.restore(next);
    this.hooks.notify("notice.redo");
    this.hooks.requestSave();
  }

  private restore(snapshot: string): void {
    this.data = JSON.parse(snapshot) as UnidrawData;
    this.selection.clear();
    this.selectedLayers.clear();
    this.selectedLayers.add(this.data.activeLayerId);
    this.refresh();
  }

  // ----------------------------------------------------------- selection helpers

  private selectedObjects(): Array<{ id: string; object: DrawingObject }> {
    const result: Array<{ id: string; object: DrawingObject }> = [];
    for (const id of this.selection) {
      const found = findObject(this.data, id);
      if (found && !isInternalObject(found.object)) {
        result.push({ id, object: found.object });
      }
    }
    return result;
  }

  private selectedBounds(): { x: number; y: number; w: number; h: number } | null {
    return boundsOfObjects(this.selectedObjects().map((entry) => entry.object));
  }

  private layerForObject(object: DrawingObject): Layer | null {
    return this.data.layers.find((layer) => layer.objects.includes(object)) ?? null;
  }

  private normalizeSelection(): void {
    for (const id of Array.from(this.selection)) {
      if (!findObject(this.data, id)) this.selection.delete(id);
    }
  }

  selectAll(): void {
    const layer = getActiveLayer(this.data);
    if (!layer || layer.locked || !layer.visible) return;
    this.selection = new Set(
      layer.objects
        .filter((object) => isElementVisible(object) && object.global !== true && !isElementLocked(object) && !isInternalObject(object))
        .map((object) => object.id),
    );
    this.refresh(false);
  }

  clearSelection(): void {
    this.selection.clear();
    this.refresh(false);
  }

  getElements(): DrawingObject[] {
    return getActiveLayer(this.data)?.objects.filter((object) => !isInternalObject(object)) ?? [];
  }

  selectAtClientPoint(clientX: number, clientY: number, additive = false, includeLocked = false): boolean {
    const cell = this.renderer.screenToCell(clientX, clientY, true);
    if (!cell) return false;
    const hit = this.hitTest({ row: Math.max(0, cell.row), col: Math.max(0, cell.col) }, includeLocked);
    if (!hit) {
      if (!additive) {
        this.selection.clear();
        this.refreshOverlay(false);
      }
      return false;
    }
    if (additive) {
      if (this.selection.has(hit.object.id)) this.selection.delete(hit.object.id);
      else this.selection.add(hit.object.id);
    } else if (!this.selection.has(hit.object.id)) {
      this.selection = new Set([hit.object.id]);
    }
    this.data.activeLayerId = hit.layer.id;
    this.selectedLayers = new Set([hit.layer.id]);
    this.refreshOverlay(false);
    return true;
  }

  selectElements(ids: string[], mode: "replace" | "add" | "toggle" = "replace"): void {
    const found = ids
      .map((id) => findObject(this.data, id))
      .filter((item): item is NonNullable<typeof item> => !!item && !isInternalObject(item.object));
    if (mode === "replace") this.selection = new Set();
    for (const item of found) {
      if (mode === "toggle") {
        if (this.selection.has(item.object.id)) this.selection.delete(item.object.id);
        else this.selection.add(item.object.id);
      } else {
        this.selection.add(item.object.id);
      }
    }
    const first = found[0];
    if (first) {
      this.data.activeLayerId = first.layer.id;
      this.selectedLayers = new Set([first.layer.id]);
    }
    this.refreshOverlay(false);
  }

  reorderElement(id: string, targetId: string, above: boolean): void {
    if (id === targetId) return;
    const layer = getActiveLayer(this.data);
    if (!layer) return;
    const source = layer.objects.find((object) => object.id === id);
    if (!source || source.global === true || source.locked === true) return;
    const target = layer.objects.find((object) => object.id === targetId);
    if (!target) return;
    const before = this.snapshot();
    const sourceIndex = layer.objects.indexOf(source);
    if (sourceIndex >= 0) layer.objects.splice(sourceIndex, 1);
    const targetIndex = layer.objects.indexOf(target);
    let insert = targetIndex + (above ? 1 : 0);
    // The global doodle always remains the bottom of the stack.
    insert = Math.max(1, Math.min(layer.objects.length, insert));
    layer.objects.splice(insert, 0, source);
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  getElementLabel(object: DrawingObject): string {
    switch (object.kind) {
      case "rect":
        return "rectangle";
      case "circle":
        return "ellipse";
      case "diamond":
        return "diamond";
      case "line":
        return "line";
      case "cells":
        return object.global ? "global doodle" : "doodle";
      case "group":
        return "group";
      default:
        return "element";
    }
  }

  private elementCells(object: DrawingObject): CellTuple[] {
    const composed = this.composed;
    const doc = new DrawingDocument(composed.cols, composed.rows);
    renderElement(doc, object);
    const cells: CellTuple[] = [];
    for (let r = 0; r < doc.rows; r++) {
      for (let c = 0; c < doc.cols; c++) {
        const raw = doc.raw(r, c);
        if (!raw || raw === " " || raw === "\u0000") continue;
        const glyph = doc.glyphAt(r, c);
        if (!glyph || glyph.continuation) continue;
        cells.push([r, glyph.headCol, glyph.char]);
      }
    }
    return cells;
  }

  private mergeCells(target: CellsObject, cells: CellTuple[]): void {
    const merged = new Map<string, string>();
    for (const [r, c, ch] of target.cells) merged.set(`${r},${c}`, ch);
    for (const [r, c, ch] of cells) merged.set(`${r},${c}`, ch);
    target.cells = Array.from(merged.entries()).map(([key, ch]) => {
      const [r, c] = key.split(",").map(Number);
      return [r, c, ch] as CellTuple;
    });
  }

  private selectionHasLocked(): boolean {
    return this.selectedObjects().some((entry) => isElementLocked(entry.object));
  }

  private containsDoodle(object: DrawingObject): boolean {
    if (object.kind === "cells") return object.role === "draw";
    if (object.kind === "group") return object.children.some((child) => this.containsDoodle(child));
    return false;
  }

  private selectionCanResize(): boolean {
    const objects = this.selectedObjects();
    if (objects.length === 0) return false;
    return objects.every((entry) => entry.object.global !== true && !this.containsDoodle(entry.object) && !isElementLocked(entry.object));
  }

  private selectionHasGlobal(): boolean {
    return this.selectedObjects().some((entry) => entry.object.global === true);
  }

  isGlobalSelection(): boolean {
    const selected = this.selectedObjects();
    return selected.length === 1 && selected[0].object.global === true;
  }

  selectGlobalDoodle(): void {
    const layer = getActiveLayer(this.data) ?? this.data.layers[0];
    if (!layer) return;
    const global = ensureGlobalDoodle(layer);
    this.selection = new Set([global.id]);
    this.data.activeLayerId = layer.id;
    this.selectedLayers = new Set([layer.id]);
    this.refreshOverlay(false);
  }

  private selectedDoodle(): CellsObject | null {
    if (this.selection.size !== 1) return null;
    const object = this.getSelectedObjects()[0];
    if (!object || !isDoodle(object) || object.role !== "draw") return null;
    if (!isElementVisible(object) || isElementLocked(object)) return null;
    return object;
  }

  private selectedNonGlobal(): Array<{ object: DrawingObject; index: number; layer: Layer }> {
    const layer = getActiveLayer(this.data);
    if (!layer) return [];
    return this.selectedObjects()
      .map((entry) => {
        const index = layer.objects.findIndex((object) => object.id === entry.id);
        return { object: entry.object, index, layer };
      })
      .filter((entry) => entry.index >= 0 && !entry.object.global)
      .sort((a, b) => a.index - b.index);
  }

  private replaceSelectionObjects(objects: DrawingObject[], insertAt = -1): void {
    const layer = getActiveLayer(this.data);
    if (!layer) return;
    const selected = this.selectedNonGlobal();
    if (selected.length === 0) return;
    const indices = selected.map((entry) => entry.index);
    const firstIndex = indices[0];
    const targetIndex = insertAt >= 0 ? insertAt : firstIndex;
    const belowTarget = indices.filter((index) => index < targetIndex).length;
    for (let i = indices.length - 1; i >= 0; i--) layer.objects.splice(indices[i], 1);
    const adjusted = Math.max(0, Math.min(layer.objects.length, targetIndex - belowTarget));
    layer.objects.splice(adjusted, 0, ...objects);
    this.selection = new Set(objects.map((object) => object.id));
  }

  convertSelectionToDoodle(global = false): void {
    const selected = this.selectedNonGlobal();
    if (selected.some((entry) => isElementLocked(entry.object))) {
      this.hooks.notify("notice.elementLocked");
      return;
    }
    if (selected.length === 0) {
      this.hooks.notify("notice.nothingSelected");
      return;
    }
    const allCells: CellTuple[] = [];
    for (const entry of selected) allCells.push(...this.elementCells(entry.object));
    const before = this.snapshot();
    const layer = getActiveLayer(this.data);
    if (!layer) return;
    if (global) {
      const globalDoodle = ensureGlobalDoodle(layer);
      if (isElementLocked(globalDoodle)) {
        this.hooks.notify("notice.layerLocked");
        return;
      }
      this.mergeCells(globalDoodle, allCells);
      const ids = new Set(selected.map((entry) => entry.object.id));
      layer.objects = layer.objects.filter((object) => !ids.has(object.id));
      this.selection = new Set([globalDoodle.id]);
    } else {
      const doodle: CellsObject = {
        id: createId("doodle"),
        kind: "cells",
        role: "draw",
        cells: allCells,
      };
      const insertAt = selected[selected.length - 1].index;
      this.replaceSelectionObjects([doodle], insertAt);
    }
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  groupSelection(): void {
    const selected = this.selectedNonGlobal();
    if (selected.length < 2) return;
    if (selected.some((entry) => isElementLocked(entry.object))) {
      this.hooks.notify("notice.elementLocked");
      return;
    }
    const before = this.snapshot();
    const children = selected.map((entry) => cloneObject(entry.object));
    const group: GroupObject = {
      id: createId("group"),
      kind: "group",
      children,
    };
    const insertAt = selected[selected.length - 1].index;
    this.replaceSelectionObjects([group], insertAt);
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  clearGlobalDoodle(): void {
    const layer = getActiveLayer(this.data);
    const global = layer?.objects.find((object) => object.kind === "cells" && object.role === "draw" && object.global === true);
    if (!global || global.kind !== "cells" || global.cells.length === 0) return;
    const before = this.snapshot();
    global.cells = [];
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  setElementVisible(id: string, visible: boolean): void {
    const found = findObject(this.data, id);
    if (!found) return;
    const before = this.snapshot();
    found.object.visible = visible;
    if (visible) found.object.hidden = false;
    if (!visible) this.selection.delete(id);
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  setElementLocked(id: string, locked: boolean): void {
    const found = findObject(this.data, id);
    if (!found) return;
    const before = this.snapshot();
    found.object.locked = locked;
    if (locked) this.selection.delete(id);
    this.pushHistory(before);
    this.refreshOverlay();
    this.hooks.requestSave();
  }

  setSelectionVisible(visible: boolean): void {
    const objects = this.selectedObjects().map((entry) => entry.object);
    if (objects.length === 0) return;
    const before = this.snapshot();
    for (const object of objects) {
      object.visible = visible;
      if (visible) object.hidden = false;
    }
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  toggleSelectionVisible(): void {
    const objects = this.selectedObjects().map((entry) => entry.object);
    if (objects.length === 0) return;
    const allVisible = objects.every((object) => isElementVisible(object));
    this.setSelectionVisible(!allVisible);
  }

  setSelectionLocked(locked: boolean): void {
    const objects = this.selectedObjects().map((entry) => entry.object);
    if (objects.length === 0) return;
    const before = this.snapshot();
    for (const object of objects) object.locked = locked;
    this.pushHistory(before);
    this.refreshOverlay();
    this.hooks.requestSave();
  }

  toggleSelectionLocked(): void {
    const objects = this.selectedObjects().map((entry) => entry.object);
    if (objects.length === 0) return;
    const allLocked = objects.every((object) => object.locked === true);
    this.setSelectionLocked(!allLocked);
  }

  showAllElements(): void {
    const before = this.snapshot();
    let changed = false;
    for (const layer of this.data.layers) {
      for (const object of layer.objects) {
        if (object.visible === false || object.hidden) {
          object.visible = true;
          object.hidden = false;
          changed = true;
        }
      }
    }
    if (!changed) return;
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  unlockAllElements(): void {
    const before = this.snapshot();
    let changed = false;
    for (const layer of this.data.layers) {
      for (const object of layer.objects) {
        if (object.locked) {
          object.locked = false;
          changed = true;
        }
      }
    }
    if (!changed) return;
    this.pushHistory(before);
    this.refreshOverlay();
    this.hooks.requestSave();
  }

  moveSelectionZ(mode: "forward" | "backward" | "front" | "back"): void {
    const layer = getActiveLayer(this.data);
    if (!layer) return;
    const selected = this.selectedObjects();
    if (selected.length === 0) return;
    if (selected.some((entry) => entry.object.global === true)) return;
    if (selected.some((entry) => isElementLocked(entry.object))) {
      this.hooks.notify("notice.elementLocked");
      return;
    }
    const ids = new Set(selected.map((entry) => entry.id));
    const before = this.snapshot();
    const objects = layer.objects;
    const globalIndex = objects.findIndex((object) => object.global === true);
    const protectIndex = globalIndex >= 0 ? 0 : -1;
    if (mode === "front") {
      const moving = objects.filter((object) => ids.has(object.id) && !object.global);
      const rest = objects.filter((object) => !ids.has(object.id) || object.global);
      objects.splice(0, objects.length, ...rest, ...moving);
    } else if (mode === "back") {
      const moving = objects.filter((object) => ids.has(object.id) && !object.global);
      const rest = objects.filter((object) => !ids.has(object.id) || object.global);
      const insert = protectIndex >= 0 ? 1 : 0;
      rest.splice(insert, 0, ...moving);
      objects.splice(0, objects.length, ...rest);
    } else if (mode === "forward") {
      for (let i = objects.length - 2; i >= 0; i--) {
        if (i === protectIndex) continue;
        if (ids.has(objects[i].id) && !ids.has(objects[i + 1].id) && !objects[i + 1].global) {
          [objects[i], objects[i + 1]] = [objects[i + 1], objects[i]];
        }
      }
    } else {
      for (let i = 1; i < objects.length; i++) {
        if (i - 1 === protectIndex) continue;
        if (ids.has(objects[i].id) && !ids.has(objects[i - 1].id) && !objects[i].global) {
          [objects[i], objects[i - 1]] = [objects[i - 1], objects[i]];
        }
      }
    }
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  private refreshOverlay(schedule = true): void {
    this.normalizeSelection();
    const boxes = this.selectedObjects()
      .map((entry) => objectBounds(entry.object))
      .filter((bounds): bounds is { x: number; y: number; w: number; h: number } => !!bounds)
      .map((bounds) => boundsToBox(bounds));
    const union = this.selectedBounds();
    this.renderer.setState({
      doc: this.composed.doc,
      objectBoxes: boxes,
      selection: union ? boundsToBox(union) : null,
      softSelection: this.isGlobalSelection(),
      showHandles: this.selectionCanResize(),
      tool: this.tool,
      emptyHint: allObjects(this.data).length === 0 ? null : null,
    });
    if (schedule) this.renderer.scheduleRender();
    this.hooks.statusChanged();
  }

  deleteSelection(): void {
    if (this.selection.size === 0) {
      this.hooks.notify("notice.nothingSelected");
      return;
    }
    const before = this.snapshot();
    let removed = false;
    for (const id of this.selection) {
      const found = findObject(this.data, id);
      if (!found || found.object.global || isElementLocked(found.object)) continue;
      removeObjectById(this.data, id);
      removed = true;
    }
    if (!removed) {
      this.hooks.notify("notice.elementLocked");
      return;
    }
    this.selection.clear();
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  copySelection(): void {
    const objects = this.selectedObjects()
      .filter((entry) => entry.object.global !== true)
      .map((entry) => cloneObject(entry.object));
    if (objects.length === 0) {
      this.hooks.notify("notice.nothingSelected");
      return;
    }
    this.clipboard = objects;
    this.hooks.notify("notice.copied", { count: objects.length });
  }

  cutSelection(): void {
    this.copySelection();
    if (this.clipboard.length > 0) this.deleteSelection();
  }

  pasteClipboard(): void {
    if (this.clipboard.length === 0) {
      this.hooks.notify("notice.pasteEmpty");
      return;
    }
    const layer = this.requireWritableLayer();
    if (!layer) return;
    const before = this.snapshot();
    const pasted = duplicateObjectsForPaste(this.clipboard, PASTE_OFFSET, PASTE_OFFSET);
    layer.objects.push(...pasted);
    this.selection = new Set(pasted.map((object) => object.id));
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  duplicateSelection(): void {
    if (this.selection.size === 0) {
      this.hooks.notify("notice.nothingSelected");
      return;
    }
    const objects = this.selectedObjects()
      .filter((entry) => entry.object.global !== true)
      .map((entry) => cloneObject(entry.object));
    if (objects.length === 0) return;
    const layer = this.requireWritableLayer();
    if (!layer) return;
    const before = this.snapshot();
    const copies = duplicateObjectsForPaste(objects, PASTE_OFFSET, PASTE_OFFSET);
    layer.objects.push(...copies);
    this.selection = new Set(copies.map((object) => object.id));
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  duplicateSelectionAtCursor(): void {
    const entries = this.selectedObjects().filter((entry) => entry.object.global !== true);
    if (entries.length === 0) {
      this.hooks.notify("notice.nothingSelected");
      return;
    }
    const bounds = boundsOfObjects(entries.map((entry) => entry.object));
    const cursor = this.hover;
    if (!bounds || !cursor) {
      this.hooks.notify("notice.placeCursor");
      return;
    }
    const layer = this.requireWritableLayer();
    if (!layer) return;
    const dx = cursor.col - bounds.x;
    const dy = cursor.row - bounds.y;
    const before = this.snapshot();
    const copies: string[] = [];
    for (const entry of entries) {
      const copy = cloneObject(entry.object);
      copy.id = createId(entry.object.kind);
      translateObject(copy, dy, dx);
      layer.objects.push(copy);
      copies.push(copy.id);
    }
    this.selection = new Set(copies);
    this.data.activeLayerId = layer.id;
    this.selectedLayers = new Set([layer.id]);
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  nudgeSelection(dr: number, dc: number): void {
    if (this.selectionHasGlobal()) return;
    const selected = this.selectedObjects();
    if (selected.length === 0) return;
    const bounds = this.selectedBounds();
    if (!bounds) return;
    const dx = Math.max(dc, -bounds.x);
    const dy = Math.max(dr, -bounds.y);
    if (dx === 0 && dy === 0) return;
    const before = this.snapshot();
    for (const { object } of selected) translateObject(object, dy, dx);
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  alignSelection(align: "left" | "right" | "hcenter" | "vcenter" | "top" | "bottom"): void {
    if (this.selectionHasGlobal()) return;
    const selected = this.selectedObjects();
    if (selected.length < 2) return;
    const union = this.selectedBounds();
    if (!union) return;
    const before = this.snapshot();
    for (const { object } of selected) {
      const b = objectBounds(object);
      if (!b) continue;
      let dx = 0;
      let dy = 0;
      if (align === "left") dx = union.x - b.x;
      else if (align === "right") dx = union.x + union.w - (b.x + b.w);
      else if (align === "hcenter") dx = Math.round(union.x + (union.w - b.w) / 2 - b.x);
      else if (align === "top") dy = union.y - b.y;
      else if (align === "bottom") dy = union.y + union.h - (b.y + b.h);
      else if (align === "vcenter") dy = Math.round(union.y + (union.h - b.h) / 2 - b.y);
      if (dx || dy) translateObject(object, dy, dx);
    }
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  distributeSelection(axis: "horizontal" | "vertical"): void {
    if (this.selectionHasGlobal()) return;
    const selected = this.selectedObjects();
    if (selected.length < 3) return;
    const union = this.selectedBounds();
    if (!union) return;
    const entries = selected
      .map((entry) => ({ entry, bounds: objectBounds(entry.object) }))
      .filter((item): item is { entry: { id: string; object: DrawingObject }; bounds: { x: number; y: number; w: number; h: number } } => !!item.bounds)
      .sort((a, b) => (axis === "horizontal" ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y));
    if (entries.length < 3) return;
    const total = entries.reduce((sum, item) => sum + (axis === "horizontal" ? item.bounds.w : item.bounds.h), 0);
    const span = axis === "horizontal" ? union.w : union.h;
    const gap = (span - total) / (entries.length - 1);
    let cursor = axis === "horizontal" ? union.x : union.y;
    const before = this.snapshot();
    for (const item of entries) {
      const current = axis === "horizontal" ? item.bounds.x : item.bounds.y;
      const target = Math.round(cursor);
      const delta = target - current;
      translateObject(item.entry.object, axis === "vertical" ? delta : 0, axis === "horizontal" ? delta : 0);
      cursor += (axis === "horizontal" ? item.bounds.w : item.bounds.h) + gap;
    }
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  // ------------------------------------------------------------- object props

  private updateSelectedObjects(fn: (object: DrawingObject) => boolean): void {
    const selected = this.selectedObjects();
    if (selected.length === 0) return;
    const before = this.snapshot();
    let changed = false;
    for (const { object } of selected) {
      if (isElementLocked(object)) continue;
      changed = fn(object) || changed;
    }
    if (!changed) return;
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  setSelectedLineStyle(style: StrokeStyle): void {
    this.updateSelectedObjects((object) => {
      if (object.kind !== "line") return false;
      object.style = style;
      return true;
    });
  }

  setSelectedLineRoute(route: LineRoute): void {
    this.updateSelectedObjects((object) => {
      if (object.kind !== "line") return false;
      object.route = route;
      return true;
    });
  }

  setSelectedArrow(which: "start" | "end", style: ArrowStyle): void {
    this.updateSelectedObjects((object) => {
      if (object.kind !== "line") return false;
      if (which === "start") object.arrowStart = style;
      else object.arrowEnd = style;
      return true;
    });
  }

  setSelectedStyle(style: StrokeStyle): void {
    this.updateSelectedObjects((object) => {
      if (object.kind !== "line" && object.kind !== "rect" && object.kind !== "circle" && object.kind !== "diamond") return false;
      object.style = style;
      return true;
    });
  }

  setSelectedFill(fill: string | null): void {
    this.updateSelectedObjects((object) => {
      if (object.kind !== "rect" && object.kind !== "circle" && object.kind !== "diamond") return false;
      object.fill = fill;
      if (object.kind === "rect") {
        object.fillEnabled = fill !== null;
        object.filled = fill !== null;
        if (fill !== null) object.fillMode = fill === "" ? "empty" : "custom";
        if (fill && fill !== "") object.fillChar = fill;
      }
      return true;
    });
  }

  setSelectedFillChar(char: string): void {
    const ch = firstGrapheme(char) || "█";
    const fill = ch === " " ? "" : ch;
    this.updateSelectedObjects((object) => {
      if (object.kind === "rect") {
        object.fill = fill;
        object.fillEnabled = true;
        object.filled = fill !== "";
        object.fillMode = fill === "" ? "empty" : "custom";
        if (fill !== "") object.fillChar = fill;
        return true;
      }
      if (object.kind === "circle" || object.kind === "diamond") {
        object.fill = fill;
        return true;
      }
      return false;
    });
  }

  setSelectedRectFill(mode: RectFillMode, char?: string): void {
    this.updateSelectedObjects((object) => {
      if (object.kind !== "rect") return false;
      object.fillEnabled = true;
      let fill = "";
      if (mode !== "empty") {
        const source = char ?? (object.fill && object.fill !== "" ? object.fill : object.fillChar) ?? "█";
        const grapheme = firstGrapheme(source) || "█";
        fill = grapheme === " " ? "" : grapheme;
      }
      object.fill = fill;
      object.filled = true;
      object.fillMode = mode;
      if (fill !== "") object.fillChar = fill;
      return true;
    });
  }

  setSelectedFilled(filled: boolean): void {
    const first = this.selectedObjects()
      .map((entry) => entry.object)
      .find(
        (object): object is RectObject | CircleObject | DiamondObject =>
          object.kind === "rect" || object.kind === "circle" || object.kind === "diamond",
      );
    const current = first ? getShapeFill(first) : null;
    this.setSelectedFill(filled ? (current && current !== "" ? current : "█") : null);
  }

  private isTextLabel(object: DrawingObject): object is RectObject {
    return object.kind === "rect" && typeof object.text === "string";
  }

  setSelectedRectTextEnabled(enabled: boolean): void {
    this.updateSelectedObjects((object) => {
      if (object.kind !== "rect") return false;
      object.textEnabled = enabled;
      if (enabled) {
        if (typeof object.text !== "string") object.text = "";
        if (!object.font) object.font = this.textFont;
        if (!object.hAlign) object.hAlign = "left";
        if (!object.vAlign) object.vAlign = "top";
        if (!object.direction) object.direction = "horizontal";
        if (!object.wrap) object.wrap = "down";
        if (!object.padding) object.padding = createPadding({ top: 0, right: 1, bottom: 0, left: 1 });
      }
      return true;
    });
  }

  setSelectedRectFillEnabled(enabled: boolean): void {
    this.updateSelectedObjects((object) => {
      if (object.kind !== "rect") return false;
      object.fillEnabled = enabled;
      if (enabled) {
        if (object.fill === null || object.fill === undefined) object.fill = "";
        object.filled = true;
      }
      return true;
    });
  }

  setSelectedRectInterruptEnabled(enabled: boolean): void {
    this.updateSelectedObjects((object) => {
      if (object.kind !== "rect") return false;
      object.interruptEnabled = enabled;
      if (enabled) {
        if (!object.interrupt) object.interrupt = { segment: 2, gap: 2, offset: 0 };
        object.borderless = false;
      }
      return true;
    });
  }

  setSelectedRectInterruptValue(key: keyof RectInterrupt, value: number): void {
    this.updateSelectedObjects((object) => {
      if (object.kind !== "rect") return false;
      if (!object.interrupt) object.interrupt = { segment: 2, gap: 2, offset: 0 };
      if (key === "offset") object.interrupt.offset = clamp(Math.round(value), 0, 9999);
      else object.interrupt[key] = clamp(Math.round(value), 1, 999);
      object.interruptEnabled = true;
      return true;
    });
  }

  setSelectedRectBorderEnabled(enabled: boolean): void {
    this.updateSelectedObjects((object) => {
      if (object.kind !== "rect") return false;
      object.borderless = !enabled;
      return true;
    });
  }

  setSelectedTextFont(font: TextTransform): void {
    this.updateSelectedObjects((object) => {
      if (!this.isTextLabel(object)) return false;
      object.font = font;
      return true;
    });
  }

  setSelectedTextAlign(hAlign: TextAlignH): void {
    this.updateSelectedObjects((object) => {
      if (!this.isTextLabel(object)) return false;
      object.hAlign = hAlign;
      return true;
    });
  }

  setSelectedTextVAlign(vAlign: TextAlignV): void {
    this.updateSelectedObjects((object) => {
      if (!this.isTextLabel(object)) return false;
      object.vAlign = vAlign;
      return true;
    });
  }

  setSelectedTextGrid(hAlign: TextAlignH, vAlign: TextAlignV): void {
    this.updateSelectedObjects((object) => {
      if (!this.isTextLabel(object)) return false;
      object.hAlign = hAlign;
      object.vAlign = vAlign;
      return true;
    });
  }

  setSelectedTextDirection(direction: TextDirection): void {
    this.updateSelectedObjects((object) => {
      if (!this.isTextLabel(object)) return false;
      object.direction = direction;
      object.wrap = direction === "vertical" ? "right" : "down";
      return true;
    });
  }

  setSelectedTextWrap(wrap: TextWrapMode): void {
    this.updateSelectedObjects((object) => {
      if (!this.isTextLabel(object)) return false;
      object.wrap = wrap;
      return true;
    });
  }

  setSelectedTextPadding(side: "top" | "right" | "bottom" | "left", value: number): void {
    this.updateSelectedObjects((object) => {
      if (!this.isTextLabel(object)) return false;
      if (!object.padding) object.padding = createPadding();
      object.padding[side] = clamp(Math.round(value), 0, 20);
      return true;
    });
  }

  // ------------------------------------------------------------------- layers

  getLayers(): Layer[] {
    return this.data.layers;
  }

  getActiveLayer(): Layer | null {
    return getActiveLayer(this.data);
  }

  getSelectedLayerIds(): string[] {
    return Array.from(this.selectedLayers);
  }

  selectLayer(id: string, additive = false): void {
    const layer = getLayer(this.data, id);
    if (!layer) return;
    this.data.activeLayerId = id;
    if (additive) {
      if (this.selectedLayers.has(id)) this.selectedLayers.delete(id);
      else this.selectedLayers.add(id);
    } else {
      this.selectedLayers = new Set([id]);
    }
    this.refresh(false);
    this.hooks.statusChanged();
  }

  addLayer(): void {
    this.change(() => {
      const layer = addLayerToData(this.data);
      this.selectedLayers = new Set([layer.id]);
      this.selection.clear();
    });
  }

  deleteLayer(id: string): void {
    if (this.data.layers.length <= 1) return;
    const before = this.snapshot();
    const index = this.data.layers.findIndex((layer) => layer.id === id);
    if (index < 0) return;
    const layer = this.data.layers[index];
    for (const object of layer.objects) this.selection.delete(object.id);
    this.data.layers.splice(index, 1);
    if (this.data.activeLayerId === id) {
      const next = this.data.layers[Math.min(index, this.data.layers.length - 1)];
      this.data.activeLayerId = next.id;
    }
    this.selectedLayers.delete(id);
    if (this.selectedLayers.size === 0) this.selectedLayers.add(this.data.activeLayerId);
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  renameLayer(id: string, name: string): void {
    const layer = getLayer(this.data, id);
    if (!layer) return;
    const value = name.trim().slice(0, 60);
    if (!value || value === layer.name) return;
    this.change(() => {
      layer.name = value;
    });
  }

  toggleLayerVisibility(id: string): void {
    const layer = getLayer(this.data, id);
    if (!layer) return;
    const before = this.snapshot();
    layer.visible = !layer.visible;
    if (!layer.visible) {
      for (const object of layer.objects) this.selection.delete(object.id);
    }
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  toggleLayerLock(id: string): void {
    const layer = getLayer(this.data, id);
    if (!layer) return;
    const before = this.snapshot();
    layer.locked = !layer.locked;
    if (layer.locked) {
      for (const object of layer.objects) this.selection.delete(object.id);
    }
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  moveLayer(id: string, direction: -1 | 1): void {
    const index = this.data.layers.findIndex((layer) => layer.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= this.data.layers.length) return;
    this.change(() => {
      const [layer] = this.data.layers.splice(index, 1);
      this.data.layers.splice(next, 0, layer);
    });
  }

  mergeLayers(ids: string[], intoNew = false): void {
    const check = canMergeLayers(this.data, ids);
    if (!check.ok) {
      this.hooks.notify(check.reason === "locked" ? "notice.layerLocked" : "notice.selectLayer");
      return;
    }
    const before = this.snapshot();
    const result = mergeLayersInData(this.data, ids, intoNew);
    if (!result) return;
    this.selection.clear();
    this.selectedLayers = new Set([result.targetLayerId]);
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
    this.hooks.notify("notice.layerMerged", { count: result.mergedCount });
  }

  setMinCanvas(cols: number, rows: number): void {
    const c = clamp(Math.round(cols), 4, 1200);
    const r = clamp(Math.round(rows), 4, 800);
    if (c === this.data.minCols && r === this.data.minRows) return;
    this.change(() => {
      this.data.minCols = c;
      this.data.minRows = r;
    });
  }

  // -------------------------------------------------------------------- text

  private requestText(
    request: TextEditRequest,
    beforeOverride?: string,
    createdObjectId?: string,
  ): void {
    this.pendingText = request;
    this.pendingBefore = beforeOverride ?? this.snapshot();
    this.pendingCreatedObjectId = createdObjectId ?? null;
    this.textEditingId = request.objectId;
    this.refreshTextEditingCanvas();
    this.hooks.requestText(request);
  }

  private refreshTextEditingCanvas(): void {
    const cols = this.composed.cols;
    const rows = this.composed.rows;
    const doc = new DrawingDocument(cols, rows);
    const options: RenderElementOptions = { skipTextId: this.textEditingId ?? undefined };
    // Isolate the edited rectangle: elements underneath must not show through
    // the editing text, while its own fill/border remain visible.
    const target = this.textEditingId ? findObject(this.data, this.textEditingId) : null;
    if (target && isElementVisible(target.object)) renderElement(doc, target.object, options);
    this.renderer.setState({ doc, previewBox: null });
  }

  confirmTextRequest(text: string, font?: TextTransform): void {
    const request = this.pendingText;
    if (!request) return;
    const before = this.pendingBefore ?? this.snapshot();
    const found = findObject(this.data, request.objectId);
    if (!found || found.object.kind !== "rect") {
      this.cancelTextRequest();
      return;
    }
    found.object.text = text;
    found.object.textEnabled = true;
    found.object.font = font ?? request.font;
    if (!found.object.hAlign) found.object.hAlign = "left";
    if (!found.object.vAlign) found.object.vAlign = "top";
    if (!found.object.direction) found.object.direction = "horizontal";
    if (!found.object.wrap) found.object.wrap = "down";
    if (!found.object.padding) found.object.padding = createPadding({ top: 0, right: 1, bottom: 0, left: 1 });
    this.selection = new Set([found.object.id]);
    this.pendingText = null;
    this.pendingBefore = null;
    this.pendingCreatedObjectId = null;
    this.textEditingId = null;
    this.renderer.setState({ previewBox: null });
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  cancelTextRequest(): void {
    const createdId = this.pendingCreatedObjectId;
    this.pendingText = null;
    this.pendingBefore = null;
    this.pendingCreatedObjectId = null;
    this.textEditingId = null;
    this.paintDoodle = null;
    this.renderer.setState({ previewBox: null });
    if (createdId) {
      removeObjectById(this.data, createdId);
      this.selection.delete(createdId);
      this.refresh(false);
      return;
    }
    this.refresh(false);
  }

  // ------------------------------------------------------------- pointer tools

  private onPointerDown(e: PointerEvent): void {
    if (!this.hooks.isActive() || this.hooks.isModalOpen()) return;
    if (e.button === 1) {
      this.startPan(e);
      return;
    }
    if (e.button === 2) {
      e.preventDefault();
      if (this.tool === "select") {
        const cell = this.cellAt(e, true);
        if (!cell) return;
        const bounds = this.selection.size > 0 ? this.selectedBounds() : null;
        if (bounds && this.selectionCanResize()) {
          const inside = contains(boundsToBox(bounds), cell.row, cell.col);
          const handle = this.hitHandle(e) ?? (inside ? this.nearestHandle(e, bounds) : null);
          if (handle) {
            this.beginResize(handle, cell, e, true);
            return;
          }
        }
        return;
      }
      if (this.tool === "hand") {
        this.beginTextSelection(e);
        return;
      }
      this.beginToolGesture(e, true);
      return;
    }
    if (e.button !== 0) return;
    if (this.textSelection) this.clearTextSelection();
    if (this.tool === "hand") {
      this.startPan(e);
      return;
    }
    if (this.tool === "select") {
      this.beginSelectGesture(e);
      return;
    }
    this.beginToolGesture(e, false);
  }

  private startPan(e: PointerEvent): void {
    this.gesture = {
      type: "pan",
      startX: e.clientX,
      startY: e.clientY,
      panX: this.renderer.getPan().x,
      panY: this.renderer.getPan().y,
    };
    this.capturePointer(e);
    this.renderer.setState({ panning: true });
    this.updateCursor();
  }

  private pruneErasedElements(): void {
    const layer = getActiveLayer(this.data);
    if (!layer) return;
    const objects = layer.objects;
    const eraseLayers = objects
      .map((object, index) => ({ object, index }))
      .filter((entry): entry is { object: CellsObject; index: number } => entry.object.kind === "cells" && entry.object.role === "erase");
    const removed = new Set<string>();
    for (let index = 0; index < objects.length; index++) {
      const object = objects[index];
      if (object.global === true || !isElementVisible(object) || isElementLocked(object) || isInternalObject(object)) continue;
      const cells = this.elementCells(object);
      if (cells.length === 0) {
        removed.add(object.id);
        continue;
      }
      const coverage = new Set<string>();
      for (const entry of eraseLayers) {
        if (entry.index <= index) continue;
        for (const [r, c] of entry.object.cells) coverage.add(`${r},${c}`);
      }
      if (coverage.size === 0) continue;
      if (cells.every(([r, c]) => coverage.has(`${r},${c}`))) removed.add(object.id);
    }
    if (removed.size === 0) return;
    for (const id of removed) {
      removeObjectById(this.data, id);
      this.selection.delete(id);
    }
  }

  private applyObjectToDoodle(target: CellsObject, object: DrawingObject): void {
    if (object.kind === "cells") {
      if (object.role === "erase") {
        const remove = new Set(object.cells.map(([r, c]) => `${r},${c}`));
        target.cells = target.cells.filter(([r, c]) => !remove.has(`${r},${c}`));
      } else {
        const merged = new Map<string, string>();
        for (const [r, c, ch] of target.cells) merged.set(`${r},${c}`, ch);
        for (const [r, c, ch] of object.cells) merged.set(`${r},${c}`, ch);
        target.cells = Array.from(merged.entries()).map(([key, ch]) => {
          const [r, c] = key.split(",").map(Number);
          return [r, c, ch] as CellTuple;
        });
      }
      return;
    }
    const doc = new DrawingDocument(this.composed.cols, this.composed.rows);
    renderElement(doc, object);
    const cells: CellTuple[] = [];
    for (let r = 0; r < doc.rows; r++) {
      for (let c = 0; c < doc.cols; c++) {
        const glyph = doc.glyphAt(r, c);
        if (glyph && !glyph.continuation && glyph.char !== " " && glyph.char !== "\u3000") {
          cells.push([r, glyph.headCol, glyph.char]);
        }
      }
    }
    const merged = new Map<string, string>();
    for (const [r, c, ch] of target.cells) merged.set(`${r},${c}`, ch);
    for (const [r, c, ch] of cells) merged.set(`${r},${c}`, ch);
    target.cells = Array.from(merged.entries()).map(([key, ch]) => {
      const [r, c] = key.split(",").map(Number);
      return [r, c, ch] as CellTuple;
    });
  }

  private finishDoodleMerge(object: DrawingObject, before: string): boolean {
    const target = this.paintDoodle;
    if (!target) return false;
    this.applyObjectToDoodle(target, object);
    removeObjectById(this.data, object.id);
    if (!target.global && target.cells.length === 0) {
      removeObjectById(this.data, target.id);
      this.selection.clear();
    } else {
      this.selection = new Set([target.id]);
    }
    this.paintDoodle = null;
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
    return true;
  }

  private isDrawingAreaTool(): boolean {
    return this.tool === "pencil" || this.tool === "solidRect" || this.tool === "fill";
  }

  private doodleAtCell(cell: CellPos): CellsObject | null {
    const layer = getActiveLayer(this.data);
    if (!layer) return null;
    for (let i = layer.objects.length - 1; i >= 0; i--) {
      const object = layer.objects[i];
      if (object.global === true || !isElementVisible(object) || isElementLocked(object)) continue;
      if (object.kind !== "cells" || object.role !== "draw") continue;
      if (object.cells.some(([r, c]) => r === cell.row && c === cell.col)) return object;
    }
    return null;
  }

  private focusDoodle(target: CellsObject): void {
    this.selection = new Set([target.id]);
    const layer = getActiveLayer(this.data);
    if (layer) {
      this.data.activeLayerId = layer.id;
      this.selectedLayers = new Set([layer.id]);
    }
    this.refreshOverlay(false);
  }

  private beginToolGesture(e: PointerEvent, erase: boolean): void {
    const cell = this.cellAt(e, true);
    if (!cell) return;
    const layer = this.requireWritableLayer();
    if (!layer) return;
    const start = { row: cell.row, col: cell.col };
    if (this.isDrawingAreaTool()) {
      const target = this.selectedDoodle() ?? this.doodleAtCell(start) ?? ensureGlobalDoodle(layer);
      if (!target || !isElementVisible(target) || isElementLocked(target)) {
        this.hooks.notify("notice.elementLocked");
        return;
      }
      this.paintDoodle = target;
      this.focusDoodle(target);
    } else {
      this.paintDoodle = this.selectedDoodle();
    }
    if (this.tool === "pencil") {
      const before = this.snapshot();
      const object: CellsObject = {
        id: createObjectId(),
        kind: "cells",
        role: erase ? "erase" : "draw",
        cells: [],
      };
      layer.objects.push(object);
      const gesture: Gesture = {
        type: "pencil",
        before,
        object,
        last: start,
        erase,
        changed: false,
      };
      this.gesture = gesture;
      this.capturePointer(e);
      this.addPencilCells(gesture, start, start);
      return;
    }
    if (this.tool === "line") {
      const before = this.snapshot();
      const object: LineObject = {
        id: createObjectId(),
        kind: "line",
        x1: start.col,
        y1: start.row,
        x2: start.col,
        y2: start.row,
        style: this.strokeStyle,
        route: this.route,
        arrowStart: this.arrowStartStyle,
        arrowEnd: erase ? (this.arrowEndStyle === "none" ? "line" : this.arrowEndStyle) : this.arrowEndStyle,
      };
      layer.objects.push(object);
      this.gesture = { type: "shape", before, object, start, current: start, mode: "line", erase, changed: false };
      this.capturePointer(e);
      return;
    }
    if (this.tool === "rect" || this.tool === "solidRect") {
      const before = this.snapshot();
      const solid = this.tool === "solidRect";
      let object: DrawingObject | null = null;
      if (erase) {
        object = { id: createObjectId(), kind: "cells", role: "erase", cells: [] };
      } else if (solid) {
        object = { id: createObjectId(), kind: "cells", role: "draw", cells: [] };
      } else {
        object = {
          id: createObjectId(),
          kind: "rect",
          x: start.col,
          y: start.row,
          w: 1,
          h: 1,
          filled: false,
          fill: null,
          fillEnabled: false,
          fillChar: this.fillChar,
          textEnabled: false,
          style: this.strokeStyle,
        };
      }
      layer.objects.push(object);
      const rectObject = object as RectObject | CellsObject;
      this.gesture = {
        type: "shape",
        before,
        object: rectObject as RectObject,
        start,
        current: start,
        mode: solid ? "solid" : "hollow",
        erase,
        changed: false,
      };
      this.capturePointer(e);
      return;
    }
    if (this.tool === "diamond") {
      const before = this.snapshot();
      let object: DrawingObject | null = null;
      if (erase) object = { id: createObjectId(), kind: "cells", role: "erase", cells: [] };
      else {
        object = {
          id: createObjectId(),
          kind: "diamond",
          x: start.col,
          y: start.row,
          w: 1,
          h: 1,
          style: this.strokeStyle,
        };
      }
      layer.objects.push(object);
      this.gesture = {
        type: "shape",
        before,
        object: object as unknown as RectObject,
        start,
        current: start,
        mode: "diamond",
        erase,
        changed: false,
      };
      this.capturePointer(e);
      return;
    }
    if (this.tool === "circle") {
      const before = this.snapshot();
      let object: DrawingObject | null = null;
      if (erase) object = { id: createObjectId(), kind: "cells", role: "erase", cells: [] };
      else {
        object = {
          id: createObjectId(),
          kind: "circle",
          x: start.col,
          y: start.row,
          w: 1,
          h: 1,
          style: this.strokeStyle,
        };
      }
      layer.objects.push(object);
      this.gesture = { type: "circle", before, object, start, current: start, erase, changed: false };
      this.capturePointer(e);
      return;
    }
    if (this.tool === "fill") {
      if (e.button === 2) this.clearSameRegion(start);
      else this.fillRegion(start);
      return;
    }
  }

  private nearestHandle(e: PointerEvent, bounds: { x: number; y: number; w: number; h: number }): Handle {
    const point = this.renderer.screenPoint(e.clientX, e.clientY);
    const topLeft = this.renderer.cellToScreen(bounds.y, bounds.x);
    const bottomRight = this.renderer.cellToScreen(bounds.y + bounds.h, bounds.x + bounds.w);
    const handles: Array<{ name: Handle; x: number; y: number }> = [
      { name: "nw", x: topLeft.x, y: topLeft.y },
      { name: "ne", x: bottomRight.x, y: topLeft.y },
      { name: "sw", x: topLeft.x, y: bottomRight.y },
      { name: "se", x: bottomRight.x, y: bottomRight.y },
    ];
    return handles.reduce((best, handle) => {
      const bestDistance = (best.x - point.x) ** 2 + (best.y - point.y) ** 2;
      const distance = (handle.x - point.x) ** 2 + (handle.y - point.y) ** 2;
      return distance < bestDistance ? handle : best;
    }).name;
  }

  private beginTextSelection(e: PointerEvent): void {
    const cell = this.cellAt(e, true);
    if (!cell) return;
    const doc = this.composed.doc;
    const start = {
      row: Math.max(0, Math.min(doc.rows - 1, cell.row)),
      col: Math.max(0, Math.min(doc.cols - 1, cell.col)),
    };
    this.selection.clear();
    this.refreshOverlay(false);
    this.textSelection = { r0: start.row, c0: start.col, r1: start.row, c1: start.col };
    this.lastTextSelectionDrag = false;
    this.suppressContextMenuUntil = 0;
    this.gesture = { type: "textSelect", start, current: start, moved: false };
    this.capturePointer(e);
    this.renderer.setState({ textSelection: this.textSelection, previewErase: null, previewBox: null });
    this.hooks.statusChanged();
  }

  private finishTextSelection(e: PointerEvent): void {
    const gesture = this.gesture as Extract<Gesture, { type: "textSelect" }> | null;
    this.gesture = null;
    this.releaseCapture(e);
    if (!gesture || !gesture.moved) {
      this.textSelection = null;
      this.renderer.setState({ textSelection: null });
      this.hooks.statusChanged();
      this.hooks.requestElementContextMenu?.(e.clientX, e.clientY);
      return;
    }
    this.lastTextSelectionDrag = true;
    this.suppressContextMenuUntil = performance.now() + 650;
    this.textSelection = normalizeRect(gesture.start, gesture.current);
    this.renderer.setState({ textSelection: this.textSelection });
    void this.copyTextSelection();
    this.hooks.statusChanged();
  }

  clearTextSelection(): void {
    if (!this.textSelection) return;
    this.textSelection = null;
    this.renderer.setState({ textSelection: null });
    this.hooks.statusChanged();
  }

  isTextSelecting(): boolean {
    return this.gesture?.type === "textSelect";
  }

  shouldSuppressContextMenu(): boolean {
    return this.isTextSelecting() || performance.now() < this.suppressContextMenuUntil;
  }

  consumeTextSelectionDrag(): boolean {
    const value = this.lastTextSelectionDrag;
    this.lastTextSelectionDrag = false;
    return value;
  }

  hasTextSelection(): boolean {
    return this.textSelection !== null;
  }

  private textSelectionArt(): string | null {
    const box = this.textSelection;
    if (!box) return null;
    const doc = this.composed.doc;
    const c0 = Math.max(0, Math.min(doc.cols - 1, box.c0));
    const c1 = Math.max(0, Math.min(doc.cols - 1, box.c1));
    const r0 = Math.max(0, Math.min(doc.rows - 1, box.r0));
    const r1 = Math.max(0, Math.min(doc.rows - 1, box.r1));
    const lines: string[] = [];
    for (let r = r0; r <= r1; r++) {
      let line = "";
      for (let c = c0; c <= c1; ) {
        const glyph = doc.glyphAt(r, c);
        if (!glyph || glyph.continuation) {
          line += " ";
          c += 1;
          continue;
        }
        line += glyph.char;
        c += Math.max(1, glyph.width);
      }
      lines.push(line.replace(/[ \t]+$/u, ""));
    }
    while (lines.length > 0 && lines[0].trim().length === 0) lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) lines.pop();
    if (lines.length === 0) return null;
    return lines.join("\n");
  }

  async copyTextSelection(): Promise<void> {
    const text = this.textSelectionArt();
    if (!text) {
      this.hooks.notify("notice.textCopyEmpty");
      return;
    }
    const ok = await copyTextToClipboard(drawingToMarkdown(text, ""));
    this.hooks.notify(ok ? "notice.textCopied" : "notice.textCopyFailed");
  }

  private beginSelectGesture(e: PointerEvent): void {
    const cell = this.cellAt(e, true);
    if (!cell) return;
    if (this.isGlobalSelection()) {
      this.selection.clear();
      this.refreshOverlay(false);
    }
    const handle = this.hitHandle(e);
    if (handle) {
      this.beginResize(handle, cell, e);
      return;
    }
    const hit = this.hitTest(cell);
    if (hit) {
      const additive = modKey(e);
      const already = this.selection.has(hit.object.id);
      if (additive) {
        if (already) this.selection.delete(hit.object.id);
        else {
          this.selection.add(hit.object.id);
          this.data.activeLayerId = hit.layer.id;
          this.selectedLayers = new Set([hit.layer.id]);
        }
        this.refresh(false);
        return;
      }
      if (!already) {
        this.selection = new Set([hit.object.id]);
      }
      this.data.activeLayerId = hit.layer.id;
      this.selectedLayers = new Set([hit.layer.id]);
      const bounds = this.selectedBounds();
      if (bounds) this.beginMove(cell, bounds, e);
      return;
    }
    if (this.selection.size > 0) {
      const bounds = this.selectedBounds();
      if (bounds && contains(boundsToBox(bounds), cell.row, cell.col)) {
        this.beginMove(cell, bounds, e);
        return;
      }
    }
    if (!modKey(e)) this.selection.clear();
    this.gesture = {
      type: "marquee",
      start: cell,
      current: cell,
      additive: modKey(e),
      moved: false,
    };
    this.capturePointer(e);
    this.renderer.setState({ marquee: { r0: cell.row, c0: cell.col, r1: cell.row, c1: cell.col } });
    this.renderer.scheduleRender();
  }

  private beginMove(cell: CellPos, bounds: { x: number; y: number; w: number; h: number }, e: PointerEvent): void {
    if (this.selectionHasGlobal() || this.selectionHasLocked()) {
      this.hooks.notify("notice.elementLocked");
      return;
    }
    const before = this.snapshot();
    const originals = this.selectedObjects().map((entry) => ({ id: entry.id, object: cloneObject(entry.object) }));
    this.gesture = {
      type: "move",
      before,
      start: cell,
      last: cell,
      originals,
      bounds,
      moved: false,
    };
    this.capturePointer(e);
    this.renderer.setPreviewDoc(null);
    this.renderer.setState({ previewErase: null });
    this.updateCursor();
  }

  private beginResize(handle: Handle, cell: CellPos, e: PointerEvent, right = false): void {
    if (!this.selectionCanResize() || this.selectionHasGlobal() || this.selectionHasLocked()) {
      this.hooks.notify("notice.elementLocked");
      return;
    }
    const bounds = this.selectedBounds();
    if (!bounds) return;
    const before = this.snapshot();
    const originals = this.selectedObjects().map((entry) => ({ id: entry.id, object: cloneObject(entry.object) }));
    this.gesture = {
      type: "resize",
      before,
      handle,
      originals,
      bounds,
      start: cell,
      changed: false,
      right,
      moved: false,
    };
    this.capturePointer(e);
    this.renderer.setPreviewDoc(null);
    this.renderer.setState({ previewErase: null });
    this.updateCursor();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.hooks.isActive() || this.hooks.isModalOpen()) return;
    const cell = this.cellAt(e, true);
    if (cell) {
      this.hover = cell;
      this.renderer.setState({ hover: cell });
      this.scheduleStatus();
    }
    const gesture = this.gesture;
    if (!gesture) {
      this.renderer.scheduleRender();
      return;
    }
    if (gesture.type === "pan") {
      this.renderer.setPan(gesture.panX + e.clientX - gesture.startX, gesture.panY + e.clientY - gesture.startY);
      this.hooks.statusChanged();
      return;
    }
    if (!cell) return;
    if (gesture.type === "textSelect") {
      const doc = this.composed.doc;
      const current = {
        row: Math.max(0, Math.min(doc.rows - 1, cell.row)),
        col: Math.max(0, Math.min(doc.cols - 1, cell.col)),
      };
      gesture.current = current;
      gesture.moved = gesture.moved || current.row !== gesture.start.row || current.col !== gesture.start.col;
      if (gesture.moved) this.suppressContextMenuUntil = performance.now() + 650;
      this.textSelection = normalizeRect(gesture.start, current);
      this.renderer.setState({ textSelection: this.textSelection });
      return;
    }
    if (gesture.type === "pencil") {
      this.addPencilCells(gesture, gesture.last, cell);
      gesture.last = cell;
      this.previewObject(gesture.object);
      return;
    }
    if (gesture.type === "shape") {
      gesture.current = cell;
      this.updateShapePreview(gesture);
      this.previewObject(gesture.object);
      return;
    }
    if (gesture.type === "circle") {
      gesture.current = cell;
      this.updateCirclePreview(gesture);
      this.previewObject(gesture.object);
      return;
    }
    if (gesture.type === "marquee") {
      gesture.current = cell;
      gesture.moved = gesture.start.row !== cell.row || gesture.start.col !== cell.col;
      this.renderer.setState({ marquee: normalizeRect(gesture.start, cell) });
      this.renderer.scheduleRender();
      return;
    }
    if (gesture.type === "move") {
      this.updateMove(gesture, cell);
      return;
    }
    if (gesture.type === "resize") {
      this.updateResize(gesture, cell);
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;
    if (gesture.type === "pan") {
      this.gesture = null;
      this.renderer.setState({ panning: false });
      this.releaseCapture(e);
      return;
    }
    if (gesture.type === "textSelect") {
      this.finishTextSelection(e);
      return;
    }
    if (gesture.type === "pencil") {
      this.finishPencil(gesture, e);
      return;
    }
    if (gesture.type === "shape") {
      this.finishShape(gesture, e);
      return;
    }
    if (gesture.type === "circle") {
      this.finishCircle(gesture, e);
      return;
    }
    if (gesture.type === "marquee") {
      this.finishMarquee(gesture, e);
      return;
    }
    if (gesture.type === "move") {
      this.finishMove(gesture, e);
      return;
    }
    if (gesture.type === "resize") {
      this.finishResize(gesture, e);
      return;
    }
  }

  private capturePointer(e: PointerEvent): void {
    try {
      this.stage.setPointerCapture(e.pointerId);
    } catch {
      /* Synthetic events in tests may not have an active pointer. */
    }
  }

  private releaseCapture(e: PointerEvent): void {
    if (this.stage.hasPointerCapture?.(e.pointerId)) {
      try {
        this.stage.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  private cancelGesture(): void {
    const gesture = this.gesture;
    this.gesture = null;
    this.renderer.setState({ panning: false, marquee: null, previewBox: null });
    if (!gesture) return;
    if (gesture.type === "textSelect") {
      this.textSelection = null;
      this.renderer.setState({ textSelection: null });
    } else if (gesture.type === "pencil") {
      removeObjectById(this.data, gesture.object.id);
    } else if (gesture.type === "shape" && gesture.object) {
      removeObjectById(this.data, gesture.object.id);
    } else if (gesture.type === "circle" && gesture.object) {
      removeObjectById(this.data, gesture.object.id);
    } else if (gesture.type === "move" || gesture.type === "resize") {
      this.data = JSON.parse(gesture.before) as UnidrawData;
    }
    this.paintDoodle = null;
    this.selection.clear();
    this.refresh(false);
  }

  private finishPencil(gesture: Extract<Gesture, { type: "pencil" }>, e: PointerEvent): void {
    this.gesture = null;
    this.releaseCapture(e);
    if (!gesture.changed || gesture.object.cells.length === 0) {
      removeObjectById(this.data, gesture.object.id);
      this.paintDoodle = null;
      this.refresh(false);
      return;
    }
    if (this.finishDoodleMerge(gesture.object, gesture.before)) return;
    if (gesture.erase) this.pruneErasedElements();
    this.pushHistory(gesture.before);
    if (!gesture.erase) this.selection = new Set([gesture.object.id]);
    this.refresh();
    this.hooks.requestSave();
  }

  private finishShape(gesture: Extract<Gesture, { type: "shape" }>, e: PointerEvent): void {
    this.gesture = null;
    this.releaseCapture(e);
    if (gesture.mode === "solid" && !gesture.changed) {
      const object = gesture.object as unknown as CellsObject;
      object.cells = cellsForRect(
        { r0: gesture.start.row, c0: gesture.start.col, r1: gesture.start.row, c1: gesture.start.col },
        true,
        false,
        gesture.erase ? " " : this.fillChar,
      );
    }
    if (gesture.mode !== "line") gesture.changed = true;
    const line = gesture.mode === "line" ? (gesture.object as LineObject) : null;
    const emptyLine = line ? line.x1 === line.x2 && line.y1 === line.y2 : false;
    if (!gesture.changed || emptyLine) {
      removeObjectById(this.data, gesture.object.id);
      this.paintDoodle = null;
      this.refresh(false);
      return;
    }
    if (this.finishDoodleMerge(gesture.object, gesture.before)) return;
    if ((gesture.object as DrawingObject).kind === "cells" && (gesture.object as unknown as CellsObject).role === "erase") this.pruneErasedElements();
    this.pushHistory(gesture.before);
    if (!gesture.erase) this.selection = new Set([gesture.object.id]);
    else this.selection.clear();
    this.refresh();
    this.hooks.requestSave();
  }

  private finishCircle(gesture: Extract<Gesture, { type: "circle" }>, e: PointerEvent): void {
    this.gesture = null;
    this.releaseCapture(e);
    if (!gesture.erase && gesture.object) gesture.changed = true;
    if (!gesture.changed || !gesture.object) {
      if (gesture.object) removeObjectById(this.data, gesture.object.id);
      this.paintDoodle = null;
      this.refresh(false);
      return;
    }
    if (gesture.object && this.finishDoodleMerge(gesture.object, gesture.before)) return;
    if (gesture.erase) this.pruneErasedElements();
    this.pushHistory(gesture.before);
    if (!gesture.erase) this.selection = new Set([gesture.object.id]);
    else this.selection.clear();
    this.refresh();
    this.hooks.requestSave();
  }

  private finishMarquee(gesture: Extract<Gesture, { type: "marquee" }>, e: PointerEvent): void {
    this.gesture = null;
    this.releaseCapture(e);
    this.renderer.setState({ marquee: null });
    if (!gesture.moved) {
      if (!gesture.additive) this.selection.clear();
      this.refresh(false);
      return;
    }
    const box = normalizeRect(gesture.start, gesture.current);
    const found = this.objectsInMarquee(box);
    if (gesture.additive) {
      for (const object of found) this.selection.add(object.id);
    } else {
      this.selection = new Set(found.map((object) => object.id));
    }
    const top = found[found.length - 1];
    if (top) {
      const layer = this.layerForObject(top);
      if (layer) {
        this.data.activeLayerId = layer.id;
        this.selectedLayers = new Set([layer.id]);
      }
    }
    this.refresh(false);
  }

  private finishMove(gesture: Extract<Gesture, { type: "move" }>, e: PointerEvent): void {
    this.gesture = null;
    this.releaseCapture(e);
    if (gesture.moved) {
      this.pushHistory(gesture.before);
      this.refresh();
      this.hooks.requestSave();
    } else {
      this.refresh(false);
    }
  }

  private finishResize(gesture: Extract<Gesture, { type: "resize" }>, e: PointerEvent): void {
    this.gesture = null;
    this.releaseCapture(e);
    if (gesture.right && !gesture.moved) {
      this.refresh(false);
      return;
    }
    if (gesture.right) this.suppressContextMenuUntil = performance.now() + 650;
    if (gesture.changed) {
      this.pushHistory(gesture.before);
      this.refresh();
      this.hooks.requestSave();
    } else {
      this.refresh(false);
    }
  }

  private addPencilCells(gesture: Extract<Gesture, { type: "pencil" }>, from: CellPos, to: CellPos): void {
    const points = bresenham(from, to);
    const existing = new Map(gesture.object.cells.map(([r, c, ch]) => [`${r},${c}`, ch]));
    for (const point of points) {
      const ch = gesture.erase ? " " : this.drawChar;
      const key = `${point.row},${point.col}`;
      if (!existing.has(key)) {
        gesture.object.cells.push([point.row, point.col, ch]);
        existing.set(key, ch);
        gesture.changed = true;
      }
    }
    this.ensureSelectionStillValid();
  }

  private updateShapePreview(gesture: Extract<Gesture, { type: "shape" }>): void {
    const box = normalizeRect(gesture.start, gesture.current);
    gesture.changed = box.r1 > box.r0 || box.c1 > box.c0 || gesture.mode === "line";
    if (gesture.mode === "line") {
      const line = gesture.object as LineObject;
      line.x1 = gesture.start.col;
      line.y1 = gesture.start.row;
      line.x2 = gesture.current.col;
      line.y2 = gesture.current.row;
      return;
    }
    if (gesture.erase || (gesture.object as DrawingObject).kind === "cells") {
      const object = gesture.object as unknown as CellsObject;
      object.cells = cellsForRect(box, gesture.mode === "solid", false, gesture.erase ? " " : this.fillChar);
      return;
    }
    if (gesture.mode === "diamond") {
      const diamond = gesture.object as DiamondObject;
      diamond.x = box.c0;
      diamond.y = box.r0;
      diamond.w = box.c1 - box.c0 + 1;
      diamond.h = box.r1 - box.r0 + 1;
      return;
    }
    const rect = gesture.object as RectObject;
    rect.x = box.c0;
    rect.y = box.r0;
    rect.w = box.c1 - box.c0 + 1;
    rect.h = box.r1 - box.r0 + 1;
  }

  private updateCirclePreview(gesture: Extract<Gesture, { type: "circle" }>): void {
    const box = this.circleBox(gesture.start, gesture.current);
    gesture.changed = box.w > 2 && box.h > 2;
    if (gesture.erase) {
      const object = gesture.object as CellsObject | null;
      if (object) object.cells = cellsForCircle(box);
      return;
    }
    const circle = gesture.object as { x: number; y: number; w: number; h: number } | null;
    if (circle) {
      circle.x = box.x;
      circle.y = box.y;
      circle.w = box.w;
      circle.h = box.h;
    }
  }

  private circleBox(start: CellPos, current: CellPos): { x: number; y: number; w: number; h: number } {
    const metrics = this.renderer.getBaseCellMetrics();
    const box = normalizeRect(start, current);
    const boxW = box.c1 - box.c0 + 1;
    const boxH = box.r1 - box.r0 + 1;
    const diameterPx = Math.max(metrics.w, Math.min(boxW * metrics.w, boxH * metrics.h));
    const widthCells = Math.max(3, Math.round(diameterPx / metrics.w));
    const heightCells = Math.max(3, Math.round(diameterPx / metrics.h));
    const centerCol = (box.c0 + box.c1) / 2;
    const centerRow = (box.r0 + box.r1) / 2;
    return {
      x: Math.max(0, Math.round(centerCol - (widthCells - 1) / 2)),
      y: Math.max(0, Math.round(centerRow - (heightCells - 1) / 2)),
      w: widthCells,
      h: heightCells,
    };
  }

  private updateMove(gesture: Extract<Gesture, { type: "move" }>, cell: CellPos): void {
    const rawDx = cell.col - gesture.start.col;
    const rawDy = cell.row - gesture.start.row;
    const dx = Math.max(-gesture.bounds.x, rawDx);
    const dy = Math.max(-gesture.bounds.y, rawDy);
    if (dx === 0 && dy === 0 && !gesture.moved) {
      this.renderer.scheduleRender();
      return;
    }
    if (dx !== 0 || dy !== 0) gesture.moved = true;
    for (const original of gesture.originals) {
      const found = findObject(this.data, original.id);
      if (!found) continue;
      found.object = cloneObject(original.object);
      const layer = found.layer;
      const index = layer.objects.findIndex((object) => object.id === original.id);
      if (index >= 0) layer.objects[index] = found.object;
      translateObject(found.object, dy, dx);
    }
    this.refresh(false);
  }

  private updateResize(gesture: Extract<Gesture, { type: "resize" }>, cell: CellPos): void {
    gesture.moved = true;
    const orig = gesture.bounds;
    const minSize = 1;
    let x = orig.x;
    let y = orig.y;
    let w = orig.w;
    let h = orig.h;
    const anchorX = gesture.handle === "ne" || gesture.handle === "se" ? orig.x : orig.x + orig.w;
    const anchorY = gesture.handle === "sw" || gesture.handle === "se" ? orig.y : orig.y + orig.h;
    if (gesture.handle === "nw" || gesture.handle === "sw") {
      const right = orig.x + orig.w;
      x = Math.min(cell.col, right - minSize);
      w = right - x;
    } else {
      const left = orig.x;
      x = left;
      w = Math.max(minSize, cell.col - left + 1);
    }
    if (gesture.handle === "nw" || gesture.handle === "ne") {
      const bottom = orig.y + orig.h;
      y = Math.min(cell.row, bottom - minSize);
      h = bottom - y;
    } else {
      const top = orig.y;
      y = top;
      h = Math.max(minSize, cell.row - top + 1);
    }
    x = Math.max(0, x);
    y = Math.max(0, y);
    const single = gesture.originals.length === 1;
    if (single) {
      const object = gesture.originals[0].object;
      if (object.kind === "circle") {
        const ratio = orig.h / Math.max(1, orig.w);
        h = Math.max(1, Math.round(w * ratio));
        if (gesture.handle === "nw" || gesture.handle === "ne") y = anchorY - h;
        if (gesture.handle === "nw" || gesture.handle === "sw") x = anchorX - w;
        x = Math.max(0, x);
        y = Math.max(0, y);
      }
    } else {
      const sx = (w) / Math.max(1, orig.w);
      const sy = (h) / Math.max(1, orig.h);
      const scale = Math.max(0.05, Math.max(sx, sy));
      const nextW = Math.max(1, Math.round(orig.w * scale));
      const nextH = Math.max(1, Math.round(orig.h * scale));
      if (gesture.handle === "nw" || gesture.handle === "sw") x = anchorX - nextW;
      if (gesture.handle === "nw" || gesture.handle === "ne") y = anchorY - nextH;
      x = Math.max(0, x);
      y = Math.max(0, y);
      w = nextW;
      h = nextH;
    }
    x = Math.max(0, x);
    y = Math.max(0, y);
    w = Math.max(1, w);
    h = Math.max(1, h);
    gesture.changed = true;
    const newBounds = { x, y, w, h };
    for (const original of gesture.originals) {
      const found = findObject(this.data, original.id);
      if (!found) continue;
      const oldBounds = objectBounds(original.object);
      if (!oldBounds) continue;
      const layer = found.layer;
      const index = layer.objects.findIndex((object) => object.id === original.id);
      if (index < 0) continue;
      if (single) {
        setObjectBounds(found.object, newBounds);
      } else {
        const relX = oldBounds.x - orig.x;
        const relY = oldBounds.y - orig.y;
        const scaleX = w / Math.max(1, orig.w);
        const scaleY = h / Math.max(1, orig.h);
        const scaled = {
          x: Math.round(x + relX * scaleX),
          y: Math.round(y + relY * scaleY),
          w: Math.max(1, Math.round(oldBounds.w * scaleX)),
          h: Math.max(1, Math.round(oldBounds.h * scaleY)),
        };
        setObjectBounds(found.object, scaled);
      }
      layer.objects[index] = found.object;
    }
    this.refresh(false);
  }

  // ------------------------------------------------------------------ hit test

  private hitTest(cell: CellPos, includeLocked = false): { layer: Layer; object: DrawingObject } | null {
    for (let li = this.data.layers.length - 1; li >= 0; li--) {
      const layer = this.data.layers[li];
      if (!layer.visible || layer.locked) continue;
      for (let oi = layer.objects.length - 1; oi >= 0; oi--) {
        const object = layer.objects[oi];
        if (!isElementVisible(object) || object.global === true || (!includeLocked && isElementLocked(object)) || isInternalObject(object)) continue;
        if (this.hitObject(object, cell)) return { layer, object };
      }
    }
    return null;
  }

  private hitObject(object: DrawingObject, cell: CellPos): boolean {
    const bounds = objectBounds(object);
    if (!bounds) return false;
    if (cell.col < bounds.x || cell.col >= bounds.x + bounds.w || cell.row < bounds.y || cell.row >= bounds.y + bounds.h) {
      return false;
    }
    if (object.kind === "cells") {
      return object.cells.some(([r, c]) => r === cell.row && c === cell.col);
    }
    if (object.kind === "line") {
      const cells = rasterizeForHit(object);
      for (const key of cells) {
        const [r, c] = key.split(",").map(Number);
        if (Math.abs(r - cell.row) <= 1 && Math.abs(c - cell.col) <= 1) return true;
      }
      return false;
    }
    return true;
  }

  private objectsInMarquee(box: SelectionRect): DrawingObject[] {
    const found: DrawingObject[] = [];
    for (const layer of this.data.layers) {
      if (!layer.visible || layer.locked) continue;
      for (const object of layer.objects) {
        if (!isElementVisible(object) || object.global === true || isElementLocked(object) || isInternalObject(object)) continue;
        const bounds = objectBounds(object);
        if (!bounds) continue;
        if (insideBox(boundsToBox(bounds), box)) found.push(object);
      }
    }
    return found;
  }

  private hitHandle(e: PointerEvent): Handle | null {
    if (!this.selectionCanResize()) return null;
    const bounds = this.selectedBounds();
    if (!bounds) return null;
    const point = this.renderer.screenPoint(e.clientX, e.clientY);
    const topLeft = this.renderer.cellToScreen(bounds.y, bounds.x);
    const bottomRight = this.renderer.cellToScreen(bounds.y + bounds.h, bounds.x + bounds.w);
    const handles: Array<{ name: Handle; x: number; y: number }> = [
      { name: "nw", x: topLeft.x, y: topLeft.y },
      { name: "ne", x: bottomRight.x, y: topLeft.y },
      { name: "sw", x: topLeft.x, y: bottomRight.y },
      { name: "se", x: bottomRight.x, y: bottomRight.y },
    ];
    for (const handle of handles) {
      if (Math.abs(point.x - handle.x) <= HANDLE_HIT && Math.abs(point.y - handle.y) <= HANDLE_HIT) {
        return handle.name;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- dual ops

  private fillRegion(cell: CellPos): void {
    const layer = this.requireWritableLayer();
    if (!layer) return;
    const doc = this.layerDocFor(layer);
    const target = this.charIn(doc, cell);
    if (target === this.fillChar) return;
    const cells = floodRegion(doc, cell, target);
    if (cells.length === 0) return;
    const before = this.snapshot();
    const object: CellsObject = {
      id: createObjectId(),
      kind: "cells",
      role: "draw",
      cells: cells.map((point) => [point.row, point.col, this.fillChar]),
    };
    layer.objects.push(object);
    if (this.paintDoodle) {
      this.finishDoodleMerge(object, before);
      return;
    }
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  private clearSameRegion(cell: CellPos): void {
    const layer = this.requireWritableLayer();
    if (!layer) return;
    const doc = this.layerDocFor(layer);
    const target = this.charIn(doc, cell);
    if (target === " " || target === "") return;
    const cells = floodRegion(doc, cell, target);
    if (cells.length === 0) return;
    const before = this.snapshot();
    const object: CellsObject = {
      id: createObjectId(),
      kind: "cells",
      role: "erase",
      cells: cells.map((point) => [point.row, point.col, " "]),
    };
    layer.objects.push(object);
    if (this.paintDoodle) {
      this.finishDoodleMerge(object, before);
      return;
    }
    this.pruneErasedElements();
    this.pushHistory(before);
    this.refresh();
    this.hooks.requestSave();
  }

  private charIn(doc: DrawingDocument, cell: CellPos): string {
    const glyph = doc.glyphAt(cell.row, cell.col);
    return glyph?.char ?? " ";
  }

  private layerDocFor(layer: Layer): DrawingDocument {
    const composed = composeData(this.data);
    const doc = new DrawingDocument(composed.cols, composed.rows);
    for (const object of layer.objects) {
      if (isElementVisible(object)) renderElement(doc, object);
    }
    return doc;
  }

  // ------------------------------------------------------------------ modal

  requestEditText(object: RectObject): void {
    object.textEnabled = true;
    this.requestText({
      objectId: object.id,
      box: boxFromBounds(object.x, object.y, object.w, object.h),
      text: object.text ?? "",
      font: object.font ?? "normal",
    });
  }

  private onDoubleClick(e: MouseEvent): void {
    if (!this.hooks.isActive() || this.hooks.isModalOpen()) return;
    if (this.tool !== "select") return;
    const cell = this.cellAt(e, true);
    if (!cell) return;
    const hit = this.hitTest(cell);
    if (!hit) {
      this.createQuickTextBox(cell);
      return;
    }
    const object = hit.object;
    if (object.kind === "rect" && typeof object.text === "string") {
      this.selection = new Set([object.id]);
      this.data.activeLayerId = hit.layer.id;
      this.selectedLayers = new Set([hit.layer.id]);
      this.refreshOverlay(false);
      this.requestEditText(object);
    }
  }

  private createQuickTextBox(cell: CellPos): void {
    const layer = this.requireWritableLayer();
    if (!layer) return;
    const before = this.snapshot();
    const object: RectObject = {
      id: createObjectId(),
      kind: "rect",
      x: cell.col,
      y: cell.row,
      w: 20,
      h: 5,
      filled: false,
      fillChar: " ",
      fill: null,
      fillEnabled: false,
      style: "light",
      borderless: true,
      textEnabled: true,
      text: "",
      font: this.textFont,
      hAlign: "left",
      vAlign: "top",
      direction: "horizontal",
      wrap: "down",
      padding: createPadding({ top: 0, right: 1, bottom: 0, left: 1 }),
    };
    layer.objects.push(object);
    this.data.activeLayerId = layer.id;
    this.selectedLayers = new Set([layer.id]);
    this.selection = new Set([object.id]);
    this.refresh();
    this.requestText(
      {
        objectId: object.id,
        box: boxFromBounds(object.x, object.y, object.w, object.h),
        text: object.text ?? "",
        font: object.font ?? "normal",
      },
      before,
      object.id,
    );
  }

  // ----------------------------------------------------------------- helpers

  private requireWritableLayer(): Layer | null {
    const layer = getActiveLayer(this.data);
    if (!layer) return null;
    if (layer.locked) {
      this.hooks.notify("notice.layerLocked");
      return null;
    }
    if (!layer.visible) {
      this.hooks.notify("notice.layerHidden");
      return null;
    }
    return layer;
  }

  private cellAt(e: MouseEvent, allowOutside: boolean): CellPos | null {
    const cell = this.renderer.screenToCell(e.clientX, e.clientY, allowOutside);
    if (!cell) return null;
    return { row: Math.max(0, cell.row), col: Math.max(0, cell.col) };
  }

  private clearHover(): void {
    if (!this.hover) return;
    this.hover = null;
    this.renderer.setState({ hover: null });
    this.renderer.scheduleRender();
    this.hooks.statusChanged();
  }

  private scheduleStatus(): void {
    if (this.statusRaf) return;
    this.statusRaf = window.requestAnimationFrame(() => {
      this.statusRaf = 0;
      this.hooks.statusChanged();
    });
  }

  private previewObject(object: DrawingObject | null): void {
    if (!object) {
      this.renderer.setPreviewDoc(null);
      this.renderer.setState({ previewErase: null });
      return;
    }
    if (object.kind === "cells" && object.role === "erase") {
      const bounds = objectBounds(object);
      this.renderer.setPreviewDoc(null);
      this.renderer.setState({ previewErase: bounds ? boundsToBox(bounds) : null });
      return;
    }
    this.renderer.setState({ previewErase: null });
    const doc = new DrawingDocument(this.composed.cols, this.composed.rows);
    renderElement(doc, object);
    this.renderer.setPreviewDoc(doc);
  }

  private refresh(schedule = true): void {
    this.renderer.setPreviewDoc(null);
    this.renderer.setState({ previewErase: null });
    this.normalizeSelection();
    const composed = composeData(this.data);
    this.composed = composed;
    const boxes = this.selectedObjects()
      .map((entry) => objectBounds(entry.object))
      .filter((bounds): bounds is { x: number; y: number; w: number; h: number } => !!bounds)
      .map((bounds) => boundsToBox(bounds));
    const union = this.selectedBounds();
    this.renderer.setState({
      doc: composed.doc,
      objectBoxes: boxes,
      selection: union ? boundsToBox(union) : null,
      softSelection: this.isGlobalSelection(),
      showHandles: this.selectionCanResize(),
      tool: this.tool,
      emptyHint: this.data.layers.every((layer) =>
        layer.objects.every((object) => {
          if (object.kind === "cells") return object.cells.length === 0;
          return false;
        }),
      )
        ? { title: this.t("empty.title"), subtitle: this.t("empty.subtitle") }
        : null,
    });
    if (schedule) this.renderer.scheduleRender();
    this.hooks.statusChanged();
  }

  private ensureSelectionStillValid(): void {
    this.normalizeSelection();
  }

  // ------------------------------------------------------------- view controls

  zoomIn(): void {
    this.renderer.zoomIn();
    this.hooks.statusChanged();
  }

  zoomOut(): void {
    this.renderer.zoomOut();
    this.hooks.statusChanged();
  }

  resetZoom(): void {
    this.renderer.resetZoom();
    this.hooks.statusChanged();
  }

  fitView(): void {
    this.renderer.fit();
    this.hooks.statusChanged();
  }

  getZoom(): number {
    return this.renderer.getZoom();
  }

  private onWheel(e: WheelEvent): void {
    if (!this.hooks.isActive() || this.hooks.isModalOpen()) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey) {
      this.renderer.panBy(-e.deltaY - e.deltaX, 0);
      this.hooks.statusChanged();
      return;
    }
    if (mod) {
      this.renderer.panBy(0, -e.deltaY);
      this.hooks.statusChanged();
      return;
    }
    const anchor = this.renderer.screenPoint(e.clientX, e.clientY);
    this.renderer.setZoom(this.renderer.getZoom() * factor, anchor);
    this.hooks.statusChanged();
  }

  private updateCursor(): void {
    const canvas = this.renderer.canvas;
    if (this.tool === "hand") canvas.style.cursor = "grab";
    else if (this.tool === "select") canvas.style.cursor = "default";
    else canvas.style.cursor = "crosshair";
  }

  // --------------------------------------------------------------- keyboard

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.hooks.isActive()) return;
    if (isTypingTarget(e.target)) return;
    if (e.key === " " && !this.spaceDown) {
      if (this.hooks.isModalOpen()) return;
      this.spaceDown = true;
      this.preSpaceTool = this.tool;
      e.preventDefault();
      if (this.tool !== "hand") this.setTool("hand");
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      return;
    }
    if (this.hooks.isModalOpen()) return;
    if (e.key === "Enter" && this.tool === "select") {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("button, .unidraw-element-row")) return;
      const selected = this.selectedObjects();
      if (selected.length === 1 && selected[0].object.kind === "rect" && !isElementLocked(selected[0].object)) {
        e.preventDefault();
        this.setSelectedRectTextEnabled(true);
        this.requestEditText(selected[0].object);
        return;
      }
    }
    const mod = modKey(e);
    const key = e.key.toLowerCase();
    if (mod && key === "d") {
      e.preventDefault();
      this.duplicateSelectionAtCursor();
      return;
    }
    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && key === "y") {
      e.preventDefault();
      this.redo();
      return;
    }
    if (mod && key === "a") {
      e.preventDefault();
      this.selectAll();
      return;
    }
    if (mod && key === "c") {
      e.preventDefault();
      if (this.textSelection) void this.copyTextSelection();
      else this.copySelection();
      return;
    }
    if (mod && key === "x") {
      e.preventDefault();
      this.cutSelection();
      return;
    }
    if (mod && key === "v") {
      e.preventDefault();
      this.pasteClipboard();
      return;
    }
    if (key === "delete" || key === "backspace") {
      if (this.selection.size > 0) {
        e.preventDefault();
        this.deleteSelection();
      }
      return;
    }
    if (key === "escape") {
      e.preventDefault();
      if (this.gesture) this.cancelGesture();
      else if (this.textSelection) this.clearTextSelection();
      else if (this.isGlobalSelection()) this.clearSelection();
      else this.selectGlobalDoodle();
      return;
    }
    if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
      e.preventDefault();
      this.hooks.openHelp();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = e.shiftKey ? 5 : 1;
      const dr = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      const dc = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      if (this.selection.size > 0) this.nudgeSelection(dr, dc);
      else this.renderer.panBy(-dc * 12, -dr * 12);
      return;
    }
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      this.zoomIn();
      return;
    }
    if (e.key === "-") {
      e.preventDefault();
      this.zoomOut();
      return;
    }
    if (e.key === "0") {
      e.preventDefault();
      this.fitView();
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.shiftKey && key === "r") {
      e.preventDefault();
      this.setTool("solidRect");
      return;
    }
    const tools: Record<string, ToolId> = {
      v: "select",
      h: "hand",
      b: "pencil",
      l: "line",
      r: "rect",
      g: "fill",
      o: "circle",
      d: "diamond",
    };
    const tool = tools[key];
    if (tool) {
      e.preventDefault();
      this.setTool(tool);
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key === " ") {
      this.spaceDown = false;
      const previous = this.preSpaceTool;
      this.preSpaceTool = null;
      if (previous && previous !== "hand" && this.tool === "hand") this.setTool(previous);
      this.updateCursor();
    }
  }

}

// ------------------------------------------------------------------ utilities

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

function cellsForRect(box: SelectionRect, filled: boolean, hollow: boolean, ch = " "): [number, number, string][] {
  const cells: [number, number, string][] = [];
  const add = (r: number, c: number) => cells.push([r, c, ch]);
  if (filled) {
    for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) add(r, c);
    return cells;
  }
  if (hollow) {
    for (let r = box.r0; r <= box.r1; r++) {
      for (let c = box.c0; c <= box.c1; c++) {
        if (r === box.r0 || r === box.r1 || c === box.c0 || c === box.c1) add(r, c);
      }
    }
    return cells;
  }
  for (let c = box.c0; c <= box.c1; c++) {
    add(box.r0, c);
    add(box.r1, c);
  }
  for (let r = box.r0 + 1; r < box.r1; r++) {
    add(r, box.c0);
    add(r, box.c1);
  }
  return cells;
}

function cellsForCircle(box: { x: number; y: number; w: number; h: number }): [number, number, string][] {
  const w = Math.max(1, box.w);
  const h = Math.max(1, box.h);
  const local = new DrawingDocument(w, h);
  drawEllipse(local, { row: 0, col: 0 }, { row: h - 1, col: w - 1 }, { style: "light", fill: "none" });
  const cells: [number, number, string][] = [];
  for (let r = 0; r < h; r++) {
    let left = -1;
    let right = -1;
    for (let c = 0; c < w; c++) {
      const raw = local.raw(r, c);
      if (raw && raw !== " ") {
        if (left < 0) left = c;
        right = c;
      }
    }
    if (left < 0) continue;
    for (let c = left; c <= right; c++) cells.push([box.y + r, box.x + c, " "]);
  }
  return cells;
}

function floodRegion(doc: DrawingDocument, start: CellPos, target: string): CellPos[] {
  if (start.row < 0 || start.col < 0 || start.row >= doc.rows || start.col >= doc.cols) return [];
  const seen = new Set<string>();
  const result: CellPos[] = [];
  const queue: CellPos[] = [start];
  const max = Math.max(1, Math.min(250000, doc.cols * doc.rows));
  while (queue.length > 0 && result.length < max) {
    const point = queue.pop() as CellPos;
    const key = `${point.row},${point.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (point.row < 0 || point.col < 0 || point.row >= doc.rows || point.col >= doc.cols) continue;
    const glyph = doc.glyphAt(point.row, point.col);
    const ch = glyph?.char ?? " ";
    if (ch !== target) continue;
    result.push(point);
    queue.push({ row: point.row + 1, col: point.col });
    queue.push({ row: point.row - 1, col: point.col });
    queue.push({ row: point.row, col: point.col + 1 });
    queue.push({ row: point.row, col: point.col - 1 });
  }
  return result;
}

function rasterizeForHit(object: DrawingObject): Set<string> {
  const bounds = objectBounds(object);
  if (!bounds) return new Set();
  const doc = new DrawingDocument(Math.max(1, bounds.x + bounds.w), Math.max(1, bounds.y + bounds.h));
  renderElement(doc, object);
  const result = new Set<string>();
  for (let r = 0; r < doc.rows; r++) {
    for (let c = 0; c < doc.cols; c++) {
      const raw = doc.raw(r, c);
      if (raw && raw !== " " && raw !== WIDE_CONT) result.add(`${r},${c}`);
    }
  }
  return result;
}

function createObjectId(): string {
  return createIdFromCrypto();
}

function createIdFromCrypto(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const __editorInternals = {
  cellsForRect,
  cellsForCircle,
  floodRegion,
  arrowStyleIcon,
};
