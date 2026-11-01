import {
  createTranslator,
  resolveLanguage,
  type Language,
  type LanguageSetting,
  type MessageKey,
  type Translator,
} from "../core/i18n";
import type {
  ArrowStyle,
  EditorSettings,
  GridMode,
  LineRoute,
  SaveState,
  StrokeStyle,
  TextAlignH,
  TextAlignV,
  TextDirection,
  TextTransform,
  TextWrapMode,
  ToolId,
} from "../core/types";
import { drawingToMarkdown } from "../core/format";
import { getShapeFill, type DrawingObject, type Layer, type RectObject, type UnidrawData } from "../core/objects";
import { codePointLabel, firstGrapheme, widthLabel } from "../core/unicode";
import { Editor, type EditorStatus, type TextEditRequest } from "../editor/editor";
import { STROKE_SAMPLES } from "../glyphs/box";
import { TEXT_TRANSFORM_SAMPLES, TEXT_TRANSFORMS } from "../glyphs/text-styles";
import {
  canvasToBlob,
  copyImageToClipboard,
  copyTextToClipboard,
  downloadBlob,
  renderDrawingImage,
} from "../render/export-image";
import { CHAR_CATEGORIES, TEMPLATES, TOOL_DEFS, TOOL_GROUPS, type DrawingTemplate, type ToolDef } from "./data";

export interface UnidrawUISettings extends EditorSettings {
  language: LanguageSetting;
}

export interface UnidrawUIHost {
  icon: (el: HTMLElement, name: string) => void;
  tooltip: (el: HTMLElement, text: string) => void;
  isActive: () => boolean;
  getSettings: () => UnidrawUISettings;
  getVersion: () => string;
  requestSave: () => void;
  saveNow: () => void;
  getFileName: () => string;
  insertIntoNote: (markdown: string) => boolean;
  savePluginSettings?: () => void;
}

interface PopoverHandle {
  el: HTMLElement;
  anchor: HTMLElement | null;
  close: () => void;
}

