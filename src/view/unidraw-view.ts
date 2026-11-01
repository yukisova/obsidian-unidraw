import {
  ItemView,
  MarkdownView,
  Notice,
  Platform,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  setIcon,
  setTooltip,
  type ViewStateResult,
} from "obsidian";
import { VIEW_TYPE_UNIDRAW } from "../core/format";
import {
  UnidrawEditorUI,
  type UnidrawUIHost,
  type GroupTemplatePayload,
  type UnidrawUISettings,
} from "../ui/editor-ui";
import type UnidrawPlugin from "../main";

export class UnidrawView extends ItemView {
  private plugin: UnidrawPlugin;
  private ui: UnidrawEditorUI | null = null;
  private filePath: string | null = null;
  private loadedPath: string | null = null;
  private lastSavedContent = "";
  private dirty = false;
  private saving = false;
  private closing = false;
  private loadToken = 0;
  private saveTimer: number | null = null;
  private lastMarkdownLeaf: WorkspaceLeaf | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: UnidrawPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = true;
  }

  override getViewType(): string {
    return VIEW_TYPE_UNIDRAW;
  }

  override getDisplayText(): string {
    if (this.filePath) {
      const file = this.app.vault.getAbstractFileByPath(this.filePath);
      if (file instanceof TFile) return file.name;
      return this.filePath.split("/").pop() ?? this.plugin.t("app.name");
    }
    return this.plugin.t("app.name");
  }

  override getIcon(): string {
    return "pencil-ruler";
  }

  getFilePath(): string | null {
    return this.filePath;
  }

  override getState(): Record<string, unknown> {
    return this.filePath ? { file: this.filePath } : {};
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const data = (state ?? {}) as { file?: unknown; path?: unknown };
    const next = typeof data.file === "string" ? data.file : typeof data.path === "string" ? data.path : null;
    if (next && next !== this.filePath) {
      this.filePath = next;
    }
    if (this.ui && this.filePath && this.filePath !== this.loadedPath) {
      await this.loadCurrentFile();
    }
  }

  override async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("unidraw-view");
    this.ui = new UnidrawEditorUI(container, this.createHost());
    this.registerViewEvents();
    this.rememberActiveMarkdownLeaf();

    if (!this.filePath) {
      const state = this.leaf.getViewState().state as { file?: unknown; path?: unknown } | undefined;
      const path = typeof state?.file === "string" ? state.file : typeof state?.path === "string" ? state.path : null;
      if (path) this.filePath = path;
    }
    if (this.filePath) await this.loadCurrentFile();
    else this.ui.loadText("");
  }

  private async saveTextExport(filename: string, content: string): Promise<boolean> {
    try {
      const folder = this.filePath ? this.filePath.split("/").slice(0, -1).join("/") : "";
      const base = normalizePath(folder ? `${folder}/${filename}` : filename);
      const dot = base.lastIndexOf(".");
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : "";
      let path = base;
      let index = 1;
      while (this.app.vault.getAbstractFileByPath(path)) {
        path = `${stem} ${index}${ext}`;
        index += 1;
      }
      await this.app.vault.create(path, content);
      return true;
    } catch {
      return false;
    }
  }

  private async saveGroupTemplate(template: GroupTemplatePayload): Promise<boolean> {
    try {
      const dir = this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
      const path = `${dir}/group-templates.json`;
      const adapter = this.app.vault.adapter;
      let templates: GroupTemplatePayload[] = [];
      if (await adapter.exists(path)) {
        const raw = await adapter.read(path);
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) templates = parsed as GroupTemplatePayload[];
      }
      templates.push(template);
      await adapter.write(path, JSON.stringify(templates, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  private createHost(): UnidrawUIHost {
    return {
      icon: (el, name) => setIcon(el, name),
      tooltip: (el, text) => setTooltip(el, text, { placement: "bottom" }),
      isActive: () => this.app.workspace.getActiveViewOfType(UnidrawView) === this,
      getSettings: () => this.plugin.settings as UnidrawUISettings,
      getVersion: () => this.plugin.manifest.version,
      isMac: () => Platform.isMacOS || Platform.isIosApp,
      requestSave: () => this.scheduleSave(),
      saveNow: () => void this.save({ manual: true, force: true }),
      getFileName: () => this.fileBaseName(),
      insertIntoNote: (markdown) => this.insertIntoNote(markdown),
      savePluginSettings: () => {
        void this.plugin.saveSettings();
      },
      saveGroupTemplate: (template) => this.saveGroupTemplate(template),
      saveTextExport: (filename, content) => this.saveTextExport(filename, content),
    };
  }

  private registerViewEvents(): void {
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (oldPath !== this.filePath) return;
        this.filePath = file.path;
        this.loadedPath = file.path;
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        if (file.path !== this.filePath || !this.ui) return;
        if (this.saving || this.dirty || this.saveTimer !== null || this.closing) return;
        void this.reloadIfChanged();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView) this.lastMarkdownLeaf = leaf;
        if (this.app.workspace.getActiveViewOfType(UnidrawView) !== this) {
          void this.flushSave();
        }
      }),
    );
  }

  private rememberActiveMarkdownLeaf(): void {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) {
      const leaf = this.app.workspace
        .getLeavesOfType("markdown")
        .find((candidate) => candidate.view === active);
      if (leaf) this.lastMarkdownLeaf = leaf;
    }
    if (!this.lastMarkdownLeaf) {
      const leaves = this.app.workspace.getLeavesOfType("markdown");
      this.lastMarkdownLeaf = leaves[leaves.length - 1] ?? null;
    }
  }

  private fileBaseName(): string {
    if (this.filePath) {
      const file = this.app.vault.getAbstractFileByPath(this.filePath);
      if (file instanceof TFile) return file.basename;
      const name = this.filePath.split("/").pop() ?? "";
      return name.replace(/\.[^.]+$/u, "");
    }
    return this.plugin.t("app.name");
  }

  private async loadCurrentFile(): Promise<void> {
    if (!this.ui || !this.filePath) return;
    const token = ++this.loadToken;
    const path = this.filePath;
    try {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        if (token !== this.loadToken) return;
        this.loadedPath = path;
        this.lastSavedContent = "";
        this.dirty = false;
        this.ui.loadText("");
        return;
      }
      const raw = await this.app.vault.read(file);
      if (token !== this.loadToken || this.closing) return;
      this.loadedPath = path;
      this.lastSavedContent = raw;
      this.dirty = false;
      this.ui.loadText(raw);
      this.ui.setSaveState("saved");
    } catch {
      if (token !== this.loadToken) return;
      this.ui.setSaveState("error");
      new Notice(this.plugin.t("notice.loadFailed"));
    }
  }

  private async reloadIfChanged(): Promise<void> {
    if (!this.filePath || !this.ui || this.dirty) return;
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile)) return;
    try {
      const raw = await this.app.vault.read(file);
      if (this.dirty || this.closing || raw === this.lastSavedContent) return;
      this.lastSavedContent = raw;
      this.ui.loadText(raw);
      this.ui.setSaveState("saved");
    } catch {
      /* ignore transient read errors */
    }
  }

  private scheduleSave(): void {
    if (!this.ui || !this.filePath || this.closing) return;
    this.dirty = true;
    this.ui.setSaveState("unsaved");
    if (!this.plugin.settings.autosave) return;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, Math.max(150, this.plugin.settings.saveDelayMs));
  }

  async save(options: { manual?: boolean; force?: boolean } = {}): Promise<void> {
    if (!this.ui || !this.filePath || this.closing) return;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.ui.getEditor().commitPendingText();
    const content = this.ui.getText();
    if (!options.force && !this.dirty && content === this.lastSavedContent) return;
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile)) {
      this.ui.setSaveState("error");
      new Notice(this.plugin.t("notice.saveFailed"));
      return;
    }
    this.saving = true;
    this.ui.setSaveState("saving");
    try {
      await this.app.vault.modify(file, content);
      this.lastSavedContent = content;
      this.dirty = false;
      this.ui.setSaveState("saved");
      if (options.manual) new Notice(this.plugin.t("notice.saved"));
    } catch {
      try {
        await this.app.vault.adapter.write(file.path, content);
        this.lastSavedContent = content;
        this.dirty = false;
        this.ui.setSaveState("saved");
      } catch {
        this.ui.setSaveState("error");
        new Notice(this.plugin.t("notice.saveFailed"));
      }
    } finally {
      this.saving = false;
    }
  }

  private async flushSave(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty && this.filePath && this.ui) {
      this.ui.getEditor().commitPendingText();
      await this.save();
    }
  }

  applySettings(): void {
    this.ui?.applySettings(this.plugin.settings as UnidrawUISettings);
  }

  getUI(): UnidrawEditorUI | null {
    return this.ui;
  }

  copyDrawingAsText(): void {
    this.ui?.copyTextCommand();
  }

  exportPng(): void {
    this.ui?.exportPngCommand();
  }

  showHelp(): void {
    this.ui?.openHelpCommand();
  }

  toggleGrid(): void {
    this.ui?.getEditor().toggleGrid();
  }

  fitView(): void {
    this.ui?.getEditor().fitView();
  }

  insertCurrentDrawingIntoNote(): boolean {
    if (!this.ui) return false;
    this.ui.getEditor().commitPendingText();
    const text = this.ui.getEditor().getArtText();
    if (!text) return false;
    return this.insertIntoNote(`\`\`\`unidraw\n${text}\n\`\`\``);
  }

  private findMarkdownView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;
    const candidates = this.app.workspace.getLeavesOfType("markdown");
    const preferred = this.lastMarkdownLeaf && candidates.includes(this.lastMarkdownLeaf)
      ? this.lastMarkdownLeaf
      : candidates[candidates.length - 1];
    const view = preferred?.view;
    return view instanceof MarkdownView ? view : null;
  }

  private insertIntoNote(markdown: string): boolean {
    const target = this.findMarkdownView();
    if (!target) return false;
    const leaf = this.app.workspace
      .getLeavesOfType("markdown")
      .find((candidate) => candidate.view === target);
    if (leaf && this.app.workspace.getActiveViewOfType(MarkdownView) !== target) {
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
    }
    const editor = target.editor;
    const prefix = editor.getCursor().ch === 0 ? "" : "\n";
    editor.replaceSelection(`${prefix}${markdown}\n`);
    return true;
  }

  override async onClose(): Promise<void> {
    this.closing = true;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const id = ++this.loadToken;
    void id;
    if (this.ui) {
      this.ui.getEditor().commitPendingText();
      if (this.dirty && this.filePath) {
        const content = this.ui.getText();
        const file = this.app.vault.getAbstractFileByPath(this.filePath);
        if (file instanceof TFile) {
          try {
            await this.app.vault.modify(file, content);
          } catch {
            /* best effort on close */
          }
        }
      }
      this.ui.destroy();
      this.ui = null;
    }
  }

}
