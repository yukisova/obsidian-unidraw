import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import {
  createTranslator,
  resolveLanguage,
  type LanguageSetting,
  type MessageKey,
  type Translator,
} from "./core/i18n";
import {
  DEFAULT_EDITOR_SETTINGS,
  FONT_STACKS,
  type FillMode,
  type GridMode,
  type StrokeStyle,
  type TextTransform,
} from "./core/types";
import { firstGrapheme } from "./core/unicode";
import type UnidrawPlugin from "./main";

export interface UnidrawSettings {
  language: LanguageSetting;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  grid: GridMode;
  defaultStroke: StrokeStyle;
  showStatusBar: boolean;
  textTransform: TextTransform;
  drawChar: string;
  fillChar: string;
  shapeFill: FillMode;
  brushSize: number;
  autosave: boolean;
  saveDelayMs: number;
  embedFontSize: number;
  embedLineHeight: number;
}

export const DEFAULT_SETTINGS: UnidrawSettings = {
  ...DEFAULT_EDITOR_SETTINGS,
  language: "auto",
  autosave: true,
  saveDelayMs: 600,
  embedFontSize: 14,
  embedLineHeight: 1.2,
};

const STROKE_STYLES: StrokeStyle[] = ["light", "heavy", "double", "rounded", "dashed", "ascii"];
const GRID_MODES: GridMode[] = ["dots", "lines", "none"];
const FILL_MODES: FillMode[] = ["none", "light", "medium", "dark", "solid", "dots", "checker", "hatch", "custom"];
const TEXT_TRANSFORMS: TextTransform[] = [
  "normal",
  "fullwidth",
  "bold",
  "italic",
  "boldItalic",
  "script",
  "boldScript",
  "fraktur",
  "doubleStruck",
  "sansSerif",
  "sansBold",
  "monospace",
  "circled",
  "squared",
  "smallCaps",
];

function clamp(n: number, min: number, max: number, fallback: number): number {
  const value = Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, value));
}

function includes<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

const GRID_SIZES = [4, 8, 12, 16];

function nearestGridSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.fontSize;
  return GRID_SIZES.reduce((best, size) => (Math.abs(size - value) < Math.abs(best - value) ? size : best), 12);
}

/** Merge stored JSON with defaults, tolerating older or malformed data. */
export function normalizeSettings(raw: unknown): UnidrawSettings {
  const data = (raw && typeof raw === "object" ? raw : {}) as Partial<UnidrawSettings>;
  const defaultLanguage: LanguageSetting =
    data.language === "auto" || data.language === "en" || data.language === "zh" ? data.language : "auto";
  return {
    language: defaultLanguage,
    fontFamily:
      typeof data.fontFamily === "string" && (data.fontFamily in FONT_STACKS || data.fontFamily.length === 0)
        ? data.fontFamily
        : DEFAULT_SETTINGS.fontFamily,
    fontSize: nearestGridSize(Number(data.fontSize)),
    lineHeight: clamp(Number(data.lineHeight), 0.9, 1.8, DEFAULT_SETTINGS.lineHeight),
    grid: includes(GRID_MODES, data.grid, DEFAULT_SETTINGS.grid),
    defaultStroke: includes(STROKE_STYLES, data.defaultStroke, DEFAULT_SETTINGS.defaultStroke),
    showStatusBar: typeof data.showStatusBar === "boolean" ? data.showStatusBar : DEFAULT_SETTINGS.showStatusBar,
    textTransform: includes(TEXT_TRANSFORMS, data.textTransform, DEFAULT_SETTINGS.textTransform),
    drawChar:
      typeof data.drawChar === "string" && data.drawChar.length > 0
        ? firstGrapheme(data.drawChar) || DEFAULT_SETTINGS.drawChar
        : DEFAULT_SETTINGS.drawChar,
    fillChar:
      typeof data.fillChar === "string" && data.fillChar.length > 0
        ? firstGrapheme(data.fillChar) || DEFAULT_SETTINGS.fillChar
        : DEFAULT_SETTINGS.fillChar,
    shapeFill: includes(FILL_MODES, data.shapeFill, DEFAULT_SETTINGS.shapeFill),
    brushSize: Math.round(clamp(Number(data.brushSize), 1, 3, DEFAULT_SETTINGS.brushSize)),
    autosave: typeof data.autosave === "boolean" ? data.autosave : DEFAULT_SETTINGS.autosave,
    saveDelayMs: Math.round(clamp(Number(data.saveDelayMs), 150, 5000, DEFAULT_SETTINGS.saveDelayMs)),
    embedFontSize: clamp(Number(data.embedFontSize), 9, 28, DEFAULT_SETTINGS.embedFontSize),
    embedLineHeight: clamp(Number(data.embedLineHeight), 0.9, 1.8, DEFAULT_SETTINGS.embedLineHeight),
  };
}

