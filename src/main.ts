import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  type MarkdownPostProcessorContext,
  type WorkspaceLeaf,
} from "obsidian";
import {
  FILE_EXTENSION,
  VIEW_TYPE_UNIDRAW,
  defaultDrawingName,
  parseDrawing,
} from "./core/format";
import {
  composeData,
  parseUnidraw,
  serializeUnidraw,
} from "./core/file-format";
import { createDefaultData } from "./core/objects";
import {
  createTranslator,
  resolveLanguage,
  type MessageKey,
  type Translator,
} from "./core/i18n";
import {
  DEFAULT_SETTINGS,
  UnidrawSettingTab,
  normalizeSettings,
  type UnidrawSettings,
} from "./settings";
import { UnidrawView } from "./view/unidraw-view";
import { renderArtFrame } from "./view/embed";

export default class UnidrawPlugin extends Plugin {
  override settings: UnidrawSettings = { ...DEFAULT_SETTINGS };
  private translator: Translator = createTranslator("en");

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.translator = createTranslator(resolveLanguage(this.settings.language));

    this.registerView(VIEW_TYPE_UNIDRAW, (leaf: WorkspaceLeaf) => new UnidrawView(leaf, this));
    this.registerExtensions([FILE_EXTENSION], VIEW_TYPE_UNIDRAW);

    this.addRibbonIcon("pencil", this.t("command.new"), () => void this.createDrawing());

    this.registerCommands();
    this.registerProcessors();

    this.addSettingTab(new UnidrawSettingTab(this.app, this));
  }

  t(key: MessageKey, vars?: Record<string, string | number>): string {
    return this.translator(key, vars);
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.translator = createTranslator(resolveLanguage(this.settings.language));
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.translator = createTranslator(resolveLanguage(this.settings.language));
  }

  refreshOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_UNIDRAW)) {
      if (leaf.view instanceof UnidrawView) leaf.view.applySettings();
    }
  }

  private activeDrawing(): UnidrawView | null {
    return this.app.workspace.getActiveViewOfType(UnidrawView);
  }

  private drawingCommand(fn: (view: UnidrawView) => void) {
    return (checking: boolean): boolean => {
      const view = this.activeDrawing();
      if (!view) return false;
      if (!checking) fn(view);
      return true;
    };
  }

  private registerCommands(): void {
    this.addCommand({
      id: "new-drawing",
      name: this.t("command.new"),
      callback: () => void this.createDrawing(),
    });

    this.addCommand({
      id: "new-from-selection",
      name: this.t("command.newFromSelection"),
      checkCallback: (checking: boolean) => {
        const markdown = this.app.workspace.getActiveViewOfType(MarkdownView);
        const selection = markdown?.editor?.getSelection() ?? "";
        if (!selection.trim()) return false;
        if (!checking) void this.createDrawing(selection);
        return true;
      },
    });

    this.addCommand({
      id: "undo",
      name: this.t("command.undo"),
      checkCallback: this.drawingCommand((view) => view.getUI()?.getEditor().undo()),
    });
    this.addCommand({
      id: "redo",
      name: this.t("command.redo"),
      checkCallback: this.drawingCommand((view) => view.getUI()?.getEditor().redo()),
    });
    this.addCommand({
      id: "copy-as-text",
      name: this.t("command.copyText"),
      checkCallback: this.drawingCommand((view) => view.copyDrawingAsText()),
    });
    this.addCommand({
      id: "export-png",
      name: this.t("command.exportPng"),
      checkCallback: this.drawingCommand((view) => view.exportPng()),
    });
    this.addCommand({
      id: "insert-into-note",
      name: this.t("command.insertIntoNote"),
      checkCallback: this.drawingCommand((view) => {
        if (!view.insertCurrentDrawingIntoNote()) new Notice(this.t("export.noNote"));
      }),
    });
    this.addCommand({
      id: "toggle-grid",
      name: this.t("command.toggleGrid"),
      checkCallback: this.drawingCommand((view) => view.toggleGrid()),
    });
    this.addCommand({
      id: "fit-view",
      name: this.t("command.fit"),
      checkCallback: this.drawingCommand((view) => view.fitView()),
    });
    this.addCommand({
      id: "help",
      name: this.t("command.help"),
      checkCallback: this.drawingCommand((view) => view.showHelp()),
    });
  }

  private registerProcessors(): void {
    const codeBlock = (source: string, el: HTMLElement): void => {
      el.empty();
      el.addClass("unidraw-code-block-host");
      const doc = parseDrawing(source, { fromEmbed: true });
      renderArtFrame(el, {
        text: doc.trimmedText(),
        label: this.t("app.name"),
        file: null,
        settings: this.settings,
        t: this.translator,
      });
    };
    this.registerMarkdownCodeBlockProcessor("unidraw", codeBlock);
    this.registerMarkdownCodeBlockProcessor("udraw", codeBlock);

    this.registerMarkdownPostProcessor((el, ctx) => {
      const embeds = Array.from(el.querySelectorAll<HTMLElement>(".internal-embed"));
      for (const embedEl of embeds) {
        void this.renderFileEmbed(embedEl, ctx);
      }
    }, 20);
  }

  private async renderFileEmbed(embedEl: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    if (embedEl.dataset.unidrawProcessed === "true") return;
    const rawSrc =
      embedEl.getAttribute("src") ??
      embedEl.getAttribute("data-href") ??
      embedEl.querySelector<HTMLElement>("a.internal-link")?.getAttribute("data-href") ??
      "";
    if (!rawSrc) return;
    let src = rawSrc.split("|")[0]?.split("#")[0]?.trim() ?? "";
    if (!src) return;
    try {
      src = decodeURIComponent(src);
    } catch {
      /* keep the raw link */
    }
    const file = this.app.metadataCache.getFirstLinkpathDest(src, ctx.sourcePath);
    if (!(file instanceof TFile) || file.extension !== FILE_EXTENSION) return;
    embedEl.dataset.unidrawProcessed = "true";
    try {
      const raw = await this.app.vault.read(file);
      if (!embedEl.isConnected) return;
      const doc = composeData(parseUnidraw(raw)).doc;
      embedEl.empty();
      embedEl.addClass("unidraw-embed-host");
      renderArtFrame(embedEl, {
        text: doc.trimmedText(),
        label: file.basename,
        file,
        openFile: (target) => void this.app.workspace.openLinkText(target.path, ctx.sourcePath, false),
        settings: this.settings,
        t: this.translator,
      });
    } catch {
      embedEl.dataset.unidrawProcessed = "false";
    }
  }

  async createDrawing(content = ""): Promise<void> {
    const initial = content ? serializeUnidraw(parseUnidraw(content)) : serializeUnidraw(createDefaultData());
    const activeFile = this.app.workspace.getActiveFile();
    const folder = this.app.fileManager.getNewFileParent(activeFile?.path ?? "");
    const base = defaultDrawingName();
    let suffix = "";
    let path = "";
    for (let i = 1; i < 1000; i++) {
      suffix = i === 1 ? "" : ` ${i}`;
      const name = `${base}${suffix}.${FILE_EXTENSION}`;
      path = folder.path ? `${folder.path}/${name}` : name;
      if (!this.app.vault.getAbstractFileByPath(path)) break;
    }
    let file: TFile;
    try {
      file = await this.app.vault.create(path, initial);
    } catch {
      new Notice(this.t("notice.saveFailed"));
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: VIEW_TYPE_UNIDRAW,
      state: { file: file.path },
      active: true,
    });
    void this.app.workspace.revealLeaf(leaf);
    new Notice(this.t("notice.created", { name: file.name }));
  }
}
