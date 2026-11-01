import type { TFile } from "obsidian";
import type { Translator } from "../core/i18n";
import type { UnidrawSettings } from "../settings";
import { FONT_STACKS } from "../core/types";
import { copyTextToClipboard } from "../render/export-image";

export interface ArtFrameOptions {
  text: string;
  label: string;
  file: TFile | null;
  openFile?: (file: TFile) => void;
  settings: UnidrawSettings;
  t: Translator;
}

/**
 * Shared rendering for Markdown code blocks and `![[drawing.unidraw]]` embeds.
 * Uses plain DOM so it behaves identically in Reading view and Live Preview.
 */
export function renderArtFrame(host: HTMLElement, options: ArtFrameOptions): HTMLElement {
  const frame = host.createDiv({ cls: "unidraw-embed" });
  frame.setCssProps({
    "--unidraw-embed-font-size": `${options.settings.embedFontSize}px`,
    "--unidraw-embed-line-height": String(options.settings.embedLineHeight),
  });
  const stack = FONT_STACKS[options.settings.fontFamily];
  if (stack) frame.setCssProps({ "--unidraw-embed-font": stack });

  const bar = frame.createDiv({ cls: "unidraw-embed-bar" });
  const label = bar.createSpan({ cls: "unidraw-embed-label", text: options.label });
  label.setAttribute("title", options.label);
  const actions = bar.createDiv({ cls: "unidraw-embed-actions" });
  const copy = actions.createEl("button", {
    cls: "unidraw-embed-action",
    text: options.t("embed.copy"),
  });
  copy.type = "button";
  copy.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void copyTextToClipboard(options.text).then((ok) => {
      if (!ok) return;
      copy.textContent = options.t("embed.copied");
      window.setTimeout(() => {
        copy.textContent = options.t("embed.copy");
      }, 1400);
    });
  });
  if (options.file && options.openFile) {
    const open = actions.createEl("button", {
      cls: "unidraw-embed-action",
      text: options.t("embed.open"),
    });
    open.type = "button";
    open.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (options.file && options.openFile) options.openFile(options.file);
    });
  }

  const pre = frame.createEl("pre", { cls: "unidraw-embed-art" });
  if (options.text) {
    pre.setText(options.text);
  } else {
    pre.addClass("is-empty");
    pre.setText(options.t("status.blank"));
  }
  frame.addEventListener("dblclick", () => {
    if (options.file && options.openFile) options.openFile(options.file);
  });
  return frame;
}
