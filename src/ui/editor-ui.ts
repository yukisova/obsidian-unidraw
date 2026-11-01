import {
  createTranslator,
  resolveLanguage,
  type Language,
  type LanguageSetting,
  type MessageKey,
  type Translator,
} from "../core/i18n";
import type {
  EditorSettings,
  SaveState,
  StrokeStyle,
  TextAlignH,
  TextAlignV,
  TextDirection,
  TextWrapMode,
  ToolId,
} from "../core/types";
import { drawingToMarkdown } from "../core/format";
import { getShapeFill, type DrawingObject, type GroupObject, type RectFillMode, type RectObject } from "../core/objects";
import { codePointLabel, widthLabel } from "../core/unicode";
import { Editor, type TextEditRequest } from "../editor/editor";
import { STROKE_SAMPLES } from "../glyphs/box";
import {
  canvasToBlob,
  copyImageToClipboard,
  copyTextToClipboard,
  downloadBlob,
  renderDrawingImage,
} from "../render/export-image";
import { CHAR_CATEGORIES, TEMPLATES, TOOL_DEFS, TOOL_GROUPS } from "./data";

export interface UnidrawUISettings extends EditorSettings {
  language: LanguageSetting;
}

export interface GroupTemplatePayload {
  version: 1;
  name: string;
  savedAt: string;
  group: GroupObject;
}

