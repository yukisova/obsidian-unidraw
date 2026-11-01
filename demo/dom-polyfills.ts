/**
 * Obsidian adds a few convenience helpers to HTMLElement. The standalone demo
 * runs in a plain browser, so provide the small subset the editor UI uses.
 */
type DomHelpers = {
  empty?: () => void;
  setText?: (text: string) => void;
  addClass?: (...classes: string[]) => void;
  removeClass?: (...classes: string[]) => void;
  toggleClass?: (cls: string, value?: boolean) => void;
  setCssStyles?: (styles: Partial<CSSStyleDeclaration>) => void;
};

const proto = HTMLElement.prototype as HTMLElement & DomHelpers;
if (!proto.empty) {
  proto.empty = function empty(this: HTMLElement) {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
}
if (!proto.setText) {
  proto.setText = function setText(this: HTMLElement, text: string) {
    this.textContent = text;
  };
}
if (!proto.addClass) {
  proto.addClass = function addClass(this: HTMLElement, ...classes: string[]) {
    this.classList.add(...classes.filter(Boolean));
  };
}
if (!proto.removeClass) {
  proto.removeClass = function removeClass(this: HTMLElement, ...classes: string[]) {
    this.classList.remove(...classes.filter(Boolean));
  };
}
if (!proto.toggleClass) {
  proto.toggleClass = function toggleClass(this: HTMLElement, cls: string, value?: boolean) {
    if (value === undefined) this.classList.toggle(cls);
    else this.classList.toggle(cls, value);
  };
}
if (!proto.setCssStyles) {
  proto.setCssStyles = function setCssStyles(this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(styles)) {
      if (value === undefined || value === null) continue;
      const property = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      parts.push(`${property}:${String(value)}`);
    }
    this.setAttribute("style", parts.join(";"));
  };
}