export class UnidrawSettingTab extends PluginSettingTab {
  plugin: UnidrawPlugin;
  private t: Translator;

  constructor(app: App, plugin: UnidrawPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.t = createTranslator(resolveLanguage(plugin.settings.language));
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("unidraw-settings");
    this.t = createTranslator(resolveLanguage(this.plugin.settings.language));

    const hero = containerEl.createDiv({ cls: "unidraw-settings-hero" });
    const logo = hero.createEl("pre", { cls: "unidraw-settings-logo" });
    logo.textContent = "╭─────────────────╮\n│  U N I D R A W  │\n╰─────── ✦ ───────╯";
    const heroText = hero.createDiv({ cls: "unidraw-settings-hero-text" });
    heroText.createEl("h2", { text: this.t("settings.title") });
    heroText.createEl("p", { text: this.t("settings.desc") });

    this.renderAppearance(containerEl);
    this.renderEditing(containerEl);
    this.renderEmbeds(containerEl);
    this.renderReset(containerEl);
  }

  private async commit(message?: MessageKey): Promise<void> {
    await this.plugin.saveSettings();
    this.plugin.refreshOpenViews();
    if (message) new Notice(this.t(message));
  }

  private renderAppearance(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(this.t("settings.appearance")).setHeading();

    new Setting(containerEl)
      .setName(this.t("settings.language"))
      .addDropdown((dropdown) => {
        const current = this.plugin.settings.language;
        dropdown.addOption("auto", this.t("settings.language.auto"));
        dropdown.addOption("en", "English");
        dropdown.addOption("zh", "中文");
        dropdown.setValue(current);
        dropdown.onChange(async (value) => {
          this.plugin.settings.language = value as LanguageSetting;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(this.t("settings.font"))
      .setDesc(this.t("settings.font.desc"))
      .addDropdown((dropdown) => {
        const fontKeys = Object.keys(FONT_STACKS);
        for (const key of fontKeys) {
          const labelKey = `settings.font.${key}` as MessageKey;
          dropdown.addOption(key, key === "obsidian" ? this.t("settings.font.obsidian") : this.t(labelKey));
        }
        dropdown.setValue(this.plugin.settings.fontFamily);
        dropdown.onChange(async (value) => {
          this.plugin.settings.fontFamily = value;
          await this.commit();
        });
      });

    new Setting(containerEl)
      .setName(this.t("settings.fontSize"))
      .setDesc(this.t("settings.gridSize.desc"))
      .addDropdown((dropdown) => {
        for (const size of GRID_SIZES) {
          dropdown.addOption(String(size), `${size} px`);
        }
        dropdown.setValue(String(this.plugin.settings.fontSize));
        dropdown.onChange(async (value) => {
          this.plugin.settings.fontSize = Number(value);
          await this.commit();
        });
      });

    new Setting(containerEl)
      .setName(this.t("settings.lineHeight"))
      .setDesc(this.t("settings.lineHeight.desc"))
      .addSlider((slider) => {
        slider
          .setLimits(0.95, 1.6, 0.01)
          .setValue(this.plugin.settings.lineHeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.lineHeight = value;
            await this.commit();
          });
      });

    new Setting(containerEl).setName(this.t("settings.grid")).addDropdown((dropdown) => {
      for (const mode of GRID_MODES) {
        dropdown.addOption(mode, this.t(`settings.grid.${mode}` as MessageKey));
      }
      dropdown.setValue(this.plugin.settings.grid);
      dropdown.onChange(async (value) => {
        this.plugin.settings.grid = value as GridMode;
        await this.commit();
      });
    });

    new Setting(containerEl)
      .setName(this.t("settings.statusBar"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showStatusBar).onChange(async (value) => {
          this.plugin.settings.showStatusBar = value;
          await this.commit();
        }),
      );
  }

  private renderEditing(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(this.t("settings.editing")).setHeading();

    new Setting(containerEl).setName(this.t("settings.defaultStroke")).addDropdown((dropdown) => {
      for (const style of STROKE_STYLES) {
        dropdown.addOption(style, this.t(`stroke.${style}` as MessageKey));
      }
      dropdown.setValue(this.plugin.settings.defaultStroke);
      dropdown.onChange(async (value) => {
        this.plugin.settings.defaultStroke = value as StrokeStyle;
        await this.commit();
      });
    });

    new Setting(containerEl).setName(this.t("settings.textStyle")).addDropdown((dropdown) => {
      for (const transform of TEXT_TRANSFORMS) {
        dropdown.addOption(transform, this.t(`textStyle.${transform}` as MessageKey));
      }
      dropdown.setValue(this.plugin.settings.textTransform);
      dropdown.onChange(async (value) => {
        this.plugin.settings.textTransform = value as TextTransform;
        await this.commit();
      });
    });

    new Setting(containerEl)
      .setName(this.t("settings.drawChar"))
      .setDesc(this.t("settings.drawChar.desc"))
      .addText((text) => {
        text.inputEl.maxLength = 8;
        text.setValue(this.plugin.settings.drawChar).onChange(async (value) => {
          const graph = firstGrapheme(value);
          if (!graph) return;
          this.plugin.settings.drawChar = graph;
          await this.commit();
        });
      });

    new Setting(containerEl)
      .setName(this.t("settings.autosave"))
      .setDesc(this.t("settings.autosave.desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autosave).onChange(async (value) => {
          this.plugin.settings.autosave = value;
          await this.commit();
        }),
      );

    new Setting(containerEl).setName(this.t("settings.saveDelay")).addSlider((slider) => {
      slider
        .setLimits(150, 3000, 50)
        .setValue(this.plugin.settings.saveDelayMs)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.saveDelayMs = value;
          await this.commit();
        });
    });
  }