export interface UnidrawUIHost {
  icon: (el: HTMLElement, name: string) => void;
  tooltip: (el: HTMLElement, text: string) => void;
  isActive: () => boolean;
  getSettings: () => UnidrawUISettings;
  getVersion: () => string;
  /** True on macOS/iOS, used only for shortcut labels. */
  isMac: () => boolean;
  requestSave: () => void;
  saveNow: () => void;
  getFileName: () => string;
  insertIntoNote: (markdown: string) => boolean;
  savePluginSettings?: () => void;
  saveGroupTemplate?: (template: GroupTemplatePayload) => Promise<boolean>;
  saveTextExport?: (filename: string, content: string) => Promise<boolean>;
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

function keyCombos(isMac: boolean): { mod: string; shift: string; alt: string } {
  return isMac ? { mod: "⌘", shift: "⇧", alt: "⌥" } : { mod: "Ctrl", shift: "Shift", alt: "Alt" };
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

export class UnidrawEditorUI {
  private host: UnidrawUIHost;
  private settings: UnidrawUISettings;
  private language: Language;
  private t: Translator;
  private root: HTMLDivElement;
  private headerEl: HTMLElement;
  private workspaceEl: HTMLDivElement;
  private inspectorEl: HTMLElement;
  private stageWrap: HTMLDivElement;
  private stageEl: HTMLDivElement;
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
  private popover: PopoverHandle | null = null;
  private helpEl: HTMLElement | null = null;
  private textModalEl: HTMLElement | null = null;
  private textCommit: (() => void) | null = null;
  private inspectorSig = "";
  private elementListSig = "";
  private elementListAnchorId: string | null = null;
  private elementListDraggingId: string | null = null;
  private expandedGroups = new Set<string>();
  private elementRowMenuEl: HTMLElement | null = null;
  private elementRowMenuCleanup: (() => void) | null = null;
  private lastBorderStyle: StrokeStyle = "light";
  private toastTimers = new Set<number>();

  constructor(container: HTMLElement, host: UnidrawUIHost) {
    this.host = host;
    this.settings = host.getSettings();
    this.language = resolveLanguage(this.settings.language);
    this.t = createTranslator(this.language);

    this.root = el("div", "unidraw-root", container);
    this.headerEl = el("header", "unidraw-header", this.root);
    this.workspaceEl = el("div", "unidraw-workspace", this.root);
    this.inspectorEl = el("aside", "unidraw-inspector", this.workspaceEl);
    this.stageWrap = el("div", "unidraw-stage-wrap", this.workspaceEl);
    this.stageEl = el("div", "unidraw-stage", this.stageWrap);
    this.elementsCard = el("aside", "unidraw-elements-card", this.workspaceEl);
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
      this.buildInspector();
      this.buildStatusbar();
    }
    this.updateStatus();
  }

  destroy(): void {
    this.closeAllOverlays();
    this.abort.abort();
    for (const timer of this.toastTimers) window.clearTimeout(timer);
    this.toastTimers.clear();
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
    this.root.toggleClass("unidraw-hide-status", !this.settings.showStatusBar);

    const selected = this.editor.getSelectedObjects().filter((object) => object.global !== true);
    const inspectorSig = JSON.stringify({
      ids: selected.map((object) => object.id),
      props: selected.map((object) => this.objectSignature(object)),
      layer: this.editor.getData().activeLayerId,
      lang: this.language,
      tool: this.editor.getStatus().tool,
      drawChar: this.editor.getDrawChar(),
      fillChar: this.editor.getFillChar(),
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
        .map((object) => this.elementTreeSignature(object)),
      expanded: Array.from(this.expandedGroups).sort(),
      selected: allSelectedIds,
      lang: this.language,
    });
    if (listSig !== this.elementListSig) {
      this.elementListSig = listSig;
      this.buildElementList();
    }
    const showToolOptions = status.tool === "pencil" || status.tool === "solidRect" || status.tool === "fill";
    this.workspaceEl.toggleClass("has-inspector", selected.length > 0 || showToolOptions);
    const def = TOOL_DEFS.find((item) => item.id === status.tool);
    const toolHint = def ? this.t(def.hintKey) : "";
    if (this.hintEl) this.hintEl.setText(toolHint);
  }

  private objectSignature(object: DrawingObject): unknown {
    const state = [object.visible !== false, object.locked === true, object.global === true];
    if (object.kind === "line") {
      return [
        state,
        object.kind,
        object.style,
        object.route,
        object.arrowStart,
        object.arrowEnd,
        object.arrowStartMode,
        object.arrowEndMode,
        object.arrowStartChar,
        object.arrowEndChar,
        object.routing,
        object.lineStyle,
        object.linePattern,
        object.lineFillChar,
        object.interruptEnabled,
        object.interrupt?.segment,
        object.interrupt?.gap,
        object.interrupt?.offset,
        object.ignoreShapes,
      ];
    }
    if (object.kind === "rect") {
      return [
        state,
        object.kind,
        object.style,
        object.fill ?? (object.filled ? object.fillChar : null),
        object.fillEnabled !== false,
        object.fillMode ?? "",
        object.interruptEnabled === true,
        object.interrupt?.segment ?? 0,
        object.interrupt?.gap ?? 0,
        object.interrupt?.offset ?? 0,
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
      return [state, object.kind, object.name, object.renderMode, object.children.map((child) => child.kind).join(",")];
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
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("viewBox", "0 0 24 24");
          svg.setAttribute("aria-hidden", "true");
          const outline = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          outline.setAttribute("x", "3.5");
          outline.setAttribute("y", "3.5");
          outline.setAttribute("width", "17");
          outline.setAttribute("height", "17");
          outline.setAttribute("rx", "2");
          outline.setAttribute("fill", "none");
          outline.setAttribute("stroke", "currentColor");
          outline.setAttribute("stroke-width", "1.8");
          const solid = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          solid.setAttribute("x", "8");
          solid.setAttribute("y", "8");
          solid.setAttribute("width", "8");
          solid.setAttribute("height", "8");
          solid.setAttribute("rx", "1");
          solid.setAttribute("fill", "currentColor");
          svg.append(outline, solid);
          icon.appendChild(svg);
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

  // --------------------------------------------------------------- inspector

  private elementTreeSignature(object: DrawingObject): unknown {
    const base = [
      object.id,
      object.kind,
      object.global === true,
      object.visible !== false && object.hidden !== true,
      object.locked === true,
      object.kind === "cells" ? object.cells.length : 0,
      object.kind === "rect" && typeof object.text === "string" ? object.text : "",
      object.kind === "rect" || object.kind === "circle" || object.kind === "diamond" ? getShapeFill(object) : null,
    ];
    if (object.kind === "group") {
      return [...base, object.name, object.renderMode, object.children.map((child) => this.elementTreeSignature(child))];
    }
    return base;
  }

  private buildInspector(): void {
    this.inspectorEl.empty();
    const tool = this.editor.getStatus().tool;
    const charTool = tool === "pencil" || tool === "solidRect" || tool === "fill";
    if (charTool) {
      this.workspaceEl.addClass("has-inspector");
      this.buildDrawingToolCard(tool);
      return;
    }
    const selected = this.editor.getSelectedObjects();
    if (selected.length === 0) {
      this.workspaceEl.removeClass("has-inspector");
      return;
    }
    this.workspaceEl.addClass("has-inspector");
    const header = el("div", "unidraw-inspector-header", this.inspectorEl);
    const title = el("div", "unidraw-inspector-title", header);
    if (selected.length === 1 && selected[0].kind === "group") {
      const group = selected[0];
      const nameInput = el("input", "unidraw-inspector-name-input", title) as HTMLInputElement;
      nameInput.type = "text";
      nameInput.maxLength = 80;
      nameInput.value = group.name ?? "";
      nameInput.placeholder = this.t("element.type.group");
      nameInput.setAttribute("aria-label", this.t("group.rename"));
      nameInput.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") nameInput.blur();
      });
      nameInput.addEventListener("change", () => {
        this.editor.renameGroup(group.id, nameInput.value);
        this.updateStatus();
      });
    } else {
      el("span", "", title).setText(this.t("inspector.title"));
    }
    el("span", "unidraw-inspector-count", title).setText(String(selected.length));
    this.buildElementControls(this.inspectorEl, selected);
    if (selected.length > 1) {
      this.buildAlignControls();
      return;
    }
    const object = selected[0];
    if (object.kind === "line") this.buildLineInspector(object);
    else if (object.kind === "rect") this.buildRectFeatures(object);
    else if (object.kind === "circle" || object.kind === "diamond") this.buildCircleInspector(object);
    else if (object.kind === "group") this.buildGroupInspector(object);
    else if (object.kind === "cells") this.buildCellsInspector(object);
  }

  private buildDrawingToolCard(tool: "pencil" | "solidRect" | "fill"): void {
    const def = TOOL_DEFS.find((item) => item.id === tool);
    const char = tool === "pencil" ? this.editor.getDrawChar() : this.editor.getFillChar();
    const card = el("div", "unidraw-drawing-card", this.inspectorEl);
    const header = el("div", "unidraw-drawing-header", card);
    const icon = el("span", "unidraw-drawing-tool-icon", header);
    if (def) setIconSafe(this.host, icon, def.icon);
    const heading = el("div", "unidraw-drawing-heading", header);
    el("div", "unidraw-drawing-title", heading).setText(def ? this.t(def.labelKey) : this.t("toolOptions.title"));
    el("div", "unidraw-drawing-hint", heading).setText(def ? this.t(def.hintKey) : this.t("toolOptions.hint"));

    const current = el("div", "unidraw-drawing-current", card);
    const currentBody = el("div", "unidraw-drawing-current-body", current);
    el("div", "unidraw-drawing-current-label", currentBody).setText(this.t("toolOptions.current"));
    const currentButton = el("button", "unidraw-drawing-current-char", current) as HTMLButtonElement;
    currentButton.type = "button";
    currentButton.setText(char);
    currentButton.addEventListener("click", () => {
      this.openCharPalette(currentButton, tool === "pencil" ? "draw" : "fill");
    });

    el("div", "unidraw-drawing-section-label", card).setText(this.t("toolOptions.quick"));
    const quick = el("div", "unidraw-drawing-quick", card);
    const chars = tool === "pencil"
      ? ["█", "▓", "▒", "░", "■", "●", "◆", "★", "•", "·", "+", "×"]
      : ["█", "▓", "▒", "░", "▚", "▞", "▙", "▟", "■", "▪", "▮", "▰"];
    for (const ch of chars) {
      const button = el("button", "unidraw-drawing-char", quick) as HTMLButtonElement;
      button.type = "button";
      button.setText(ch);
      button.toggleClass("is-active", ch === char);
      button.addEventListener("click", () => {
        if (tool === "pencil") this.editor.setDrawChar(ch);
        else this.editor.setFillChar(ch);
        this.updateStatus();
      });
    }

    const more = el("button", "unidraw-drawing-more", card) as HTMLButtonElement;
    more.type = "button";
    setIconSafe(this.host, el("span", "unidraw-drawing-more-icon", more), "grid-3x3");
    el("span", "", more).setText(this.t("toolOptions.more"));
    more.addEventListener("click", () => {
      this.openCharPalette(more, tool === "pencil" ? "draw" : "fill");
    });
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
    const topFirst = objects.slice().reverse();
    const selectableIds = topFirst
      .filter((object) => object.global !== true && object.locked !== true)
      .map((object) => object.id);

    const renderRow = (
      object: DrawingObject,
      depth: number,
      parentGroupId: string | null,
      rootId: string,
      siblings: DrawingObject[],
      inheritedLocked: boolean,
    ): void => {
      const hidden = object.visible === false || object.hidden === true;
      const locked = inheritedLocked || object.locked === true;
      const row = el("div", "unidraw-element-row", list);
      if (depth > 0) {
        row.addClass("is-child");
        row.addClass(`depth-${Math.min(depth, 4)}`);
      }
      row.dataset.elementId = object.id;
      row.dataset.parentGroupId = parentGroupId ?? "";
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      const rowSelected = depth === 0 && selected.has(object.id);
      row.setAttribute("aria-selected", String(rowSelected));
      row.toggleClass("is-selected", rowSelected);
      row.toggleClass("is-global", object.global === true);
      row.toggleClass("is-hidden", hidden);
      row.toggleClass("is-locked", locked);
      row.toggleClass("is-dragging", this.elementListDraggingId === object.id);
      if (object.global === true) row.setAttribute("aria-disabled", "true");

      if (object.kind === "group") {
        const expanded = this.expandedGroups.has(object.id);
        row.toggleClass("is-expanded", expanded);
        const expand = el("button", "unidraw-element-expand", row) as HTMLButtonElement;
        expand.type = "button";
        expand.draggable = false;
        expand.setAttribute("aria-label", this.t(expanded ? "element.collapse" : "element.expand"));
        setIconSafe(this.host, el("span", "unidraw-element-expand-icon", expand), expanded ? "chevron-down" : "chevron-right");
        expand.addEventListener("click", (event) => {
          event.stopPropagation();
          if (expanded) this.expandedGroups.delete(object.id);
          else this.expandedGroups.add(object.id);
          this.buildElementList();
          this.updateStatus();
        });
      }

      const icon = el("span", "unidraw-element-row-icon", row);
      setIconSafe(this.host, icon, this.elementTypeIcon(object));
      const body = el("span", "unidraw-element-row-body", row);
      const name = el("span", "unidraw-element-row-name", body);
      name.setText(object.kind === "group" && object.name ? object.name : this.t(this.elementTypeKey(object)));
      const detail = el("span", "unidraw-element-row-detail", body);
      if (object.global === true) detail.setText(this.t("element.pressEscGlobal"));
      else if (object.kind === "group") detail.setText(this.t("element.children", { count: object.children.length }));
      else if (object.kind === "cells") detail.setText(`${object.cells.length}`);
      else if (object.kind === "rect" && typeof object.text === "string") {
        const firstLine = object.text.split("\n").find((line) => line.trim().length > 0) ?? "";
        detail.setText(firstLine.slice(0, 36) || this.t("element.type.text"));
      } else detail.setText(`z ${siblings.indexOf(object) + 1}`);

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
        () => {
          if (depth === 0) this.editor.setElementVisible(object.id, hidden);
          else this.editor.setChildElementVisible(object.id, hidden);
        },
      );
      if (object.global !== true) {
        action(
          object.locked === true ? "lock" : "unlock",
          this.t(object.locked === true ? "element.unlock" : "element.lock"),
          () => {
            if (depth === 0) this.editor.setElementLocked(object.id, object.locked !== true);
            else this.editor.setChildElementLocked(object.id, object.locked !== true);
          },
        );
      }

      const canSelect = object.global !== true && !locked;
      if (canSelect) {
        this.host.tooltip(row, this.t(this.elementTypeKey(object)));
        row.addEventListener("click", (event) => {
          if (this.elementListDraggingId) return;
          const selectId = depth === 0 ? object.id : rootId;
          if (depth === 0) {
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
          } else {
            this.editor.selectElements([selectId], "replace");
            this.elementListAnchorId = selectId;
          }
          this.updateStatus();
        });
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.editor.selectElements([depth === 0 ? object.id : rootId], "replace");
            this.elementListAnchorId = depth === 0 ? object.id : rootId;
            this.updateStatus();
          }
        });
      } else {
        this.host.tooltip(row, object.global === true ? this.t("element.pressEscGlobal") : this.t("element.locked"));
      }