const ICON_FALLBACKS: Record<string, string> = {
  "mouse-pointer-2": "↖",
  "hand": "✋",
  "pencil": "✎",
  "paint-bucket": "▨",
  "minus": "─",
  "square": "□",
  "circle": "○",
  "type": "T",
  "sparkles": "✦",
  "undo-2": "↶",
  "redo-2": "↷",
  "grid": "▦",
  "zoom-in": "+",
  "zoom-out": "−",
  "maximize": "⤢",
  "layout-template": "▤",
  "help-circle": "?",
  "download": "↓",
  "x": "×",
  "file-text": "≡",
  "code": "⌘",
  "image": "▣",
  "plus": "+",
  "layers": "▤",
  "eye": "◉",
  "eye-off": "○",
  "lock": "▣",
  "unlock": "□",
  "chevron-up": "⌃",
  "chevron-down": "⌄",
  "ellipsis-vertical": "⋮",
  "trash": "×",
  "align-left": "⇤",
  "align-center": "↔",
  "align-right": "⇥",
  "align-start-vertical": "⇧",
  "align-center-vertical": "↕",
  "align-end-vertical": "⇩",
  "merge": "⇊",
  "panel-left": "▥",
  "panel-right": "▥",
  "check": "✓",
  "save": "⌘S",
  "copy": "⧉",
  "move-up-right": "→",
  "rotate-cw": "↻",
  "braille": "⠿",
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

function isMacLike(): boolean {
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

function keyCombos(): { mod: string; shift: string; alt: string } {
  return isMacLike() ? { mod: "⌘", shift: "⇧", alt: "⌥" } : { mod: "Ctrl", shift: "Shift", alt: "Alt" };
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  return cleaned || "unidraw-drawing";
}

function setIconSafe(host: UnidrawUIHost, target: HTMLElement, name: string): void {
  try {
    host.icon(target, name);
  } catch {
    /* fall back below */
  }
  if (!target.firstElementChild) {
    target.classList.add("unidraw-icon-fallback");
    target.textContent = ICON_FALLBACKS[name] ?? "•";
  }
}

function arrowGlyph(style: ArrowStyle): string {
  return style === "none" ? "—" : style === "line" ? "→" : style === "hollow" ? "▷" : "▶";
}

export class UnidrawEditorUI {
  private container: HTMLElement;
  private host: UnidrawUIHost;
  private settings: UnidrawUISettings;
  private language: Language;
  private t: Translator;
  private root: HTMLDivElement;
  private headerEl: HTMLElement;
  private stylebarEl: HTMLDivElement;
  private workspaceEl: HTMLDivElement;
  private inspectorEl: HTMLElement;
  private stageWrap: HTMLDivElement;
  private stageEl: HTMLDivElement;
  private layersEl: HTMLElement;
  private elementsCard: HTMLElement;
  private statusEl: HTMLElement;
  private toastLayer: HTMLDivElement;
  private popoverLayer: HTMLDivElement;
  private modalLayer: HTMLDivElement;
  private editor: Editor;
  private abort = new AbortController();
  private toolButtons = new Map<ToolId, HTMLButtonElement>();
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;
  private gridBtn: HTMLButtonElement | null = null;
  private gridSelect: HTMLSelectElement | null = null;
  private zoomLabel: HTMLButtonElement | null = null;
  private saveDot: HTMLSpanElement | null = null;
  private saveText: HTMLSpanElement | null = null;
  private posEl: HTMLSpanElement | null = null;
  private charEl: HTMLSpanElement | null = null;
  private selectionStatusEl: HTMLSpanElement | null = null;
  private layerStatusEl: HTMLSpanElement | null = null;
  private canvasStatusEl: HTMLSpanElement | null = null;
  private zoomEl: HTMLSpanElement | null = null;
  private hintEl: HTMLSpanElement | null = null;
  private styleHintEl: HTMLSpanElement | null = null;
  private popover: PopoverHandle | null = null;
  private helpEl: HTMLElement | null = null;
  private textModalEl: HTMLElement | null = null;
  private textRequest: TextEditRequest | null = null;
  private textCommit: (() => void) | null = null;
  private renamingLayerId: string | null = null;
  private styleSig = "";
  private layerSig = "";
  private inspectorSig = "";
  private elementListSig = "";
  private elementListAnchorId: string | null = null;
  private elementListDraggingId: string | null = null;
  private elementRowMenuEl: HTMLElement | null = null;
  private elementRowMenuCleanup: (() => void) | null = null;
  private toastTimers: number[] = [];

  constructor(container: HTMLElement, host: UnidrawUIHost) {
    this.container = container;
    this.host = host;
    this.settings = host.getSettings();
    this.language = resolveLanguage(this.settings.language);
    this.t = createTranslator(this.language);

    this.root = el("div", "unidraw-root", container);
    this.headerEl = el("header", "unidraw-header", this.root);
    this.stylebarEl = el("div", "unidraw-stylebar", this.root);
    this.workspaceEl = el("div", "unidraw-workspace", this.root);
    this.inspectorEl = el("aside", "unidraw-inspector", this.workspaceEl);
    this.stageWrap = el("div", "unidraw-stage-wrap", this.workspaceEl);
    this.stageEl = el("div", "unidraw-stage", this.stageWrap);
    this.elementsCard = el("aside", "unidraw-elements-card", this.workspaceEl);
    // The element model uses a single frame; the legacy layer panel is not shown.
    this.layersEl = document.createElement("aside");
    this.statusEl = el("footer", "unidraw-statusbar", this.root);
    this.toastLayer = el("div", "unidraw-toast-layer", this.root);
    this.popoverLayer = el("div", "unidraw-popover-layer", this.root);
    this.modalLayer = el("div", "unidraw-modal-layer", this.root);

    this.editor = new Editor({
      stage: this.stageEl,
      settings: this.settings,
      t: this.t,
      hooks: {
        isActive: () => this.host.isActive(),
        isModalOpen: () => this.hasModal(),
        requestSave: () => this.host.requestSave(),
        saveNow: () => this.host.saveNow(),
        statusChanged: () => this.updateStatus(),
        notify: (key, vars) => this.showToastKey(key, vars),
        openHelp: () => this.openHelp(),
        requestText: (request) => this.openInlineTextEditor(request),
        requestElementContextMenu: (x, y) => this.openCanvasContextMenuAt(x, y),
        settingsChanged: () => this.host.savePluginSettings?.(),
      },
    });

    this.buildHeader();
    this.buildStylebar();
    this.buildElementList();
    this.buildInspector();
    this.buildStatusbar();
    this.bindGlobal();
    this.updateStatus();
  }

  getEditor(): Editor {
    return this.editor;
  }

  getText(): string {
    return this.editor.getFileText();
  }

  loadText(text: string): void {
    this.closeAllOverlays();
    this.editor.loadText(text);
    this.updateStatus();
  }

  setSaveState(state: SaveState): void {
    this.editor.setSaveState(state);
    this.updateStatus();
  }

  applySettings(settings: UnidrawUISettings): void {
    const nextLanguage = resolveLanguage(settings.language);
    const languageChanged = nextLanguage !== this.language;
    this.settings = settings;
    this.language = nextLanguage;
    this.t = createTranslator(nextLanguage);
    this.editor.setTranslator(this.t);
    this.editor.applySettings(settings);
    if (languageChanged) {
      this.settings = settings;
      this.language = nextLanguage;
      this.t = createTranslator(nextLanguage);
      this.editor.setTranslator(this.t);
      this.abort.abort();
      this.abort = new AbortController();
      this.bindGlobal();
      this.buildHeader();
      this.buildStylebar();
      this.buildInspector();
      this.buildStatusbar();
    }
    this.updateStatus();
  }

  destroy(): void {
    this.closeAllOverlays();
    this.abort.abort();
    for (const timer of this.toastTimers) window.clearTimeout(timer);
    this.toastTimers = [];
    this.editor.destroy();
    this.root.remove();
  }

  // ------------------------------------------------------------------ status

  private buildStatusbar(): void {
    this.statusEl.empty();
    const left = el("div", "unidraw-status-left", this.statusEl);
    this.posEl = el("span", "unidraw-status-item", left);
    this.charEl = el("span", "unidraw-status-item unidraw-status-char", left);
    this.selectionStatusEl = el("span", "unidraw-status-item unidraw-status-selection", left);
    const center = el("div", "unidraw-status-center", this.statusEl);
    this.hintEl = el("span", "unidraw-status-hint", center);
    const right = el("div", "unidraw-status-right", this.statusEl);
    this.layerStatusEl = el("span", "unidraw-status-item", right);
    this.canvasStatusEl = el("span", "unidraw-status-item", right);
    this.zoomEl = el("span", "unidraw-status-item", right);
    const save = el("span", "unidraw-status-item unidraw-status-save", right);
    this.saveDot = el("span", "unidraw-status-save-dot", save);
    this.saveText = el("span", "", save);
    this.hintEl.setText(this.t("hint.select"));
  }

  private updateStatus(): void {
    if (!this.editor) return;
    if (!this.root.isConnected && !this.root.parentElement) return;
    const status = this.editor.getStatus();
    if (this.posEl) {
      this.posEl.setText(
        status.hoverRow === null || status.hoverCol === null
          ? "—"
          : this.t("status.pos", { row: status.hoverRow + 1, col: status.hoverCol + 1 }),
      );
    }
    if (this.charEl) {
      if (status.hoverChar) {
        this.charEl.removeClass("is-empty");
        this.charEl.setText(this.t("status.char", { char: status.hoverChar, code: status.hoverCode }));
        this.charEl.setAttribute("title", `${status.hoverChar} · ${widthLabel(status.hoverChar)}`);
      } else {
        this.charEl.addClass("is-empty");
        this.charEl.setText("—");
        this.charEl.removeAttribute("title");
      }
    }
    if (this.selectionStatusEl) {
      this.selectionStatusEl.setText(
        status.hasSelection
          ? `${this.t("status.selection", { w: status.selectionWidth, h: status.selectionHeight })} · ${status.selectionCount}`
          : "",
      );
    }
    if (this.layerStatusEl) {
      this.layerStatusEl.setText(status.activeLayerName);
      this.layerStatusEl.setAttribute("title", status.activeLayerName);
    }
    if (this.canvasStatusEl) {
      this.canvasStatusEl.setText(this.t("status.canvas", { cols: status.canvasCols, rows: status.canvasRows }));
    }
    if (this.zoomEl) this.zoomEl.setText(this.t("status.zoom", { zoom: Math.round(status.zoom * 100) }));
    if (this.zoomLabel) this.zoomLabel.setText(`${Math.round(status.zoom * 100)}%`);
    if (this.saveText && this.saveDot) {
      this.saveDot.className = "unidraw-status-save-dot";
      const state = status.saveState ?? "saved";
      if (state === "unsaved") this.saveDot.addClass("is-unsaved");
      if (state === "saving") this.saveDot.addClass("is-saving");
      if (state === "error") this.saveDot.addClass("is-error");
      this.saveText.setText(
        state === "saved"
          ? this.t("status.saved")
          : state === "saving"
            ? this.t("status.saving")
            : state === "unsaved"
              ? this.t("status.unsaved")
              : this.t("status.error"),
      );
    }
    if (this.undoBtn) this.undoBtn.disabled = !status.canUndo;
    if (this.redoBtn) this.redoBtn.disabled = !status.canRedo;
    for (const [tool, button] of this.toolButtons) button.toggleClass("is-active", tool === status.tool);
    if (this.gridBtn) this.gridBtn.toggleClass("is-active", status.grid !== "none");
    if (this.gridSelect) this.gridSelect.value = String(status.gridSize);
    this.root.toggleClass("unidraw-hide-status", !this.settings.showStatusBar);

    const styleSig = [
      status.tool,
      status.drawChar,
      this.editor.getStrokeStyle(),
      this.editor.getRoute(),
      this.editor.getArrowStyles().start,
      this.editor.getArrowStyles().end,
      this.editor.getTextFont(),
      this.settings.fontSize,
      this.language,
    ].join("|");
    if (styleSig !== this.styleSig) {
      this.styleSig = styleSig;
      this.buildStylebar();
    }

    const selected = this.editor.getSelectedObjects().filter((object) => object.global !== true);
    const inspectorSig = JSON.stringify({
      ids: selected.map((object) => object.id),
      props: selected.map((object) => this.objectSignature(object)),
      layer: this.editor.getData().activeLayerId,
      lang: this.language,
    });
    if (inspectorSig !== this.inspectorSig) {
      this.inspectorSig = inspectorSig;
      this.buildInspector();
    }
    const allSelectedIds = this.editor.getSelectedObjects().map((object) => object.id).sort();
    const layerObjects = this.editor.getData().layers.flatMap((layer) => layer.objects);
    const listSig = JSON.stringify({
      objects: layerObjects
        .filter((object) => object.kind !== "cells" || object.role !== "erase")
        .map((object, index) => [
          index,
          object.id,
          object.kind,
          object.global === true,
          object.visible !== false && object.hidden !== true,
          object.locked === true,
          object.kind === "cells" ? object.cells.length : 0,
          object.kind === "group" ? object.children.length : 0,
          object.kind === "rect" && typeof object.text === "string" ? object.text : "",
          object.kind === "rect" || object.kind === "circle" || object.kind === "diamond" ? getShapeFill(object) : null,
        ]),
      selected: allSelectedIds,
      lang: this.language,
    });
    if (listSig !== this.elementListSig) {
      this.elementListSig = listSig;
      this.buildElementList();
    }
    this.workspaceEl.toggleClass("has-inspector", selected.length > 0);
    const def = TOOL_DEFS.find((item) => item.id === status.tool);
    const toolHint = def ? this.t(def.hintKey) : "";
    if (this.hintEl) this.hintEl.setText(toolHint);
    if (this.styleHintEl) this.styleHintEl.setText(toolHint);
  }

  private objectSignature(object: DrawingObject): unknown {
    const state = [object.visible !== false, object.locked === true, object.global === true];
    if (object.kind === "line") {
      return [state, object.kind, object.style, object.route, object.arrowStart, object.arrowEnd];
    }
    if (object.kind === "rect") {
      return [
        state,
        object.kind,
        object.style,
        object.fill ?? (object.filled ? object.fillChar : null),
        object.fillEnabled !== false,
        object.text ?? "",
        object.textEnabled !== false,
        object.font ?? "",
        object.borderless === true,
        object.hAlign ?? "left",
        object.vAlign ?? "top",
        object.direction ?? "horizontal",
        object.wrap ?? "down",
        object.padding?.top ?? 0,
        object.padding?.right ?? 1,
        object.padding?.bottom ?? 0,
        object.padding?.left ?? 1,
      ];
    }
    if (object.kind === "circle" || object.kind === "diamond") return [state, object.kind, object.style, object.fill ?? null];
    if (object.kind === "group") {
      return [state, object.kind, object.children.map((child) => child.kind).join(",")];
    }
    return [state, object.kind, object.role, object.cells.length, object.global === true];
  }

  // ----------------------------------------------------------------- header

  private buildHeader(): void {
    this.headerEl.empty();
    this.toolButtons.clear();
    for (const group of TOOL_GROUPS) {
      const defs = TOOL_DEFS.filter((def) => def.group === group);
      if (defs.length === 0) continue;
      const toolGroup = el("div", "unidraw-tool-group", this.headerEl);
      for (const def of defs) {
        const button = el("button", "unidraw-btn unidraw-icon-btn", toolGroup) as HTMLButtonElement;
        button.type = "button";
        button.dataset.tool = def.id;
        button.dataset.action = `tool:${def.id}`;
        if (def.id === "solidRect") button.addClass("unidraw-tool-solid");
        const icon = el("span", "unidraw-btn-icon", button);
        if (def.id === "solidRect") {
          icon.classList.add("unidraw-tool-fill-icon");
          icon.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor"/></svg>';
        } else {
          setIconSafe(this.host, icon, def.icon);
        }
        this.host.tooltip(button, `${this.t(def.labelKey)} · ${def.shortcut}`);
        button.addEventListener("click", () => {
          this.editor.setTool(def.id);
          this.updateStatus();
        });
        this.toolButtons.set(def.id, button);
      }
    }

    const actions = el("div", "unidraw-actions", this.headerEl);
    const history = el("div", "unidraw-action-group", actions);
    this.undoBtn = this.iconButton(history, "undo-2", this.t("command.undo"), () => this.editor.undo());
    this.undoBtn.dataset.action = "undo";
    this.redoBtn = this.iconButton(history, "redo-2", this.t("command.redo"), () => this.editor.redo());
    this.redoBtn.dataset.action = "redo";

    const gridGroup = el("div", "unidraw-action-group", actions);
    el("span", "unidraw-action-label", gridGroup).setText(this.t("style.gridSize"));
    const gridSelect = el("select", "unidraw-select unidraw-grid-select", gridGroup) as HTMLSelectElement;
    for (const size of [4, 8, 12, 16]) {
      const option = el("option", "", gridSelect) as HTMLOptionElement;
      option.value = String(size);
      option.textContent = `${size}px`;
    }
    gridSelect.value = String(this.settings.fontSize);
    gridSelect.setAttribute("aria-label", this.t("style.gridSize"));
    this.host.tooltip(gridSelect, this.t("style.gridSize"));
    gridSelect.addEventListener("change", () => {
      this.editor.setGridSize(Number(gridSelect.value));
      this.showToastKey("notice.gridSize", { size: this.settings.fontSize });
      this.updateStatus();
    });
    this.gridSelect = gridSelect;
    this.gridBtn = this.iconButton(
      gridGroup,
      "grid",
      this.t("command.toggleGrid"),
      () => this.editor.toggleGrid(),
      "unidraw-grid-toggle",
    );
    this.gridBtn.dataset.action = "grid";

    const zoomGroup = el("div", "unidraw-action-group", actions);
    this.iconButton(zoomGroup, "zoom-out", this.t("zoom.out"), () => this.editor.zoomOut());
    this.zoomLabel = el("button", "unidraw-btn unidraw-zoom-label", zoomGroup) as HTMLButtonElement;
    this.zoomLabel.type = "button";
    this.zoomLabel.setText("100%");
    this.host.tooltip(this.zoomLabel, this.t("command.fit"));
    this.zoomLabel.addEventListener("click", () => this.editor.fitView());
    this.iconButton(zoomGroup, "zoom-in", this.t("zoom.in"), () => this.editor.zoomIn());
    this.iconButton(zoomGroup, "maximize", this.t("command.fit"), () => this.editor.fitView());

    const fileGroup = el("div", "unidraw-action-group", actions);
    const templatesButton = this.iconButton(fileGroup, "layout-template", this.t("templates.title"), (button) => this.openTemplates(button));
    templatesButton.dataset.action = "templates";
    const exportButton = el("button", "unidraw-btn unidraw-export-btn", fileGroup) as HTMLButtonElement;
    exportButton.type = "button";
    exportButton.dataset.action = "export";
    const exportIcon = el("span", "unidraw-btn-icon", exportButton);
    setIconSafe(this.host, exportIcon, "download");
    el("span", "unidraw-btn-label", exportButton).setText(this.t("export.button"));
    exportButton.addEventListener("click", () => this.openExport(exportButton));
    this.host.tooltip(exportButton, this.t("export.title"));
    const helpButton = this.iconButton(fileGroup, "help-circle", this.t("command.help"), () => this.openHelp());
    helpButton.dataset.action = "help";
  }

  private iconButton(
    parent: HTMLElement,
    iconName: string,
    tooltip: string,
    onClick: (button: HTMLButtonElement) => void,
    extraClass = "",
  ): HTMLButtonElement {
    const button = el("button", `unidraw-btn unidraw-icon-btn ${extraClass}`.trim(), parent) as HTMLButtonElement;
    button.type = "button";
    const icon = el("span", "unidraw-btn-icon", button);
    setIconSafe(this.host, icon, iconName);
    this.host.tooltip(button, tooltip);
    button.addEventListener("click", () => onClick(button));
    return button;
  }

  // --------------------------------------------------------------- stylebar

  private buildStylebar(): void {
    this.stylebarEl.empty();
    const status = this.editor.getStatus();
    const def = TOOL_DEFS.find((item) => item.id === status.tool);
    if (def) {
      const tool = el("div", "unidraw-style-tool", this.stylebarEl);
      const icon = el("span", "unidraw-style-tool-icon", tool);
      setIconSafe(this.host, icon, def.icon);
      el("span", "unidraw-tool-label", tool).setText(this.t(def.labelKey));
    }
    const controls = el("div", "unidraw-style-controls", this.stylebarEl);
    const tool = status.tool;

    if (tool === "pencil") {
      this.charControl(controls, this.t("style.pencilChar"), this.editor.getDrawChar(), () => {
        this.openCharPalette(this.stylebarEl, "draw");
      });
    } else if (tool === "solidRect" || tool === "fill") {
      this.charControl(controls, this.t("style.fillChar"), this.editor.getFillChar(), () => {
        this.openCharPalette(this.stylebarEl, "fill");
      });
    } else if (tool === "line") {
      this.strokeControl(controls, this.editor.getStrokeStyle(), (style) => this.editor.setStrokeStyle(style));
      this.routeControl(controls, this.editor.getRoute(), (route) => this.editor.setRoute(route));
      this.arrowControl(controls, "start", this.editor.getArrowStyles().start, (style) => this.editor.setArrowStartStyle(style));
      this.arrowControl(controls, "end", this.editor.getArrowStyles().end, (style) => this.editor.setArrowEndStyle(style));
    } else if (tool === "rect" || tool === "circle" || tool === "diamond") {
      this.strokeControl(controls, this.editor.getStrokeStyle(), (style) => this.editor.setStrokeStyle(style));
    }
    const hint = el("span", "unidraw-style-hint", this.stylebarEl);
    this.styleHintEl = hint;
    if (def) hint.setText(this.t(def.hintKey));
  }

  private charControl(parent: HTMLElement, label: string, char: string, onClick: () => void): void {
    const wrap = el("div", "unidraw-style-field", parent);
    el("span", "unidraw-field-label", wrap).setText(label);
    const button = el("button", "unidraw-char-swatch", wrap) as HTMLButtonElement;
    button.type = "button";
    button.setText(char);
    button.addEventListener("click", onClick);
    this.host.tooltip(button, this.t("palette.title"));
  }

  private strokeControl(parent: HTMLElement, value: StrokeStyle, onChange: (value: StrokeStyle) => void): void {
    const field = el("div", "unidraw-style-field", parent);
    el("span", "unidraw-field-label", field).setText(this.t("style.stroke"));
    const seg = el("div", "unidraw-segmented", field);
    for (const sample of STROKE_SAMPLES) {
      const button = el("button", "unidraw-segment", seg) as HTMLButtonElement;
      button.type = "button";
      button.setText(sample.glyph);
      button.dataset.value = sample.style;
      button.toggleClass("is-active", sample.style === value);
      this.host.tooltip(button, sample.style);
      button.addEventListener("click", () => {
        onChange(sample.style);
        this.updateStatus();
      });
    }
  }

  private routeControl(parent: HTMLElement, value: LineRoute, onChange: (value: LineRoute) => void): void {
    const field = el("div", "unidraw-style-field", parent);
    el("span", "unidraw-field-label", field).setText(this.t("style.route"));
    const seg = el("div", "unidraw-segmented", field);
    const routes: Array<{ id: LineRoute; glyph: string; label: MessageKey }> = [
      { id: "straight", glyph: "╱", label: "route.straight" },
      { id: "diagonal", glyph: "╱─", label: "route.diagonal" },
      { id: "elbow", glyph: "└", label: "route.elbow" },
    ];
    for (const route of routes) {
      const button = el("button", "unidraw-segment", seg) as HTMLButtonElement;
      button.type = "button";
      button.setText(route.glyph);
      button.toggleClass("is-active", route.id === value);
      this.host.tooltip(button, this.t(route.label));
      button.addEventListener("click", () => {
        onChange(route.id);
        this.updateStatus();
      });
    }
  }

  private arrowControl(
    parent: HTMLElement,
    which: "start" | "end",
    value: ArrowStyle,
    onChange: (value: ArrowStyle) => void,
  ): void {
    const field = el("div", "unidraw-style-field", parent);
    el("span", "unidraw-field-label", field).setText(
      which === "start" ? this.t("inspector.arrowStart") : this.t("inspector.arrowEnd"),
    );
    const select = el("select", "unidraw-select", field) as HTMLSelectElement;
    for (const style of ["none", "line", "hollow", "solid"] as ArrowStyle[]) {
      const option = el("option", "", select) as HTMLOptionElement;
      option.value = style;
      option.textContent = `${arrowGlyph(style)} ${this.t(`arrow.${style}` as MessageKey)}`;
    }
    select.value = value;
    select.addEventListener("change", () => {
      onChange(select.value as ArrowStyle);
      this.updateStatus();
    });
  }

  // ----------------------------------------------------------------- layers

  private buildLayers(): void {
    this.layersEl.empty();
    const header = el("div", "unidraw-layers-header", this.layersEl);
    const title = el("div", "unidraw-layers-title", header);
    const icon = el("span", "unidraw-layers-title-icon", title);
    setIconSafe(this.host, icon, "layers");
    el("span", "", title).setText(this.t("layer.title"));
    const add = el("button", "unidraw-btn unidraw-icon-btn", header) as HTMLButtonElement;
    add.type = "button";
    add.dataset.action = "layer-add";
    const addIcon = el("span", "unidraw-btn-icon", add);
    setIconSafe(this.host, addIcon, "plus");
    this.host.tooltip(add, this.t("layer.add"));
    add.addEventListener("click", () => {
      this.editor.addLayer();
      this.updateStatus();
    });

    const list = el("div", "unidraw-layers-list", this.layersEl);
    const layers = this.editor.getLayers().slice().reverse();
    const active = this.editor.getData().activeLayerId;
    const selected = new Set(this.editor.getSelectedLayerIds());
    for (const layer of layers) {
      const row = el("div", "unidraw-layer-row", list);
      row.dataset.layerId = layer.id;
      row.toggleClass("is-active", layer.id === active);
      row.toggleClass("is-selected", selected.has(layer.id));
      row.toggleClass("is-hidden", !layer.visible);
      row.toggleClass("is-locked", layer.locked);

      const visibility = el("button", "unidraw-layer-icon", row) as HTMLButtonElement;
      visibility.type = "button";
      visibility.dataset.action = `layer-visibility:${layer.id}`;
      setIconSafe(this.host, el("span", "unidraw-btn-icon", visibility), layer.visible ? "eye" : "eye-off");
      this.host.tooltip(visibility, layer.visible ? this.t("layer.hide") : this.t("layer.show"));
      visibility.addEventListener("click", (event) => {
        event.stopPropagation();
        this.editor.toggleLayerVisibility(layer.id);
        this.updateStatus();
      });

      const lock = el("button", "unidraw-layer-icon", row) as HTMLButtonElement;
      lock.type = "button";
      lock.dataset.action = `layer-lock:${layer.id}`;
      setIconSafe(this.host, el("span", "unidraw-btn-icon", lock), layer.locked ? "lock" : "unlock");
      this.host.tooltip(lock, layer.locked ? this.t("layer.unlock") : this.t("layer.lock"));
      lock.addEventListener("click", (event) => {
        event.stopPropagation();
        this.editor.toggleLayerLock(layer.id);
        this.updateStatus();
      });

      const name = el("div", "unidraw-layer-name", row);
      name.setText(layer.name);
      name.setAttribute("title", layer.name);
      name.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        this.beginRenameLayer(layer);
      });
      const count = el("span", "unidraw-layer-count", row);
      count.setText(String(layer.objects.length));

      const menu = el("button", "unidraw-layer-menu", row) as HTMLButtonElement;
      menu.type = "button";
      menu.dataset.action = `layer-menu:${layer.id}`;
      setIconSafe(this.host, el("span", "unidraw-btn-icon", menu), "ellipsis-vertical");
      this.host.tooltip(menu, this.t("aria.more"));
      menu.addEventListener("click", (event) => {
        event.stopPropagation();
        this.openLayerMenu(menu, layer.id);
      });
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!this.editor.getSelectedLayerIds().includes(layer.id)) {
          this.editor.selectLayer(layer.id, false);
        }
        this.openLayerMenu(row, layer.id);
      });
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("button,input")) return;
        this.editor.selectLayer(layer.id, event.ctrlKey || event.metaKey);
        this.updateStatus();
      });
    }

    const footer = el("div", "unidraw-layers-footer", this.layersEl);
    el("div", "unidraw-layers-footer-title", footer).setText(this.t("layer.canvasMin"));
    const inputs = el("div", "unidraw-canvas-min", footer);
    const min = this.editor.getData();
    const makeInput = (value: number, label: string, onChange: (n: number) => void): HTMLInputElement => {
      const wrap = el("label", "unidraw-min-field", inputs);
      el("span", "", wrap).setText(label);
      const input = el("input", "unidraw-min-input", wrap) as HTMLInputElement;
      input.type = "number";
      input.min = "4";
      input.max = "1200";
      input.value = String(value);
      input.addEventListener("change", () => onChange(Number(input.value)));
      return input;
    };
    const colsInput = makeInput(min.minCols, this.t("layer.width"), (n) => {
      this.editor.setMinCanvas(n, this.editor.getData().minRows);
      this.updateStatus();
    });
    const rowsInput = makeInput(min.minRows, this.t("layer.height"), (n) => {
      this.editor.setMinCanvas(this.editor.getData().minCols, n);
      this.updateStatus();
    });
    colsInput.setAttribute("aria-label", `${this.t("layer.canvasMin")} ${this.t("layer.width")}`);
    rowsInput.setAttribute("aria-label", `${this.t("layer.canvasMin")} ${this.t("layer.height")}`);
  }

  private beginRenameLayer(layer: Layer): void {
    const row = this.layersEl.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(layer.id)}"]`);
    if (!row) return;
    const name = row.querySelector<HTMLElement>(".unidraw-layer-name");
    if (!name) return;
    this.renamingLayerId = layer.id;
    const input = el("input", "unidraw-layer-name-input") as HTMLInputElement;
    input.value = layer.name;
    name.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      this.renamingLayerId = null;
      if (commit) this.editor.renameLayer(layer.id, input.value);
      this.updateStatus();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  private openLayerMenu(anchor: HTMLElement, layerId: string): void {
    const layer = this.editor.getLayers().find((item) => item.id === layerId);
    if (!layer) return;
    const selected = this.editor.getSelectedLayerIds();
    if (!selected.includes(layerId)) this.editor.selectLayer(layerId, false);
    const fresh = this.layersEl.querySelector<HTMLElement>(`[data-action="layer-menu:${CSS.escape(layerId)}"]`);
    if (fresh) anchor = fresh;
    const menu = el("div", "unidraw-menu-list");
    const item = (icon: string, label: string, action: () => void, disabled = false): void => {
      const button = el("button", "unidraw-menu-item", menu) as HTMLButtonElement;
      button.type = "button";
      button.disabled = disabled;
      const iconEl = el("span", "unidraw-menu-icon", button);
      setIconSafe(this.host, iconEl, icon);
      el("span", "unidraw-menu-text", button).setText(label);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (disabled) return;
        this.closePopover();
        action();
        this.updateStatus();
      });
    };
    item("pencil", this.t("layer.rename"), () => this.beginRenameLayer(layer));
    item("chevron-up", this.t("layer.moveUp"), () => this.editor.moveLayer(layer.id, 1));
    item("chevron-down", this.t("layer.moveDown"), () => this.editor.moveLayer(layer.id, -1));
    el("div", "unidraw-menu-separator", menu);
    const selectedIds = this.editor.getSelectedLayerIds();
    const canMerge = selectedIds.length >= 2 && selectedIds.every((id) => !this.editor.getLayers().find((l) => l.id === id)?.locked);
    item("merge", this.t("layer.merge"), () => this.editor.mergeLayers(selectedIds, false), !canMerge);
    item("layers", this.t("layer.mergeNew"), () => this.editor.mergeLayers(selectedIds, true), !canMerge);
    el("div", "unidraw-menu-separator", menu);
    item("trash", this.t("layer.delete"), () => this.editor.deleteLayer(layer.id), this.editor.getLayers().length <= 1);
    this.openPopover(anchor, menu, "unidraw-layer-menu-popover");
  }

  // --------------------------------------------------------------- inspector

  private buildInspector(): void {
    this.inspectorEl.empty();
    const selected = this.editor.getSelectedObjects();
    if (selected.length === 0) {
      this.workspaceEl.removeClass("has-inspector");
      return;
    }
    this.workspaceEl.addClass("has-inspector");
    const header = el("div", "unidraw-inspector-header", this.inspectorEl);
    const title = el("div", "unidraw-inspector-title", header);
    el("span", "", title).setText(this.t("inspector.title"));
    el("span", "unidraw-inspector-count", title).setText(String(selected.length));
    this.buildElementControls(this.inspectorEl, selected);
    if (selected.length > 1) {
      this.buildAlignControls(this.inspectorEl);
      return;
    }
    const object = selected[0];
    if (object.kind === "line") this.buildLineInspector(object);
    else if (object.kind === "rect") this.buildRectFeatures(object);
    else if (object.kind === "circle" || object.kind === "diamond") this.buildCircleInspector(object);
    else if (object.kind === "group") this.buildGroupInspector(object);
    else if (object.kind === "cells") this.buildCellsInspector(object);
  }

  private elementTypeKey(object: DrawingObject): MessageKey {
    if (object.kind === "cells") return object.global ? "element.globalDoodle" : "element.type.doodle";
    if (object.kind === "rect") return "element.type.rectangle";
    if (object.kind === "circle") return "element.type.ellipse";
    if (object.kind === "diamond") return "element.type.diamond";
    if (object.kind === "line") return "element.type.line";
    if (object.kind === "group") return "element.type.group";
    return "element.type.rectangle";
  }

  private elementTypeIcon(object: DrawingObject): string {
    switch (object.kind) {
      case "line":
        return "minus";
      case "rect":
        return "square";
      case "circle":
        return "circle";
      case "diamond":
        return "diamond";
      case "cells":
        return object.global ? "globe" : "pencil";
      case "group":
        return "layers";
      default:
        return "type";
    }
  }

  private buildElementList(): void {
    this.elementsCard.empty();
    const layer = this.editor.getActiveLayer();
    const objects = (layer?.objects ?? []).filter((object) => object.kind !== "cells" || object.role !== "erase");
    const selected = new Set(this.editor.getSelectedObjects().map((object) => object.id));
    const header = el("div", "unidraw-elements-header", this.elementsCard);
    const title = el("div", "unidraw-elements-title", header);
    setIconSafe(this.host, el("span", "unidraw-elements-title-icon", title), "layers");
    el("span", "", title).setText(this.t("elements.title"));
    el("span", "unidraw-elements-count", title).setText(String(objects.length));
    const list = el("div", "unidraw-element-list", this.elementsCard);
    if (objects.length === 0) {
      el("div", "unidraw-elements-empty", list).setText(this.t("elements.empty"));
      return;
    }
    // Topmost element first; the global doodle stays at the bottom.
    const topFirst = objects.slice().reverse();
    const selectableIds = topFirst
      .filter((object) => object.global !== true && object.locked !== true)
      .map((object) => object.id);
    for (const object of topFirst) {
      const hidden = object.visible === false || object.hidden === true;
      const locked = object.locked === true;
      const row = el("div", "unidraw-element-row", list);
      row.dataset.elementId = object.id;
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-selected", String(selected.has(object.id)));
      row.toggleClass("is-selected", selected.has(object.id));
      row.toggleClass("is-global", object.global === true);
      row.toggleClass("is-hidden", hidden);
      row.toggleClass("is-locked", locked);
      row.toggleClass("is-dragging", this.elementListDraggingId === object.id);
      if (object.global === true) row.setAttribute("aria-disabled", "true");
      const icon = el("span", "unidraw-element-row-icon", row);
      setIconSafe(this.host, icon, this.elementTypeIcon(object));
      const body = el("span", "unidraw-element-row-body", row);
      const name = el("span", "unidraw-element-row-name", body);
      name.setText(this.t(this.elementTypeKey(object)));
      const detail = el("span", "unidraw-element-row-detail", body);
      if (object.global === true) detail.setText(this.t("element.pressEscGlobal"));
      else if (object.kind === "group") detail.setText(this.t("element.children", { count: object.children.length }));
      else if (object.kind === "cells") detail.setText(`${object.cells.length}`);
      else if (object.kind === "rect" && typeof object.text === "string") {
        const firstLine = object.text.split("\n").find((line) => line.trim().length > 0) ?? "";
        detail.setText(firstLine.slice(0, 36) || this.t("element.type.text"));
      } else detail.setText(`z ${objects.indexOf(object) + 1}`);

      const actions = el("span", "unidraw-element-row-actions", row);
      const action = (iconName: string, label: string, onClick: () => void): void => {
        const button = el("button", "unidraw-element-action", actions) as HTMLButtonElement;
        button.type = "button";
        button.draggable = false;
        button.setAttribute("aria-label", label);
        setIconSafe(this.host, el("span", "unidraw-element-action-icon", button), iconName);
        this.host.tooltip(button, label);
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          onClick();
          this.updateStatus();
        });
        button.addEventListener("keydown", (event) => event.stopPropagation());
      };
      action(
        hidden ? "eye-off" : "eye",
        this.t(hidden ? "element.show" : "element.hide"),
        () => this.editor.setElementVisible(object.id, hidden),
      );
      // The global doodle deliberately has no lock control.
      if (object.global !== true) {
        action(
          locked ? "lock" : "unlock",
          this.t(locked ? "element.unlock" : "element.lock"),
          () => this.editor.setElementLocked(object.id, !locked),
        );
      }

      const canSelect = object.global !== true && !locked;
      if (canSelect) {
        this.host.tooltip(row, this.t(this.elementTypeKey(object)));
        row.addEventListener("click", (event) => {
          const anchor = this.elementListAnchorId;
          const currentIndex = selectableIds.indexOf(object.id);
          if (event.shiftKey && anchor && selectableIds.includes(anchor) && currentIndex >= 0) {
            const anchorIndex = selectableIds.indexOf(anchor);
            const start = Math.min(anchorIndex, currentIndex);
            const end = Math.max(anchorIndex, currentIndex);
            this.editor.selectElements(selectableIds.slice(start, end + 1), event.ctrlKey || event.metaKey ? "add" : "replace");
          } else if (event.ctrlKey || event.metaKey) {
            this.editor.selectElements([object.id], "toggle");
            this.elementListAnchorId = object.id;
          } else {
            this.editor.selectElements([object.id], "replace");
            this.elementListAnchorId = object.id;
          }
          this.updateStatus();
        });
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.editor.selectElements([object.id], "replace");
            this.elementListAnchorId = object.id;
            this.updateStatus();
          }
        });
      } else {
        this.host.tooltip(row, object.global === true ? this.t("element.pressEscGlobal") : this.t("element.locked"));
      }

      // Drag a row to adjust z-index. Locked and global rows stay fixed.
      if (object.global !== true && !locked) {
        row.draggable = true;
        row.addEventListener("dragstart", (event) => {
          this.elementListDraggingId = object.id;
          if (!this.editor.getSelectedObjects().some((item) => item.id === object.id)) {
            this.editor.selectElements([object.id], "replace");
          }
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", object.id);
          }
          row.addClass("is-dragging");
        });
        row.addEventListener("dragend", () => {
          this.elementListDraggingId = null;
          row.removeClass("is-dragging");
          list.querySelectorAll(".unidraw-element-row").forEach((item) => {
            item.removeClass("drop-above");
            item.removeClass("drop-below");
          });
        });
        row.addEventListener("dragover", (event) => {
          if (!this.elementListDraggingId || this.elementListDraggingId === object.id) return;
          event.preventDefault();
          const rect = row.getBoundingClientRect();
          const above = event.clientY < rect.top + rect.height / 2;
          list.querySelectorAll(".unidraw-element-row").forEach((item) => {
            item.removeClass("drop-above");
            item.removeClass("drop-below");
          });
          row.addClass(above ? "drop-above" : "drop-below");
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        });
        row.addEventListener("drop", (event) => {
          event.preventDefault();
          const sourceId = this.elementListDraggingId ?? event.dataTransfer?.getData("text/plain") ?? "";
          if (!sourceId || sourceId === object.id) return;
          const rect = row.getBoundingClientRect();
          const above = event.clientY < rect.top + rect.height / 2;
          this.editor.reorderElement(sourceId, object.id, above);
          this.elementListDraggingId = null;
          this.updateStatus();
        });
      }
    }
  }

  private closeElementRowMenu(): void {
    this.elementRowMenuCleanup?.();
    this.elementRowMenuCleanup = null;
    this.elementRowMenuEl?.remove();
    this.elementRowMenuEl = null;
  }

  private openElementRowMenu(x: number, y: number): void {
    this.closeElementRowMenu();
    this.closePopover();
    const menu = el("div", "unidraw-element-row-card unidraw-element-row-card-floating");
    const action = (iconName: string, label: string, danger: boolean, onClick: () => void): void => {
      const button = el("button", `unidraw-element-row-card-btn${danger ? " is-danger" : ""}`, menu) as HTMLButtonElement;
      button.type = "button";
      button.setAttribute("aria-label", label);
      setIconSafe(this.host, el("span", "unidraw-btn-icon", button), iconName);
      this.host.tooltip(button, label);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.closeElementRowMenu();
        onClick();
        this.updateStatus();
      });
    };
    action("copy", this.t("inspector.duplicate"), false, () => this.editor.duplicateSelection());
    action("trash", this.t("element.delete"), true, () => this.editor.deleteSelection());
    document.body.appendChild(menu);
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.max(8, Math.min(x + 2, window.innerWidth - width - 8));
    const top = y + height + 12 < window.innerHeight
      ? y + 8
      : Math.max(8, y - height - 8);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    this.elementRowMenuEl = menu;

    const onPointerDown = (event: PointerEvent): void => {
      if (!menu.contains(event.target as Node)) this.closeElementRowMenu();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.closeElementRowMenu();
    };
    const onViewportChange = (): void => this.closeElementRowMenu();
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("resize", onViewportChange);
      document.addEventListener("scroll", onViewportChange, true);
    }, 0);
    this.elementRowMenuCleanup = () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onViewportChange);
      document.removeEventListener("scroll", onViewportChange, true);
    };
  }

  private handleElementRowContext(event: MouseEvent, pointerDown: boolean): void {
    if (pointerDown && event.button !== 2) return;
    const target = event.target as HTMLElement | null;
    if (!target || !this.elementsCard.contains(target)) return;
    if (target.closest(".unidraw-element-row-actions")) return;
    const row = target.closest(".unidraw-element-row") as HTMLElement | null;
    if (!row) return;
    const layer = this.editor.getActiveLayer();
    const object = layer?.objects.find((item) => item.id === row.dataset.elementId);
    if (!object || object.global === true || object.locked === true) return;
    event.preventDefault();
    event.stopPropagation();
    if (!pointerDown && this.elementRowMenuEl) return;
    this.closeElementRowMenu();
    if (!this.editor.getSelectedObjects().some((item) => item.id === object.id)) {
      this.editor.selectElements([object.id], "replace");
      this.elementListAnchorId = object.id;
    }
    this.openElementRowMenu(event.clientX, event.clientY);
  }

  private buildElementControls(parent: HTMLElement, selected: DrawingObject[]): void {
    const typeRow = el("div", "unidraw-element-type", parent);
    setIconSafe(
      this.host,
      el("span", "unidraw-element-type-icon", typeRow),
      selected.length === 1 ? this.elementTypeIcon(selected[0]) : "shapes",
    );
    el("span", "", typeRow).setText(
      selected.length === 1
        ? this.t(this.elementTypeKey(selected[0]))
        : this.t("element.multi", { count: selected.length }),
    );

    const zTitle = el("div", "unidraw-inspector-section-title", parent);
    zTitle.setText(this.t("element.zOrder"));
    const zGrid = el("div", "unidraw-inspector-icon-grid", parent);
    const iconAction = (
      grid: HTMLElement,
      iconName: string,
      label: string,
      onClick: () => void,
      disabled = false,
    ): void => {
      const button = el("button", "unidraw-inspector-icon-btn", grid) as HTMLButtonElement;
      button.type = "button";
      button.disabled = disabled;
      button.setAttribute("aria-label", label);
      setIconSafe(this.host, el("span", "unidraw-btn-icon", button), iconName);
      this.host.tooltip(button, label);
      button.addEventListener("click", () => {
        onClick();
        this.updateStatus();
      });
    };
    iconAction(zGrid, "chevron-up", this.t("element.forward"), () => this.editor.moveSelectionZ("forward"));
    iconAction(zGrid, "chevron-down", this.t("element.backward"), () => this.editor.moveSelectionZ("backward"));
    iconAction(zGrid, "chevrons-up", this.t("element.front"), () => this.editor.moveSelectionZ("front"));
    iconAction(zGrid, "chevrons-down", this.t("element.back"), () => this.editor.moveSelectionZ("back"));

    const convertTitle = el("div", "unidraw-inspector-section-title", parent);
    convertTitle.setText(this.t("element.convertTitle"));
    const convertGrid = el("div", "unidraw-inspector-icon-grid", parent);
    iconAction(convertGrid, "pencil", this.t("element.convertDoodle"), () => this.editor.convertSelectionToDoodle(false));
    iconAction(convertGrid, "globe", this.t("element.convertGlobal"), () => this.editor.convertSelectionToDoodle(true));
    if (selected.length > 1) {
      iconAction(convertGrid, "layers", this.t("element.group"), () => this.editor.groupSelection());
    }
  }

  private inspectorSection(title: string): HTMLElement {
    const section = el("section", "unidraw-inspector-section", this.inspectorEl);
    el("div", "unidraw-inspector-section-title", section).setText(title);
    return section;
  }

  private buildLineInspector(object: Extract<DrawingObject, { kind: "line" }>): void {
    const section = this.inspectorSection(this.t("inspector.line"));
    this.inspectorStroke(section, object.style, (style) => this.editor.setSelectedLineStyle(style));
    this.inspectorRoute(section, object.route, (route) => this.editor.setSelectedLineRoute(route));
    this.inspectorArrow(section, "start", object.arrowStart, (style) => this.editor.setSelectedArrow("start", style));
    this.inspectorArrow(section, "end", object.arrowEnd, (style) => this.editor.setSelectedArrow("end", style));
  }

  private buildRectFeatures(object: RectObject): void {
    const section = this.inspectorSection(this.t("inspector.features"));
    const feature = (
      labelKey: MessageKey,
      checked: boolean,
      onChange: (enabled: boolean) => void,
    ): HTMLElement => {
      const wrapper = el("div", "unidraw-feature", section);
      const row = el("label", "unidraw-feature-row", wrapper);
      const checkbox = el("input", "unidraw-feature-check", row) as HTMLInputElement;
      checkbox.type = "checkbox";
      checkbox.checked = checked;
      el("span", "unidraw-feature-label", row).setText(this.t(labelKey));
      checkbox.addEventListener("change", () => {
        onChange(checkbox.checked);
        this.updateStatus();
      });
      return wrapper;
    };

    const textWrapper = feature("feature.text", object.textEnabled === true, (enabled) =>
      this.editor.setSelectedRectTextEnabled(enabled),
    );
    if (object.textEnabled === true) {
      this.buildTextControls(el("div", "unidraw-feature-subcard", textWrapper), object);
    }

    const fillWrapper = feature("feature.fill", object.fillEnabled === true, (enabled) =>
      this.editor.setSelectedRectFillEnabled(enabled),
    );
    if (object.fillEnabled === true) {
      this.buildRectFillControls(el("div", "unidraw-feature-subcard", fillWrapper), object);
    }

    const borderWrapper = feature("feature.border", object.borderless !== true, (enabled) =>
      this.editor.setSelectedRectBorderEnabled(enabled),
    );
    if (object.borderless !== true) {
      const subcard = el("div", "unidraw-feature-subcard", borderWrapper);
      this.inspectorStroke(subcard, object.style, (style) => this.editor.setSelectedStyle(style));
    }
  }

  private buildRectFillControls(parent: HTMLElement, object: RectObject): void {
    const fill = getShapeFill(object) ?? "";
    const row = el("div", "unidraw-inspector-field", parent);
    el("span", "unidraw-field-label", row).setText(this.t("inspector.fillMode"));
    const segmented = el("div", "unidraw-segmented", row);
    const empty = el("button", "unidraw-segment", segmented) as HTMLButtonElement;
    empty.type = "button";
    empty.setText("∅");
    empty.toggleClass("is-active", fill === "");
    this.host.tooltip(empty, this.t("fill.emptyFill"));
    empty.addEventListener("click", () => {
      this.editor.setSelectedFill("");
      this.updateStatus();
    });
    const custom = el("button", "unidraw-segment", segmented) as HTMLButtonElement;
    custom.type = "button";
    custom.setText(fill && fill !== "" ? fill : object.fillChar || "█");
    custom.toggleClass("is-active", fill !== "");
    this.host.tooltip(custom, this.t("fill.custom"));
    custom.addEventListener("click", () => {
      this.editor.setSelectedFill(fill && fill !== "" ? fill : object.fillChar || "█");
      this.updateStatus();
    });
    const charRow = el("div", "unidraw-inspector-field", parent);
    el("span", "unidraw-field-label", charRow).setText(this.t("inspector.fillChar"));
    const swatch = el("button", "unidraw-char-swatch", charRow) as HTMLButtonElement;
    swatch.type = "button";
    swatch.setText(fill === "" ? "∅" : fill);
    swatch.addEventListener("click", () => this.openCharPalette(swatch, "selectedFill"));
  }


  private buildCircleInspector(object: Extract<DrawingObject, { kind: "circle" | "diamond" }>): void {
    const section = this.inspectorSection(this.t("inspector.shape"));
    this.buildShapeFill(section, object);
    this.inspectorStroke(section, object.style, (style) => this.editor.setSelectedStyle(style));
  }

  private buildShapeFill(
    parent: HTMLElement,
    object: Extract<DrawingObject, { kind: "rect" | "circle" | "diamond" }>,
  ): void {
    const fill = getShapeFill(object);
    const row = el("div", "unidraw-inspector-field", parent);
    el("span", "unidraw-field-label", row).setText(this.t("inspector.fill"));
    const select = el("select", "unidraw-select", row) as HTMLSelectElement;
    const options: Array<[string, MessageKey]> = [
      ["none", "fill.none"],
      ["empty", "fill.emptyFill"],
      ["custom", "fill.custom"],
    ];
    for (const [value, label] of options) {
      const option = el("option", "", select) as HTMLOptionElement;
      option.value = value;
      option.textContent = this.t(label);
    }
    select.value = fill === null ? "none" : fill === "" ? "empty" : "custom";
    select.addEventListener("change", () => {
      if (select.value === "none") this.editor.setSelectedFill(null);
      else if (select.value === "empty") this.editor.setSelectedFill("");
      else this.editor.setSelectedFill(fill && fill !== "" ? fill : object.kind === "rect" ? object.fillChar || "█" : "█");
      this.updateStatus();
    });
    if (fill !== null) {
      const charRow = el("div", "unidraw-inspector-field", parent);
      el("span", "unidraw-field-label", charRow).setText(this.t("inspector.fillChar"));
      const swatch = el("button", "unidraw-char-swatch", charRow) as HTMLButtonElement;
      swatch.type = "button";
      swatch.setText(fill === "" ? "∅" : fill);
      swatch.addEventListener("click", () => this.openCharPalette(swatch, "selectedFill"));
    }
  }

  private buildGroupInspector(object: Extract<DrawingObject, { kind: "group" }>): void {
    const section = this.inspectorSection(this.t("inspector.shape"));
    el("div", "unidraw-inspector-note", section).setText(`${object.children.length} elements`);
  }

  private buildTextControls(parent: HTMLElement, object: RectObject): void {
    const previewRow = el("div", "unidraw-text-preview-row", parent);
    const note = el("div", "unidraw-inspector-note unidraw-text-preview", previewRow);
    note.setText(object.text && object.text.length > 0 ? object.text : this.t("text.placeholder"));
    note.style.whiteSpace = "pre-wrap";
    const edit = el("button", "unidraw-inspector-icon-btn unidraw-text-edit-btn", previewRow) as HTMLButtonElement;
    edit.type = "button";
    edit.setAttribute("aria-label", this.t("text.dialogEdit"));
    setIconSafe(this.host, el("span", "unidraw-btn-icon", edit), "type");
    this.host.tooltip(edit, this.t("text.dialogEdit"));
    edit.addEventListener("click", () => this.editor.requestEditText(object));

    const fontRow = el("div", "unidraw-inspector-field", parent);
    el("span", "unidraw-field-label", fontRow).setText(this.t("inspector.font"));
    const font = el("select", "unidraw-select", fontRow) as HTMLSelectElement;
    for (const item of TEXT_TRANSFORMS) {
      const option = el("option", "", font) as HTMLOptionElement;
      option.value = item;
      option.textContent = TEXT_TRANSFORM_SAMPLES[item];
    }
    font.value = object.font ?? "normal";
    font.addEventListener("change", () => this.editor.setSelectedTextFont(font.value as TextTransform));

    this.inspectorTextGrid(parent, object);
    this.inspectorTextFlow(parent, object);
    this.inspectorTextPadding(parent, object);
  }

  private inspectorTextGrid(section: HTMLElement, object: RectObject): void {
    const row = el("div", "unidraw-inspector-field unidraw-text-grid-field", section);
    el("span", "unidraw-field-label", row).setText(this.t("inspector.align"));
    const grid = el("div", "unidraw-text-grid", row);
    const hAligns: TextAlignH[] = ["left", "center", "right"];
    const vAligns: TextAlignV[] = ["top", "middle", "bottom"];
    const glyphs: Record<string, string> = {
      "left:top": "↖", "center:top": "↑", "right:top": "↗",
      "left:middle": "←", "center:middle": "·", "right:middle": "→",
      "left:bottom": "↙", "center:bottom": "↓", "right:bottom": "↘",
    };
    for (const vAlign of vAligns) {
      for (const hAlign of hAligns) {
        const button = el("button", "unidraw-text-grid-btn", grid) as HTMLButtonElement;
        button.type = "button";
        button.setText(glyphs[`${hAlign}:${vAlign}`]);
        button.toggleClass("is-active", (object.hAlign ?? "left") === hAlign && (object.vAlign ?? "top") === vAlign);
        const label = `${this.t(`align.${hAlign}` as MessageKey)} / ${this.t(`align.${vAlign}` as MessageKey)}`;
        button.setAttribute("aria-label", label);
        this.host.tooltip(button, label);
        button.addEventListener("click", () => {
          this.editor.setSelectedTextGrid(hAlign, vAlign);
          this.updateStatus();
        });
      }
    }
  }

  private inspectorTextFlow(section: HTMLElement, object: RectObject): void {
    const dRow = el("div", "unidraw-inspector-field", section);
    el("span", "unidraw-field-label", dRow).setText(this.t("inspector.direction"));
    const dSeg = el("div", "unidraw-segmented", dRow);
    for (const direction of ["horizontal", "vertical"] as TextDirection[]) {
      const button = el("button", "unidraw-segment", dSeg) as HTMLButtonElement;
      button.type = "button";
      button.setText(direction === "horizontal" ? "↔" : "↕");
      button.toggleClass("is-active", (object.direction ?? "horizontal") === direction);
      this.host.tooltip(button, this.t(`direction.${direction}` as MessageKey));
      button.addEventListener("click", () => {
        this.editor.setSelectedTextDirection(direction);
        this.updateStatus();
      });
    }
    const wRow = el("div", "unidraw-inspector-field", section);
    el("span", "unidraw-field-label", wRow).setText(this.t("inspector.wrap"));
    const wrap = el("select", "unidraw-select", wRow) as HTMLSelectElement;
    const direction = object.direction ?? "horizontal";
    const wrapOptions = direction === "vertical" ? (["right", "left"] as TextWrapMode[]) : (["down", "up"] as TextWrapMode[]);
    for (const value of wrapOptions) {
      const option = el("option", "", wrap) as HTMLOptionElement;
      option.value = value;
      option.textContent = this.t(`wrap.${value}` as MessageKey);
    }
    wrap.value = wrapOptions.includes(object.wrap ?? "down") ? (object.wrap ?? "down") : wrapOptions[0];
    wrap.addEventListener("change", () => {
      this.editor.setSelectedTextWrap(wrap.value as TextWrapMode);
      this.updateStatus();
    });
  }

  private inspectorTextPadding(section: HTMLElement, object: RectObject): void {
    const row = el("div", "unidraw-inspector-field unidraw-padding-field", section);
    el("span", "unidraw-field-label", row).setText(this.t("inspector.padding"));
    const grid = el("div", "unidraw-padding-grid", row);
    const padding = object.padding ?? { top: 0, right: 1, bottom: 0, left: 1 };
    const sides: Array<{ key: "top" | "right" | "bottom" | "left"; label: MessageKey }> = [
      { key: "top", label: "inspector.paddingTop" },
      { key: "right", label: "inspector.paddingRight" },
      { key: "bottom", label: "inspector.paddingBottom" },
      { key: "left", label: "inspector.paddingLeft" },
    ];
    for (const side of sides) {
      const cell = el("label", "unidraw-padding-cell", grid);
      el("span", "", cell).setText(this.t(side.label));
      const input = el("input", "unidraw-min-input", cell) as HTMLInputElement;
      input.type = "number";
      input.min = "0";
      input.max = "20";
      input.value = String(padding[side.key]);
      input.addEventListener("change", () => {
        this.editor.setSelectedTextPadding(side.key, Number(input.value));
        this.updateStatus();
      });
    }
  }

  private buildCellsInspector(object: Extract<DrawingObject, { kind: "cells" }>): void {
    const section = this.inspectorSection(this.t("inspector.shape"));
    const row = el("div", "unidraw-inspector-note", section);
    row.setText(`${object.global ? this.t("element.globalDoodle") : this.t("element.doodle")} · ${object.cells.length}`);
  }

  private inspectorStroke(parent: HTMLElement, value: StrokeStyle, onChange: (style: StrokeStyle) => void): void {
    const row = el("div", "unidraw-inspector-field", parent);
    el("span", "unidraw-field-label", row).setText(this.t("inspector.stroke"));
    this.inlineStroke(row, value, onChange);
  }

  private inspectorRoute(parent: HTMLElement, value: LineRoute, onChange: (route: LineRoute) => void): void {
    const row = el("div", "unidraw-inspector-field", parent);
    el("span", "unidraw-field-label", row).setText(this.t("inspector.route"));
    const select = el("select", "unidraw-select", row) as HTMLSelectElement;
    for (const route of ["straight", "diagonal", "elbow"] as LineRoute[]) {
      const option = el("option", "", select) as HTMLOptionElement;
      option.value = route;
      option.textContent = this.t(`route.${route}` as MessageKey);
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value as LineRoute));
  }

  private inspectorArrow(
    parent: HTMLElement,
    which: "start" | "end",
    value: ArrowStyle,
    onChange: (style: ArrowStyle) => void,
  ): void {
    const row = el("div", "unidraw-inspector-field", parent);
    el("span", "unidraw-field-label", row).setText(
      which === "start" ? this.t("inspector.arrowStart") : this.t("inspector.arrowEnd"),
    );
    const select = el("select", "unidraw-select", row) as HTMLSelectElement;
    for (const style of ["none", "line", "hollow", "solid"] as ArrowStyle[]) {
      const option = el("option", "", select) as HTMLOptionElement;
      option.value = style;
      option.textContent = `${arrowGlyph(style)} ${this.t(`arrow.${style}` as MessageKey)}`;
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value as ArrowStyle));
  }

  private inlineStroke(parent: HTMLElement, value: StrokeStyle, onChange: (style: StrokeStyle) => void): void {
    const seg = el("div", "unidraw-segmented", parent);
    for (const sample of STROKE_SAMPLES) {
      const button = el("button", "unidraw-segment", seg) as HTMLButtonElement;
      button.type = "button";
      button.setText(sample.glyph);
      button.toggleClass("is-active", sample.style === value);
      button.addEventListener("click", () => onChange(sample.style));
    }
  }

  private buildAlignControls(parent: HTMLElement): void {
    const section = this.inspectorSection(this.t("inspector.align"));
    const alignGrid = el("div", "unidraw-inspector-icon-grid", section);
    const align = (icon: string, label: string, kind: "left" | "right" | "hcenter" | "vcenter" | "top" | "bottom"): void => {
      const button = el("button", "unidraw-inspector-icon-btn", alignGrid) as HTMLButtonElement;
      button.type = "button";
      button.setAttribute("aria-label", this.t(label as MessageKey));
      setIconSafe(this.host, el("span", "unidraw-btn-icon", button), icon);
      this.host.tooltip(button, this.t(label as MessageKey));
      button.addEventListener("click", () => this.editor.alignSelection(kind));
    };
    align("align-left", "align.left", "left");
    align("align-center", "align.center", "hcenter");
    align("align-right", "align.right", "right");
    align("align-start-vertical", "align.top", "top");
    align("align-center-vertical", "align.middle", "vcenter");
    align("align-end-vertical", "align.bottom", "bottom");
    const distTitle = el("div", "unidraw-inspector-section-title", section);
    distTitle.setText(this.t("inspector.distribute"));
    const dist = el("div", "unidraw-inspector-icon-grid", section);
    const dBtn = (icon: string, label: string, axis: "horizontal" | "vertical"): void => {
      const button = el("button", "unidraw-inspector-icon-btn", dist) as HTMLButtonElement;
      button.type = "button";
      button.setAttribute("aria-label", this.t(label as MessageKey));
      setIconSafe(this.host, el("span", "unidraw-btn-icon", button), icon);
      this.host.tooltip(button, this.t(label as MessageKey));
      button.addEventListener("click", () => this.editor.distributeSelection(axis));
    };
    dBtn("align-center", "distribute.horizontal", "horizontal");
    dBtn("align-center-vertical", "distribute.vertical", "vertical");
  }

  // ------------------------------------------------------------- text modal

  private openInlineTextEditor(request: TextEditRequest): void {
    this.closePopover();
    this.closeElementRowMenu();
    this.textRequest = request;
    this.textModalEl?.remove();
    this.textCommit = null;
    const object = this.editor.getData().layers
      .flatMap((layer) => layer.objects)
      .find((item): item is RectObject => item.id === request.objectId && item.kind === "rect");
    if (!object) {
      this.editor.cancelTextRequest();
      return;
    }
    const rect = this.editor.getBoxClientRect(request.box);
    const cellsW = Math.max(1, request.box.c1 - request.box.c0 + 1);
    const cellsH = Math.max(1, request.box.r1 - request.box.r0 + 1);
    const cellW = rect.width / cellsW;
    const cellH = rect.height / cellsH;
    const padding = object.padding ?? { top: 0, right: 1, bottom: 0, left: 1 };
    const textarea = el("textarea", "unidraw-canvas-text-editor", document.body) as HTMLTextAreaElement;
    textarea.value = request.text;
    textarea.placeholder = this.t("text.placeholder");
    textarea.spellcheck = false;
    textarea.style.left = `${Math.round(rect.left)}px`;
    textarea.style.top = `${Math.round(rect.top)}px`;
    textarea.style.width = `${Math.max(12, Math.round(rect.width))}px`;
    textarea.style.height = `${Math.max(12, Math.round(rect.height))}px`;
    textarea.style.paddingTop = `${Math.round(padding.top * cellH)}px`;
    textarea.style.paddingRight = `${Math.round(padding.right * cellW)}px`;
    textarea.style.paddingBottom = `${Math.round(padding.bottom * cellH)}px`;
    textarea.style.paddingLeft = `${Math.round(padding.left * cellW)}px`;
    textarea.style.fontSize = `${Math.max(9, Math.min(40, cellH * 0.82))}px`;
    textarea.style.lineHeight = `${Math.max(11, cellH)}px`;
    textarea.style.textAlign = object.hAlign ?? "left";
    if (object.direction === "vertical") textarea.style.writingMode = "vertical-rl";
    const apply = (): void => {
      this.editor.confirmTextRequest(textarea.value, request.font);
      this.closeTextModal(true);
    };
    this.textCommit = apply;
    textarea.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        apply();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.closeTextModal(false);
      }
    });
    this.textModalEl = textarea;
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }

  private closeTextModal(committed: boolean): void {
    this.textModalEl?.remove();
    this.textModalEl = null;
    this.textRequest = null;
    this.textCommit = null;
    if (!committed) this.editor.cancelTextRequest();
    this.updateStatus();
  }

  // ---------------------------------------------------------------- popovers

  private openPopover(anchor: HTMLElement, content: HTMLElement, extraClass = ""): void {
    this.closeElementRowMenu();
    this.closePopover();
    const popover = el("div", `unidraw-popover ${extraClass}`.trim(), this.popoverLayer);
    popover.appendChild(content);
    const rect = anchor.getBoundingClientRect();
    popover.style.position = "fixed";
    popover.style.visibility = "hidden";
    popover.style.maxWidth = "calc(100vw - 24px)";
    // Measure first, then clamp the whole popover into the viewport.
    const popoverWidth = popover.offsetWidth;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - popoverWidth - 12));
    let top = rect.bottom + 6;
    let available = window.innerHeight - top - 12;
    if (available < 220 && rect.top > available) {
      top = Math.max(12, rect.top - Math.min(rect.top - 12, 520) - 6);
      available = window.innerHeight - top - 12;
    }
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.maxHeight = `${Math.max(120, available)}px`;
    popover.style.visibility = "visible";
    const onPointerDown = (event: PointerEvent) => {
      if (!popover.contains(event.target as Node) && event.target !== anchor) this.closePopover();
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
    }, 0);
    const handle: PopoverHandle = {
      el: popover,
      anchor,
      close: () => {
        window.clearTimeout(timer);
        document.removeEventListener("pointerdown", onPointerDown, true);
        popover.remove();
        if (this.popover === handle) this.popover = null;
      },
    };
    this.popover = handle;
  }

  private closePopover(): void {
    this.popover?.close();
    this.popover = null;
  }

  private closeAllOverlays(): void {
    this.closeElementRowMenu();
    this.closePopover();
    this.closeHelp();
    if (this.textModalEl) this.closeTextModal(false);
  }

  private hasModal(): boolean {
    return !!this.popover || !!this.helpEl || !!this.textModalEl;
  }

  // ------------------------------------------------------------ char palette

  private openCharPalette(anchor: HTMLElement, mode: "draw" | "fill" | "selectedFill"): void {
    const panel = el("div", "unidraw-char-panel");
    const header = el("div", "unidraw-popover-header", panel);
    el("div", "unidraw-popover-title", header).setText(this.t("palette.title"));
    const close = el("button", "unidraw-popover-close", header) as HTMLButtonElement;
    close.type = "button";
    close.setText("×");
    close.addEventListener("click", () => this.closePopover());
    const searchRow = el("div", "unidraw-char-search", panel);
    const search = el("input", "unidraw-palette-input", searchRow) as HTMLInputElement;
    search.type = "text";
    search.placeholder = this.t("palette.search");
    const body = el("div", "unidraw-char-body", panel);
    const render = (query: string) => {
      body.empty();
      const q = query.trim().toLowerCase();
      for (const category of CHAR_CATEGORIES) {
        for (const section of category.sections) {
          const chars = section.chars.filter((ch) => !q || ch.includes(q) || codePointLabel(ch).toLowerCase().includes(q));
          if (chars.length === 0) continue;
          const sectionEl = el("div", "unidraw-palette-section", body);
          el("div", "unidraw-palette-section-label", sectionEl).setText(this.t(section.labelKey));
          const grid = el("div", "unidraw-char-grid", sectionEl);
          for (const ch of chars) {
            const button = el("button", "unidraw-char-cell", grid) as HTMLButtonElement;
            button.type = "button";
            button.setText(ch);
            button.setAttribute("title", codePointLabel(ch));
            button.addEventListener("click", () => {
              if (mode === "selectedFill") this.editor.setSelectedFillChar(ch);
              else if (mode === "draw") this.editor.setDrawChar(ch);
              else this.editor.setFillChar(ch);
              this.closePopover();
              this.updateStatus();
            });
          }
        }
      }
      if (!body.firstElementChild) el("div", "unidraw-empty-note", body).setText(this.t("palette.noResults"));
    };
    search.addEventListener("input", () => render(search.value));
    render("");
    this.openPopover(anchor, panel, "unidraw-char-popover");
    window.requestAnimationFrame(() => search.focus());
  }

  private openTemplates(anchor: HTMLElement): void {
    const panel = el("div", "unidraw-template-panel");
    const header = el("div", "unidraw-popover-header", panel);
    el("div", "unidraw-popover-title", header).setText(this.t("templates.title"));
    const close = el("button", "unidraw-popover-close", header) as HTMLButtonElement;
    close.type = "button";
    close.setText("×");
    close.addEventListener("click", () => this.closePopover());
    const grid = el("div", "unidraw-template-grid", panel);
    for (const template of TEMPLATES) {
      const card = el("button", "unidraw-template-card", grid) as HTMLButtonElement;
      card.type = "button";
      const preview = el("pre", "unidraw-template-preview", card);
      preview.setText(template.art);
      el("span", "unidraw-template-label", card).setText(this.t(template.labelKey));
      card.addEventListener("click", () => {
        this.editor.insertTemplate(template.art);
        this.closePopover();
        this.updateStatus();
      });
    }
    this.openPopover(anchor, panel, "unidraw-template-popover");
  }

  // ----------------------------------------------------------------- export

  private openExport(anchor: HTMLElement): void {
    const menu = el("div", "unidraw-menu-list");
    const item = (icon: string, label: string, action: () => void): void => {
      const button = el("button", "unidraw-menu-item", menu) as HTMLButtonElement;
      button.type = "button";
      const iconEl = el("span", "unidraw-menu-icon", button);
      setIconSafe(this.host, iconEl, icon);
      el("span", "unidraw-menu-text", button).setText(label);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.closePopover();
        void action();
      });
    };
    el("div", "unidraw-menu-section", menu).setText(this.t("export.section.text"));
    item("copy", this.t("export.copyText"), () => this.copyDrawingAsText());
    item("code", this.t("export.copyMarkdown"), () => this.copyDrawingAsMarkdown());
    item("file-text", this.t("export.downloadTxt"), () => this.exportTextFile());
    item("file-text", this.t("export.downloadMd"), () => this.exportMarkdownFile());
    el("div", "unidraw-menu-section", menu).setText(this.t("export.section.image"));
    item("image", this.t("export.copyImage"), () => this.copyDrawingAsImage());
    item("download", this.t("export.downloadPng"), () => this.exportPng(false));
    item("download", this.t("export.downloadTransparentPng"), () => this.exportPng(true));
    el("div", "unidraw-menu-section", menu).setText(this.t("export.section.note"));
    item("file-text", this.t("export.insertNote"), () => this.insertIntoNote());
    this.openPopover(anchor, menu, "unidraw-export-popover");
  }

  private createExportImage(transparent: boolean): ReturnType<typeof renderDrawingImage> {
    const doc = this.editor.getDoc();
    if (!doc || doc.isEmpty()) {
      this.showToastKey("export.empty");
      return null;
    }
    const appearance = this.editor.getAppearance();
    return renderDrawingImage(doc, {
      fontSize: this.settings.fontSize,
      lineHeight: this.settings.lineHeight,
      fontFamily: appearance.fontFamily,
      scale: 2,
      padding: 24,
      background: transparent ? null : appearance.colors.paper,
      textColor: appearance.colors.text,
    });
  }

  async copyDrawingAsText(): Promise<void> {
    const text = this.editor.getArtText();
    if (!text) {
      this.showToastKey("export.empty");
      return;
    }
    if (await copyTextToClipboard(text)) this.showToastKey("export.copied");
    else this.showToastKey("export.copyFailed");
  }

  async copyDrawingAsMarkdown(): Promise<void> {
    const text = this.editor.getArtText();
    if (!text) {
      this.showToastKey("export.empty");
      return;
    }
    if (await copyTextToClipboard(drawingToMarkdown(text))) this.showToastKey("export.copied");
    else this.showToastKey("export.copyFailed");
  }

  async copyDrawingAsImage(): Promise<void> {
    const image = this.createExportImage(false);
    if (!image) return;
    if (await copyImageToClipboard(image.canvas)) this.showToastKey("export.imageCopied");
    else this.showToastKey("export.imageCopyFailed");
  }

  private async canvasBlob(transparent: boolean): Promise<{ blob: Blob; name: string } | null> {
    const image = this.createExportImage(transparent);
    if (!image) return null;
    const blob = await canvasToBlob(image.canvas);
    if (!blob) {
      this.showToastKey("export.exportFailed");
      return null;
    }
    return { blob, name: `${sanitizeFilename(this.host.getFileName())}${transparent ? "-transparent" : ""}` };
  }

  async exportPng(transparent = false): Promise<void> {
    const result = await this.canvasBlob(transparent);
    if (!result) return;
    downloadBlob(result.blob, `${result.name}.png`);
    this.showToastKey("export.savedPng");
  }

  exportTextFile(): void {
    const text = this.editor.getArtText();
    if (!text) {
      this.showToastKey("export.empty");
      return;
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, `${sanitizeFilename(this.host.getFileName())}.txt`);
    this.showToastKey("export.savedTxt");
  }

  exportMarkdownFile(): void {
    const text = this.editor.getArtText();
    if (!text) {
      this.showToastKey("export.empty");
      return;
    }
    const blob = new Blob([drawingToMarkdown(text)], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, `${sanitizeFilename(this.host.getFileName())}.md`);
    this.showToastKey("export.savedMd");
  }

  insertIntoNote(): void {
    const text = this.editor.getArtText();
    if (!text) {
      this.showToastKey("export.empty");
      return;
    }
    if (this.host.insertIntoNote(drawingToMarkdown(text))) this.showToastKey("export.inserted");
    else this.showToastKey("export.noNote");
  }

  // ------------------------------------------------------------------ help

  private openHelp(): void {
    this.closePopover();
    if (this.helpEl) this.closeHelp();
    const overlay = el("div", "unidraw-help-overlay", this.modalLayer);
    const backdrop = el("div", "unidraw-help-backdrop", overlay);
    backdrop.addEventListener("click", () => this.closeHelp());
    const dialog = el("div", "unidraw-help-dialog", overlay);
    const header = el("div", "unidraw-help-header", dialog);
    const logo = el("div", "unidraw-help-logo", header);
    logo.setText("UD");
    const titleWrap = el("div", "unidraw-help-title-wrap", header);
    el("div", "unidraw-help-title", titleWrap).setText(this.t("help.title"));
    el("div", "unidraw-help-subtitle", titleWrap).setText(this.t("help.subtitle"));
    const close = el("button", "unidraw-help-close", header) as HTMLButtonElement;
    close.type = "button";
    close.setText("×");
    close.addEventListener("click", () => this.closeHelp());
    const content = el("div", "unidraw-help-content", dialog);
    const toolSection = el("section", "unidraw-help-section", content);
    el("div", "unidraw-help-section-title", toolSection).setText(this.t("help.tools"));
    const tools = el("div", "unidraw-help-tools", toolSection);
    for (const def of TOOL_DEFS) {
      const item = el("div", "unidraw-help-tool", tools);
      const icon = el("span", "unidraw-help-tool-icon", item);
      setIconSafe(this.host, icon, def.icon);
      const label = el("div", "unidraw-help-tool-label", item);
      label.setText(`${this.t(def.labelKey)}  ${def.shortcut}`);
    }
    const shortcutSection = el("section", "unidraw-help-section", content);
    el("div", "unidraw-help-section-title", shortcutSection).setText(this.t("help.shortcuts"));
    const columns = el("div", "unidraw-help-shortcut-columns", shortcutSection);
    const column = (title: string): HTMLElement => {
      const col = el("div", "unidraw-help-shortcut-column", columns);
      el("div", "unidraw-help-shortcut-title", col).setText(title);
      return col;
    };
    const keys = keyCombos();
    const row = (col: HTMLElement, key: string, label: string): void => {
      const line = el("div", "unidraw-help-shortcut-row", col);
      el("span", "unidraw-help-keys", line).setText(key);
      el("span", "unidraw-help-shortcut-label", line).setText(label);
    };
    const sel = column(this.t("help.shortcut.selection"));
    row(sel, `${keys.mod} A`, this.t("help.shortcut.selectAll"));
    row(sel, `${keys.mod} C / X / V`, this.t("help.shortcut.copyPaste"));
    row(sel, "Delete", this.t("help.shortcut.delete"));
    row(sel, `${keys.mod} D`, this.t("help.shortcut.duplicate"));
    row(sel, "↑ ↓ ← →", this.t("help.shortcut.nudge"));
    const edit = column(this.t("help.shortcut.editing"));
    row(edit, `${keys.mod} Z`, this.t("help.shortcut.undo"));
    row(edit, `${keys.mod} ⇧ Z`, this.t("help.shortcut.redo"));
    row(edit, `${keys.mod} S`, this.t("help.shortcut.save"));
    row(edit, "Esc", this.t("help.shortcut.escape"));
    row(edit, "?", this.t("help.shortcut.help"));
    const view = column(this.t("help.shortcut.view"));
    row(view, "Wheel", this.t("help.shortcut.zoom"));
    row(view, `${keys.mod} + Wheel`, this.t("help.wheelVertical"));
    row(view, `${keys.mod} + ${keys.shift} + Wheel`, this.t("help.wheelHorizontal"));
    row(view, "Space + Drag", this.t("help.shortcut.spacePan"));
    row(view, "0", this.t("help.shortcut.fit"));
    row(view, "G", this.t("help.shortcut.grid"));
    const draw = column(this.t("help.shortcut.drawing"));
    row(draw, "Left drag", this.t("help.leftDrag"));
    row(draw, "Right drag", this.t("help.rightDrag"));
    row(draw, "Ctrl + Click", this.t("help.ctrlClick"));
    row(draw, "Double click", this.t("help.doubleClick"));
    row(draw, "Enter", this.t("help.applyText"));
    const tips = el("div", "unidraw-help-tips", content);
    for (const tip of ["help.tip1", "help.tip2", "help.tip3", "help.tip4", "help.tip5", "help.tip6", "help.tip7"] as MessageKey[]) {
      const item = el("div", "unidraw-help-tip", tips);
      el("span", "unidraw-help-tip-bullet", item).setText("✦");
      el("span", "", item).setText(this.t(tip));
    }
    const footer = el("div", "unidraw-help-footer", dialog);
    el("div", "unidraw-help-about", footer).setText(`${this.t("help.about")} · v${this.host.getVersion()}`);
    const closeBtn = el("button", "unidraw-btn unidraw-text-btn", footer) as HTMLButtonElement;
    closeBtn.type = "button";
    closeBtn.setText(this.t("help.close"));
    closeBtn.addEventListener("click", () => this.closeHelp());
    this.helpEl = overlay;
  }

  private closeHelp(): void {
    this.helpEl?.remove();
    this.helpEl = null;
  }

  // ------------------------------------------------------------------ toast

  private showToastKey(key: MessageKey, vars?: Record<string, string | number>): void {
    const toast = el("div", "unidraw-toast", this.toastLayer);
    el("span", "unidraw-toast-dot", toast);
    el("span", "unidraw-toast-text", toast).setText(this.t(key, vars));
    window.requestAnimationFrame(() => toast.addClass("is-visible"));
    const timer = window.setTimeout(() => {
      toast.removeClass("is-visible");
      window.setTimeout(() => toast.remove(), 180);
    }, 1600);
    this.toastTimers.push(timer);
  }

  // --------------------------------------------------------------- commands

  showHelp(): void {
    this.openHelp();
  }

  openHelpCommand(): void {
    this.openHelp();
  }

  toggleGrid(): void {
    this.editor.toggleGrid();
    this.updateStatus();
  }

  fitView(): void {
    this.editor.fitView();
    this.updateStatus();
  }

  exportPngCommand(): void {
    void this.exportPng(false);
  }

  copyTextCommand(): void {
    void this.copyDrawingAsText();
  }

  // ------------------------------------------------------------------ events

  private bindGlobal(): void {
    const signal = this.abort.signal;
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!this.textModalEl) return;
        if (this.textModalEl.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopPropagation();
        if (this.textCommit) this.textCommit();
        else this.closeTextModal(false);
      },
      { signal, capture: true },
    );
    window.addEventListener("pointerdown", (event) => this.handleElementRowContext(event, true), { signal, capture: true });
    window.addEventListener("contextmenu", (event) => this.handleElementRowContext(event, false), { signal, capture: true });
    this.stageEl.addEventListener("contextmenu", (event) => this.onCanvasContextMenu(event), { signal });
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          if (this.textModalEl) return;
          if (this.helpEl) {
            event.preventDefault();
            this.closeHelp();
          } else if (this.elementRowMenuEl) {
            event.preventDefault();
            this.closeElementRowMenu();
          } else if (this.popover) {
            event.preventDefault();
            this.closePopover();
          }
        }
      },
      { signal, capture: true },
    );
  }

  private onCanvasContextMenu(event: MouseEvent): void {
    if (this.editor.getTool() === "select" || this.editor.getTool() === "hand") {
      // Select-tool context menus are opened explicitly on right-click release;
      // right-drag scales the selection. Pan right-drag selects text.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (this.editor.shouldSuppressContextMenu()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const rightBound: string[] = ["pencil", "line", "rect", "solidRect", "fill", "circle", "diamond"];
    if (rightBound.includes(this.editor.getTool())) return;
    event.preventDefault();
    event.stopPropagation();
    this.openCanvasContextMenuAt(event.clientX, event.clientY);
  }

  private openCanvasContextMenuAt(x: number, y: number): void {
    this.editor.clearTextSelection();
    const hit = this.editor.selectAtClientPoint(x, y, false, true);
    const selected = this.editor.getSelectedObjects();
    if (selected.length === 0) {
      const objects = this.editor.getData().layers.flatMap((layer) => layer.objects);
      const hasHidden = objects.some((object) => object.visible === false || object.hidden);
      const hasLocked = objects.some((object) => object.locked === true);
      if (!hasHidden && !hasLocked) return;
      const emptyMenu = el("div", "unidraw-menu-list");
      const emptyItem = (icon: string, label: string, action: () => void): void => {
        const button = el("button", "unidraw-menu-item", emptyMenu) as HTMLButtonElement;
        button.type = "button";
        setIconSafe(this.host, el("span", "unidraw-menu-icon", button), icon);
        el("span", "unidraw-menu-text", button).setText(label);
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          this.closePopover();
          action();
          this.updateStatus();
        });
      };
      if (hasHidden) emptyItem("eye", this.t("element.showAll"), () => this.editor.showAllElements());
      if (hasLocked) emptyItem("unlock", this.t("element.unlockAll"), () => this.editor.unlockAllElements());
      this.openPopoverAt(x, y, emptyMenu, "unidraw-element-menu-popover");
      return;
    }
    void hit;
    const menu = el("div", "unidraw-menu-list");
    const item = (icon: string, label: string, action: () => void): void => {
      const button = el("button", "unidraw-menu-item", menu) as HTMLButtonElement;
      button.type = "button";
      setIconSafe(this.host, el("span", "unidraw-menu-icon", button), icon);
      el("span", "unidraw-menu-text", button).setText(label);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.closePopover();
        action();
        this.updateStatus();
      });
    };
    item("type", this.t("element.convertDoodle"), () => this.editor.convertSelectionToDoodle(false));
    item("globe", this.t("element.convertGlobal"), () => this.editor.convertSelectionToDoodle(true));
    if (selected.length > 1) item("layers", this.t("element.group"), () => this.editor.groupSelection());
    el("div", "unidraw-menu-separator", menu);
    item("trash", this.t("element.delete"), () => this.editor.deleteSelection());
    const allVisible = selected.every((object) => object.visible !== false && object.hidden !== true);
    item(allVisible ? "eye-off" : "eye", this.t(allVisible ? "element.hide" : "element.show"), () => this.editor.setSelectionVisible(!allVisible));
    const allLocked = selected.every((object) => object.locked === true);
    item(allLocked ? "unlock" : "lock", this.t(allLocked ? "element.unlock" : "element.lock"), () => this.editor.setSelectionLocked(!allLocked));
    this.openPopoverAt(x, y, menu, "unidraw-element-menu-popover");
  }

  private openPopoverAt(x: number, y: number, content: HTMLElement, extraClass = ""): void {
    const anchor = el("div", "unidraw-popover-anchor");
    anchor.style.position = "fixed";
    anchor.style.left = `${x}px`;
    anchor.style.top = `${y}px`;
    anchor.style.width = "0";
    anchor.style.height = "0";
    this.popoverLayer.appendChild(anchor);
    this.openPopover(anchor, content, extraClass);
    anchor.remove();
  }

}