  private renderEmbeds(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(this.t("settings.embeds")).setHeading();

    new Setting(containerEl).setName(this.t("settings.embedFontSize")).addSlider((slider) => {
      slider
        .setLimits(9, 28, 1)
        .setValue(this.plugin.settings.embedFontSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.embedFontSize = value;
          await this.commit();
          this.refreshEmbedStyles();
        });
    });

    new Setting(containerEl).setName(this.t("settings.embedLineHeight")).addSlider((slider) => {
      slider
        .setLimits(0.95, 1.6, 0.01)
        .setValue(this.plugin.settings.embedLineHeight)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.embedLineHeight = value;
          await this.commit();
          this.refreshEmbedStyles();
        });
    });
  }

  private renderReset(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(this.t("settings.reset")).addButton((button) => {
      button
        .setButtonText(this.t("settings.resetButton"))
        .setWarning()
        .onClick(async () => {
          Object.assign(this.plugin.settings, DEFAULT_SETTINGS);
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
          this.display();
          new Notice(this.t("settings.resetDone"));
        });
    });
  }

  private refreshEmbedStyles(): void {
    document.querySelectorAll<HTMLElement>(".unidraw-embed").forEach((el) => {
      el.style.setProperty("--unidraw-embed-font-size", `${this.plugin.settings.embedFontSize}px`);
      el.style.setProperty("--unidraw-embed-line-height", String(this.plugin.settings.embedLineHeight));
    });
  }
}