      if (object.global !== true && !locked) {
        row.draggable = true;
        row.addEventListener("dragstart", (event) => {
          this.elementListDraggingId = object.id;
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
          const sourceRow = Array.from(list.querySelectorAll<HTMLElement>(".unidraw-element-row"))
            .find((item) => item.dataset.elementId === this.elementListDraggingId);
          if ((sourceRow?.dataset.parentGroupId ?? "") !== (parentGroupId ?? "")) return;
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
          const sourceRow = Array.from(list.querySelectorAll<HTMLElement>(".unidraw-element-row"))
            .find((item) => item.dataset.elementId === sourceId);
          if ((sourceRow?.dataset.parentGroupId ?? "") !== (parentGroupId ?? "")) return;
          const rect = row.getBoundingClientRect();
          const above = event.clientY < rect.top + rect.height / 2;
          if (parentGroupId) this.editor.reorderGroupChild(parentGroupId, sourceId, object.id, above);
          else this.editor.reorderElement(sourceId, object.id, above);
          this.elementListDraggingId = null;
          this.updateStatus();
        });
      }

      if (object.kind === "group" && this.expandedGroups.has(object.id)) {
        const children = object.children
          .filter((child) => child.kind !== "cells" || child.role !== "erase")
          .slice()
          .reverse();
        for (const child of children) {
          renderRow(child, depth + 1, object.id, depth === 0 ? object.id : rootId, object.children, locked);
        }
      }
    };

    for (const object of topFirst) renderRow(object, 0, null, object.id, objects, false);
  }

  private closeElementRowMenu(): void {
    this.elementRowMenuCleanup?.();
    this.elementRowMenuCleanup = null;
    this.elementRowMenuEl?.remove();
    this.elementRowMenuEl = null;
  }

  private openElementRowMenu(x: number, y: number, globalDoodle = false): void {
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
    if (globalDoodle) {
      action("eraser", this.t("element.clearGlobalDoodle"), true, () => this.editor.clearGlobalDoodle());
    } else {
      action("copy", this.t("inspector.duplicate"), false, () => this.editor.duplicateSelection());
      action("trash", this.t("element.delete"), true, () => this.editor.deleteSelection());
    }
    document.body.appendChild(menu);
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.max(8, Math.min(x + 2, window.innerWidth - width - 8));
    const top = y + height + 12 < window.innerHeight
      ? y + 8
      : Math.max(8, y - height - 8);
    menu.setCssStyles({
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
    });
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
    if (!object || object.locked === true) return;
    event.preventDefault();
    event.stopPropagation();
    if (!pointerDown && this.elementRowMenuEl) return;
    this.closeElementRowMenu();
    if (object.global === true) {
      this.openElementRowMenu(event.clientX, event.clientY, true);
      return;
    }
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
    const routing = object.routing ?? (object.route === "elbow" ? "4way" : "8way");
    const lineStyle = object.lineStyle ?? (object.style === "heavy" ? "bold" : object.style === "double" ? "double" : object.style === "ascii" ? "ascii" : "thin");
    const ignore = object.ignoreShapes ?? "all";
    const pattern = object.linePattern ?? "solid";
    const choice = (
      parent: HTMLElement,
      active: boolean,
      label: MessageKey,
      onClick: () => void,
      tooltip?: MessageKey,
    ): HTMLButtonElement => {
      const button = el("button", "unidraw-line-choice", parent) as HTMLButtonElement;
      button.type = "button";
      button.toggleClass("is-active", active);
      button.setText(this.t(label));
      if (tooltip) {
        button.setAttribute("aria-label", this.t(tooltip));
        this.host.tooltip(button, this.t(tooltip));
      }
      button.addEventListener("click", () => {
        onClick();
        this.updateStatus();
      });
      return button;
    };

    const routingField = el("div", "unidraw-line-field", section);
    el("div", "unidraw-text-field-label", routingField).setText(this.t("line.routing"));
    const routingGrid = el("div", "unidraw-line-choice-grid", routingField);
    choice(routingGrid, routing === "4way", "line.routing.4way", () => this.editor.setSelectedLineRouting("4way"));
    choice(routingGrid, routing === "8way", "line.routing.8way", () => this.editor.setSelectedLineRouting("8way"));

    const ignoreField = el("div", "unidraw-line-field", section);
    el("div", "unidraw-text-field-label", ignoreField).setText(this.t("line.ignore"));
    const ignoreGrid = el("div", "unidraw-line-ignore-grid", ignoreField);
    choice(ignoreGrid, ignore === "all", "line.ignore.all.short", () => this.editor.setSelectedLineIgnoreShapes("all"), "line.ignore.all");
    choice(ignoreGrid, ignore === "none", "line.ignore.none.short", () => this.editor.setSelectedLineIgnoreShapes("none"), "line.ignore.none");
    choice(ignoreGrid, ignore === "exceptTargets", "line.ignore.exceptTargets.short", () => this.editor.setSelectedLineIgnoreShapes("exceptTargets"), "line.ignore.exceptTargets");

    const styleField = el("div", "unidraw-line-field", section);
    el("div", "unidraw-text-field-label", styleField).setText(this.t("line.style"));
    const styleTabs = el("div", "unidraw-line-style-tabs", styleField);
    const styles: Array<{ id: "thin" | "bold" | "double" | "filled" | "ascii"; icon: string; label: MessageKey }> = [
      { id: "thin", icon: "minus", label: "line.style.thin" },
      { id: "bold", icon: "bold", label: "line.style.bold" },
      { id: "double", icon: "equal", label: "line.style.double" },
      { id: "ascii", icon: "terminal", label: "line.style.ascii" },
      { id: "filled", icon: "paint-bucket", label: "line.style.filled" },
    ];
    for (const item of styles) {
      const button = el("button", "unidraw-line-style-tab", styleTabs) as HTMLButtonElement;
      button.type = "button";
      button.toggleClass("is-active", lineStyle === item.id);
      button.setAttribute("aria-label", this.t(item.label));
      this.host.tooltip(button, this.t(item.label));
      setIconSafe(this.host, el("span", "unidraw-line-style-icon", button), item.icon);
      button.addEventListener("click", () => {
        this.editor.setSelectedLineStyleMode(item.id);
        this.updateStatus();
      });
    }

    if (lineStyle === "thin" || lineStyle === "bold") {
      const patternCard = el("div", "unidraw-line-subcard", section);
      el("div", "unidraw-line-subcard-title", patternCard).setText(this.t("line.pattern"));
      const grid = el("div", "unidraw-line-pattern-grid", patternCard);
      const patterns: Array<{ id: "solid" | "dash2" | "dash3" | "dash4"; sample: string; label: MessageKey }> = [
        { id: "solid", sample: "solid", label: "line.pattern.solid" },
        { id: "dash2", sample: "dash2", label: "line.pattern.dash2" },
        { id: "dash3", sample: "dash3", label: "line.pattern.dash3" },
        { id: "dash4", sample: "dash4", label: "line.pattern.dash4" },
      ];
      for (const item of patterns) {
        const button = el("button", "unidraw-line-pattern-option", grid) as HTMLButtonElement;
        button.type = "button";
        button.toggleClass("is-active", pattern === item.id);
        button.setAttribute("aria-label", this.t(item.label));
        this.host.tooltip(button, this.t(item.label));
        el("span", `unidraw-line-pattern-sample is-${item.sample}`, button);
        button.addEventListener("click", () => {
          this.editor.setSelectedLinePattern(item.id);
          this.updateStatus();
        });
      }
    } else if (lineStyle === "filled") {
      const fillCard = el("div", "unidraw-line-subcard", section);
      el("div", "unidraw-line-subcard-title", fillCard).setText(this.t("line.fillChar"));
      const fillRow = el("div", "unidraw-line-fill-row", fillCard);
      const input = el("input", "unidraw-line-fill-input", fillRow) as HTMLInputElement;
      input.type = "text";
      input.maxLength = 2;
      input.value = object.lineFillChar ?? "█";
      input.addEventListener("change", () => {
        this.editor.setSelectedLineFillChar(input.value);
        this.updateStatus();
      });
    }

    const checks = el("div", "unidraw-line-checks", section);
    const toggle = (label: MessageKey, checked: boolean, onChange: (enabled: boolean) => void): HTMLInputElement => {
      const row = el("label", "unidraw-line-check-row", checks);
      const input = el("input", "unidraw-feature-check", row) as HTMLInputElement;
      input.type = "checkbox";
      input.checked = checked;
      el("span", "unidraw-line-check-label", row).setText(this.t(label));
      input.addEventListener("change", () => {
        onChange(input.checked);
        this.updateStatus();
      });
      return input;
    };
    toggle("line.arrowStart", object.arrowStart !== "none", (enabled) =>
      this.editor.setSelectedLineArrowToggle("start", enabled),
    );
    if (object.arrowStart !== "none") this.buildLineArrowControls(checks, object, "start");
    toggle("line.arrowEnd", object.arrowEnd !== "none", (enabled) =>
      this.editor.setSelectedLineArrowToggle("end", enabled),
    );
    if (object.arrowEnd !== "none") this.buildLineArrowControls(checks, object, "end");
    toggle("line.interrupt", object.interruptEnabled === true, (enabled) =>
      this.editor.setSelectedLineInterruptEnabled(enabled),
    );
    if (object.interruptEnabled === true) {
      const config = object.interrupt ?? { segment: 2, gap: 2, offset: 0 };
      const fields: Array<{ key: "segment" | "gap" | "offset"; label: MessageKey; min: number; value: number }> = [
        { key: "segment", label: "interrupt.segment", min: 1, value: config.segment },
        { key: "gap", label: "interrupt.gap", min: 1, value: config.gap },
        { key: "offset", label: "interrupt.offset", min: 0, value: config.offset },
      ];
      const grid = el("div", "unidraw-interrupt-grid unidraw-line-interrupt-grid", section);
      for (const field of fields) {
        const cell = el("label", "unidraw-interrupt-field", grid);
        el("span", "unidraw-interrupt-label", cell).setText(this.t(field.label));
        const input = el("input", "unidraw-interrupt-input", cell) as HTMLInputElement;
        input.type = "number";
        input.min = String(field.min);
        input.value = String(field.value);
        input.addEventListener("change", () => {
          this.editor.setSelectedLineInterruptValue(field.key, Number(input.value));
          this.updateStatus();
        });
      }
    }
  }

  private buildLineArrowControls(
    parent: HTMLElement,
    object: Extract<DrawingObject, { kind: "line" }>,
    which: "start" | "end",
  ): void {
    const card = el("div", "unidraw-line-arrow-card", parent);
    const mode = which === "start" ? object.arrowStartMode ?? "adaptive" : object.arrowEndMode ?? "adaptive";
    const tabs = el("div", "unidraw-line-arrow-tabs", card);
    const tab = (id: "adaptive" | "custom", label: MessageKey): void => {
      const button = el("button", "unidraw-line-arrow-tab", tabs) as HTMLButtonElement;
      button.type = "button";
      button.toggleClass("is-active", mode === id);
      button.setText(this.t(label));
      button.addEventListener("click", () => {
        this.editor.setSelectedLineArrowMode(which, id);
        this.updateStatus();
      });
    };
    tab("adaptive", "line.arrowAdaptive");
    tab("custom", "line.arrowCustom");

    const body = el("div", "unidraw-line-arrow-body", card);
    if (mode === "custom") {
      const input = el("input", "unidraw-line-arrow-input", body) as HTMLInputElement;
      input.type = "text";
      input.maxLength = 2;
      input.value = which === "start" ? object.arrowStartChar ?? "←" : object.arrowEndChar ?? "→";
      input.setAttribute("aria-label", this.t("line.arrowCustom"));
      input.addEventListener("change", () => {
        this.editor.setSelectedLineArrowChar(which, input.value);
        this.updateStatus();
      });
    } else {
      const directions = el("div", "unidraw-line-arrow-directions", body);
      for (const arrow of ["↑", "→", "↓", "←"]) el("span", "unidraw-line-arrow-direction", directions).setText(arrow);
    }
    const preview = el("div", "unidraw-line-arrow-preview", body);
    preview.setText(this.lineArrowPreview(object, which));
  }

  private lineArrowPreview(
    object: Extract<DrawingObject, { kind: "line" }>,
    which: "start" | "end",
  ): string {
    const mode = which === "start" ? object.arrowStartMode ?? "adaptive" : object.arrowEndMode ?? "adaptive";
    if (mode === "custom") return which === "start" ? object.arrowStartChar ?? "←" : object.arrowEndChar ?? "→";
    const dr = object.y2 - object.y1;
    const dc = object.x2 - object.x1;
    if (dr === 0 && dc === 0) return which === "start" ? "←" : "→";
    if (Math.abs(dr) >= Math.abs(dc)) {
      const forward = dr >= 0 ? "↓" : "↑";
      return which === "end" ? forward : forward === "↓" ? "↑" : "↓";
    }
    const forward = dc >= 0 ? "→" : "←";
    return which === "end" ? forward : forward === "→" ? "←" : "→";
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
      this.buildBorderStyleControls(subcard, object);
    }

    const interruptWrapper = feature("feature.interrupt", object.interruptEnabled === true, (enabled) =>
      this.editor.setSelectedRectInterruptEnabled(enabled),
    );
    if (object.interruptEnabled === true) {
      this.buildRectInterruptControls(el("div", "unidraw-feature-subcard", interruptWrapper), object);
    }
  }

  private buildRectInterruptControls(parent: HTMLElement, object: RectObject): void {
    const config = object.interrupt ?? { segment: 2, gap: 2, offset: 0 };
    const fields: Array<{
      key: keyof typeof config;
      label: MessageKey;
      min: number;
      value: number;
    }> = [
      { key: "segment", label: "interrupt.segment", min: 1, value: config.segment },
      { key: "gap", label: "interrupt.gap", min: 1, value: config.gap },
      { key: "offset", label: "interrupt.offset", min: 0, value: config.offset },
    ];
    const grid = el("div", "unidraw-interrupt-grid", parent);
    for (const field of fields) {
      const cell = el("label", "unidraw-interrupt-field", grid);
      el("span", "unidraw-interrupt-label", cell).setText(this.t(field.label));
      const input = el("input", "unidraw-interrupt-input", cell) as HTMLInputElement;
      input.type = "number";
      input.min = String(field.min);
      input.value = String(field.value);
      input.addEventListener("change", () => {
        this.editor.setSelectedRectInterruptValue(field.key, Number(input.value));
        this.updateStatus();
      });
    }
  }

  private buildBorderStyleControls(parent: HTMLElement, object: RectObject): void {
    const lightFamily: StrokeStyle[] = ["light", "rounded", "dashed", "dash2", "dash4"];
    const heavyFamily: StrokeStyle[] = ["heavy", "heavyDash2", "heavyDash3", "heavyDash4"];
    const isLight = lightFamily.includes(object.style);
    const isHeavy = heavyFamily.includes(object.style);
    const field = el("div", "unidraw-border-field", parent);
    el("div", "unidraw-text-field-label", field).setText(this.t("border.style"));
    const tabs = el("div", "unidraw-border-tabs", field);
    const styles: Array<{ style: StrokeStyle; icon: string; label: MessageKey }> = [
      { style: "light", icon: "minus", label: "border.light" },
      { style: "heavy", icon: "bold", label: "border.heavy" },
      { style: "double", icon: "equal", label: "border.double" },
      { style: "ascii", icon: "terminal", label: "border.ascii" },
    ];
    for (const item of styles) {
      const button = el("button", "unidraw-border-tab", tabs) as HTMLButtonElement;
      button.type = "button";
      const active = item.style === "light" ? isLight : item.style === "heavy" ? isHeavy : object.style === item.style;
      button.toggleClass("is-active", active);
      button.setAttribute("aria-label", this.t(item.label));
      this.host.tooltip(button, this.t(item.label));
      const preview = el("span", `unidraw-border-preview is-${item.style}`, button);
      setIconSafe(this.host, el("span", "unidraw-border-tab-icon", preview), item.icon);
      button.addEventListener("click", () => {
        this.lastBorderStyle = item.style;
        this.editor.setSelectedStyle(item.style);
        this.updateStatus();
      });
    }

    if (isLight || isHeavy) {
      const patternField = el("div", "unidraw-border-pattern-field", parent);
      el("div", "unidraw-text-field-label", patternField).setText(this.t("border.pattern"));
      const grid = el("div", "unidraw-border-dash-grid", patternField);
      const options: Array<{ style: StrokeStyle; label: MessageKey; sample: string }> = isLight
        ? [
            { style: "light", label: "border.solid", sample: "solid" },
            { style: "dash2", label: "border.dash2", sample: "dash2" },
            { style: "dashed", label: "border.dash3", sample: "dash3" },
            { style: "dash4", label: "border.dash4", sample: "dash4" },
          ]
        : [
            { style: "heavy", label: "border.solid", sample: "solid" },
            { style: "heavyDash2", label: "border.dash2", sample: "dash2" },
            { style: "heavyDash3", label: "border.dash3", sample: "dash3" },
            { style: "heavyDash4", label: "border.dash4", sample: "dash4" },
          ];
      for (const option of options) {
        const button = el("button", "unidraw-border-dash-option", grid) as HTMLButtonElement;
        button.type = "button";
        button.toggleClass("is-active", object.style === option.style);
        button.setAttribute("aria-label", this.t(option.label));
        this.host.tooltip(button, this.t(option.label));
        el("span", `unidraw-border-dash-sample is-${option.sample}`, button);
        button.addEventListener("click", () => {
          this.lastBorderStyle = option.style;
          this.editor.setSelectedStyle(option.style);
          this.updateStatus();
        });
      }
    }

    if (isLight) {
      const rounded = el("label", "unidraw-border-rounded", parent);
      const checkbox = el("input", "unidraw-border-rounded-check", rounded) as HTMLInputElement;
      checkbox.type = "checkbox";
      checkbox.checked = object.style === "rounded";
      el("span", "unidraw-border-rounded-label", rounded).setText(this.t("border.rounded"));
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          if (object.style !== "rounded") this.lastBorderStyle = object.style;
          this.editor.setSelectedStyle("rounded");
        } else {
          const fallback = lightFamily.includes(this.lastBorderStyle) && this.lastBorderStyle !== "rounded"
            ? this.lastBorderStyle
            : "light";
          this.editor.setSelectedStyle(fallback);
        }
        this.updateStatus();
      });
    }
  }

  private buildRectFillControls(parent: HTMLElement, object: RectObject): void {
    const blockFills = ["█", "▓", "▒", "░", "▚", "▞", "▙", "▟", "■", "▪", "▮", "▰"];
    const fill = getShapeFill(object) ?? "";
    const mode = object.fillMode ?? (fill === "" ? "empty" : "custom");
    const blockChar = blockFills.includes(fill) ? fill : blockFills[0];
    const customChar = fill && fill !== "" ? fill : object.fillChar || "█";

    const field = el("div", "unidraw-fill-field", parent);
    el("div", "unidraw-text-field-label", field).setText(this.t("inspector.fillMode"));
    const tabs = el("div", "unidraw-fill-tabs", field);
    const tab = (tabMode: RectFillMode, label: MessageKey, iconName: string): void => {
      const button = el("button", "unidraw-fill-tab", tabs) as HTMLButtonElement;
      button.type = "button";
      button.toggleClass("is-active", mode === tabMode);
      button.setAttribute("aria-label", this.t(label));
      this.host.tooltip(button, this.t(label));
      const preview = el("span", `unidraw-fill-tab-preview is-${tabMode}`, button);
      setIconSafe(this.host, el("span", "unidraw-fill-tab-icon", preview), iconName);
      button.addEventListener("click", () => {
        if (tabMode === "empty") this.editor.setSelectedRectFill("empty");
        else if (tabMode === "block") this.editor.setSelectedRectFill("block", blockChar);
        else this.editor.setSelectedRectFill("custom", customChar);
        this.updateStatus();
      });
    };
    tab("empty", "fill.tab.empty", "grid");
    tab("block", "fill.tab.block", "square");
    tab("custom", "fill.tab.custom", "pencil");

    if (mode === "block") {
      const detail = el("div", "unidraw-fill-detail", parent);
      el("div", "unidraw-text-field-label", detail).setText(this.t("fill.blockGrid"));
      const grid = el("div", "unidraw-fill-block-grid", detail);
      for (const ch of blockFills) {
        const button = el("button", "unidraw-fill-block-btn", grid) as HTMLButtonElement;
        button.type = "button";
        button.setText(ch);
        button.toggleClass("is-active", fill === ch);
        button.setAttribute("aria-label", `${this.t("fill.tab.block")} ${ch}`);
        this.host.tooltip(button, ch);
        button.addEventListener("click", () => {
          this.editor.setSelectedRectFill("block", ch);
          this.updateStatus();
        });
      }
    } else if (mode === "custom") {
      const detail = el("div", "unidraw-fill-detail", parent);
      el("div", "unidraw-text-field-label", detail).setText(this.t("inspector.fillChar"));
      const row = el("div", "unidraw-fill-custom-row", detail);
      const swatch = el("button", "unidraw-fill-custom-swatch", row) as HTMLButtonElement;
      swatch.type = "button";
      swatch.setText(customChar);
      swatch.setAttribute("aria-label", this.t("fill.custom"));
      this.host.tooltip(swatch, this.t("fill.custom"));
      swatch.addEventListener("click", () => this.openCharPalette(swatch, "selectedFill"));
    }
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
    const section = this.inspectorSection(this.t("element.type.group"));
    el("div", "unidraw-inspector-note", section).setText(
      this.t("element.children", { count: object.children.length }),
    );

    const renderField = el("div", "unidraw-group-field", section);
    el("div", "unidraw-text-field-label", renderField).setText(this.t("group.renderMode"));
    const renderGrid = el("div", "unidraw-group-choice-grid", renderField);
    const mode = object.renderMode ?? "separate";
    const option = (id: "separate" | "merge", label: MessageKey): void => {
      const button = el("button", "unidraw-group-choice", renderGrid) as HTMLButtonElement;
      button.type = "button";
      button.toggleClass("is-active", mode === id);
      button.setText(this.t(label));
      button.addEventListener("click", () => {
        this.editor.setGroupRenderMode(object.id, id);
        this.updateStatus();
      });
    };
    option("separate", "group.separate");
    option("merge", "group.merge");

    const save = el("button", "unidraw-group-template-btn", section) as HTMLButtonElement;
    save.type = "button";
    setIconSafe(this.host, el("span", "unidraw-group-template-icon", save), "layout-template");
    el("span", "", save).setText(this.t("group.saveTemplate"));
    save.addEventListener("click", () => {
      void this.saveGroupAsTemplate(object);
    });
  }

  private async saveGroupAsTemplate(object: Extract<DrawingObject, { kind: "group" }>): Promise<void> {
    if (!this.host.saveGroupTemplate) {
      this.showToastKey("group.templateFailed");
      return;
    }
    const ok = await this.host.saveGroupTemplate({
      version: 1,
      name: object.name?.trim() || this.t("element.type.group"),
      savedAt: new Date().toISOString(),
      group: object,
    });
    this.showToastKey(ok ? "group.templateSaved" : "group.templateFailed");
  }

  private buildTextControls(parent: HTMLElement, object: RectObject): void {
    this.inspectorTextGrid(parent, object);
    this.inspectorTextFlow(parent, object);
    this.inspectorTextPadding(parent, object);
  }

  private inspectorTextGrid(section: HTMLElement, object: RectObject): void {
    const field = el("div", "unidraw-text-field", section);
    el("div", "unidraw-text-field-label", field).setText(this.t("inspector.align"));
    const grid = el("div", "unidraw-text-grid", field);
    const hAligns: TextAlignH[] = ["left", "center", "right"];
    const vAligns: TextAlignV[] = ["top", "middle", "bottom"];
    for (const vAlign of vAligns) {
      for (const hAlign of hAligns) {
        const button = el("button", "unidraw-text-grid-btn", grid) as HTMLButtonElement;
        button.type = "button";
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
    const directionField = el("div", "unidraw-text-field", section);
    el("div", "unidraw-text-field-label", directionField).setText(this.t("inspector.direction"));
    const directionOptions = el("div", "unidraw-text-options", directionField);
    for (const direction of ["horizontal", "vertical"] as TextDirection[]) {
      const button = el("button", "unidraw-text-option", directionOptions) as HTMLButtonElement;
      button.type = "button";
      button.setText(direction === "horizontal" ? "↔" : "↕");
      button.toggleClass("is-active", (object.direction ?? "horizontal") === direction);
      this.host.tooltip(button, this.t(`direction.${direction}` as MessageKey));
      button.addEventListener("click", () => {
        this.editor.setSelectedTextDirection(direction);
        this.updateStatus();
      });
    }

    const wrapField = el("div", "unidraw-text-field", section);
    el("div", "unidraw-text-field-label", wrapField).setText(this.t("inspector.wrap"));
    const wrapOptions = el("div", "unidraw-text-options", wrapField);
    const direction = object.direction ?? "horizontal";
    const wraps = direction === "vertical" ? (["right", "left"] as TextWrapMode[]) : (["down", "up"] as TextWrapMode[]);
    const glyphs: Record<TextWrapMode, string> = { down: "↓", up: "↑", right: "→", left: "←" };
    for (const wrap of wraps) {
      const button = el("button", "unidraw-text-option", wrapOptions) as HTMLButtonElement;
      button.type = "button";
      button.setText(glyphs[wrap]);
      button.toggleClass("is-active", (object.wrap ?? "down") === wrap);
      this.host.tooltip(button, this.t(`wrap.${wrap}` as MessageKey));
      button.addEventListener("click", () => {
        this.editor.setSelectedTextWrap(wrap);
        this.updateStatus();
      });
    }
  }

  private inspectorTextPadding(section: HTMLElement, object: RectObject): void {
    const field = el("div", "unidraw-text-field", section);
    el("div", "unidraw-text-field-label", field).setText(this.t("inspector.padding"));
    const grid = el("div", "unidraw-text-padding", field);
    const padding = object.padding ?? { top: 0, right: 1, bottom: 0, left: 1 };
    const sides: Array<{ key: "top" | "right" | "bottom" | "left"; label: MessageKey; icon: string }> = [
      { key: "top", label: "inspector.paddingTop", icon: "↑" },
      { key: "right", label: "inspector.paddingRight", icon: "→" },
      { key: "bottom", label: "inspector.paddingBottom", icon: "↓" },
      { key: "left", label: "inspector.paddingLeft", icon: "←" },
    ];
    for (const side of sides) {
      const cell = el("div", "unidraw-text-padding-cell", grid);
      const icon = el("span", "unidraw-text-padding-icon", cell);
      icon.setText(side.icon);
      icon.setAttribute("aria-hidden", "true");
      const input = el("input", "unidraw-text-padding-input", cell) as HTMLInputElement;
      input.type = "number";
      input.min = "0";
      input.max = "20";
      input.value = String(padding[side.key]);
      input.setAttribute("aria-label", this.t(side.label));
      this.host.tooltip(input, this.t(side.label));
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

  private buildAlignControls(): void {
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
    const fontSize = Math.max(8, Math.min(40, cellH * 0.78, cellW * 1.55));
    const textareaStyles: Partial<CSSStyleDeclaration> = {
      left: `${Math.round(rect.left)}px`,
      top: `${Math.round(rect.top)}px`,
      width: `${Math.max(12, Math.round(rect.width))}px`,
      height: `${Math.max(12, Math.round(rect.height))}px`,
      paddingTop: `${Math.round(padding.top * cellH)}px`,
      paddingRight: `${Math.round(padding.right * cellW)}px`,
      paddingBottom: `${Math.round(padding.bottom * cellH)}px`,
      paddingLeft: `${Math.round(padding.left * cellW)}px`,
      fontSize: `${fontSize}px`,
      lineHeight: `${Math.max(11, cellH)}px`,
      textAlign: object.hAlign ?? "left",
    };
    if (object.direction === "vertical") textareaStyles.writingMode = "vertical-rl";
    textarea.setCssStyles(textareaStyles);
    // Match the canvas cell advance, not just the font size.
    const measureCanvas = document.createElement("canvas");
    const measure = measureCanvas.getContext("2d");
    if (measure) {
      const style = getComputedStyle(textarea);
      measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const advance = measure.measureText("M").width;
      if (advance > 0) textarea.setCssStyles({ letterSpacing: `${cellW - advance}px` });
    }
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
    popover.setCssStyles({
      position: "fixed",
      visibility: "hidden",
      maxWidth: "calc(100vw - 24px)",
    });
    // Measure first, then clamp the whole popover into the viewport.
    const popoverWidth = popover.offsetWidth;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - popoverWidth - 12));
    let top = rect.bottom + 6;
    let available = window.innerHeight - top - 12;
    if (available < 220 && rect.top > available) {
      top = Math.max(12, rect.top - Math.min(rect.top - 12, 520) - 6);
      available = window.innerHeight - top - 12;
    }
    popover.setCssStyles({
      left: `${left}px`,
      top: `${top}px`,
      maxHeight: `${Math.max(120, available)}px`,
      visibility: "visible",
    });
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

  async exportTextFile(): Promise<void> {
    const text = this.editor.getArtText();
    if (!text) {
      this.showToastKey("export.empty");
      return;
    }
    const filename = `${sanitizeFilename(this.host.getFileName())}.txt`;
    if (this.host.saveTextExport) {
      const ok = await this.host.saveTextExport(filename, text);
      this.showToastKey(ok ? "export.savedTxt" : "export.exportFailed");
      return;
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, filename);
    this.showToastKey("export.savedTxt");
  }

  async exportMarkdownFile(): Promise<void> {
    const text = this.editor.getArtText();
    if (!text) {
      this.showToastKey("export.empty");
      return;
    }
    const filename = `${sanitizeFilename(this.host.getFileName())}.md`;
    if (this.host.saveTextExport) {
      const ok = await this.host.saveTextExport(filename, drawingToMarkdown(text));
      this.showToastKey(ok ? "export.savedMd" : "export.exportFailed");
      return;
    }
    const blob = new Blob([drawingToMarkdown(text)], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, filename);
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
    const keys = keyCombos(this.host.isMac());
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
      this.toastTimers.delete(timer);
      toast.removeClass("is-visible");
      window.setTimeout(() => toast.remove(), 180);
    }, 1600);
    this.toastTimers.add(timer);
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
    anchor.setCssStyles({
      position: "fixed",
      left: `${x}px`,
      top: `${y}px`,
      width: "0",
      height: "0",
    });
    this.popoverLayer.appendChild(anchor);
    this.openPopover(anchor, content, extraClass);
    anchor.remove();
  }

}
