/**
 * Unicode helpers: grapheme segmentation, display width (East Asian wide,
 * emoji, combining marks) and text normalisation.
 *
 * Character art lives on a monospace grid. Treating every code point as one
 * column breaks CJK labels, emoji and combining accents, so Unidraw stores one
 * grapheme cluster per cell, gives wide clusters two cells and keeps a
 * continuation marker in the grid for the second column.
 */

const segmenter: Intl.Segmenter | null =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

const EMOJI_RE = /\p{Extended_Pictographic}/u;
const EMOJI_PRESENTATION_RE = /\p{Emoji_Presentation}/u;
const REGIONAL_INDICATOR_RE = /[\u{1F1E6}-\u{1F1FF}]/u;
const EMOJI_MODIFIER_RE = /\p{Emoji_Modifier}/u;
const MARK_RE = /\p{Mark}/u;
const VS16 = "\uFE0F";
const VS15 = "\uFE0E";
const ZWJ = "\u200D";

/** Split a string into user-perceived characters. */
export function graphemes(text: string): string[] {
  if (!text) return [];
  if (segmenter) {
    const out: string[] = [];
    for (const part of segmenter.segment(text)) out.push(part.segment);
    return out;
  }
  return Array.from(text);
}

/** First grapheme cluster of a string, or an empty string. */
export function firstGrapheme(text: string): string {
  if (!text) return "";
  if (segmenter) {
    for (const part of segmenter.segment(text)) return part.segment;
  }
  return Array.from(text)[0] ?? "";
}

function isZeroWidthCodePoint(cp: number): boolean {
  return (
    cp === 0x200b || // zero width space
    cp === 0x200c || // zero width non-joiner
    cp === 0x200d || // zero width joiner
    cp === 0xfe0e ||
    cp === 0xfe0f ||
    cp === 0xfeff ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xe0100 && cp <= 0xe01ef) ||
    (cp >= 0x1160 && cp <= 0x11ff) || // Hangul medial/final jamo
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe20 && cp <= 0xfe2f)
  );
}

/**
 * East Asian Wide / Fullwidth ranges. This is a practical approximation of
 * UAX #11, not a full data-table download. Ambiguous-width characters are
 * treated as narrow, which matches most western terminals and editors.
 */
function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo initial
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, Kangxi, symbols
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana, Katakana, CJK compatibility
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1b000 && cp <= 0x1b2ff) ||
    (cp >= 0x1f200 && cp <= 0x1f251) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function clusterHasEmojiPresentation(cluster: string): boolean {
  if (cluster.includes(VS16)) return true;
  if (cluster.includes(VS15)) return false;
  if (cluster.includes(ZWJ)) return EMOJI_RE.test(cluster);
  if (REGIONAL_INDICATOR_RE.test(cluster)) return true;
  if (EMOJI_MODIFIER_RE.test(cluster)) return EMOJI_RE.test(cluster);
  return EMOJI_PRESENTATION_RE.test(cluster);
}

/** Display width of one grapheme cluster: 0, 1 or 2 grid columns. */
export function graphemeWidth(cluster: string): number {
  if (!cluster) return 0;
  if (cluster === "\n" || cluster === "\r" || cluster === "\t") return 0;
  if (clusterHasEmojiPresentation(cluster)) return 2;
  if (cluster.includes(VS15)) {
    // Text presentation: fall through to East-Asian width of the base.
  }

  let maxWidth = 0;
  for (const ch of cluster) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isZeroWidthCodePoint(cp)) continue;
    if (MARK_RE.test(ch)) continue;
    if (isWideCodePoint(cp)) {
      maxWidth = Math.max(maxWidth, 2);
    } else {
      maxWidth = Math.max(maxWidth, 1);
    }
  }
  // A cluster made only of combining marks still needs a cell to live in.
  return maxWidth === 0 ? 1 : maxWidth;
}

export function isWideCluster(cluster: string): boolean {
  return graphemeWidth(cluster) > 1;
}

/** Display width of a whole string. Tabs use a 4-column stop. */
export function displayWidth(text: string, tabSize = 4): number {
  let width = 0;
  for (const part of graphemes(text)) {
    if (part === "\t") {
      width += tabSize - (width % tabSize);
    } else if (part === "\n" || part === "\r") {
      continue;
    } else {
      width += graphemeWidth(part);
    }
  }
  return width;
}

/** Replace tabs with spaces, normalise newlines and remove control junk. */
export function normalizeText(text: string, tabSize = 4): string {
  const cleaned = text.replace(/\r\n?/g, "\n").replace(/\uFEFF/g, "").replace(/\u0000/g, "");
  return cleaned
    .split("\n")
    .map((line) => {
      if (!line.includes("\t")) return line;
      let out = "";
      let width = 0;
      for (const part of graphemes(line)) {
        if (part === "\t") {
          const spaces = tabSize - (width % tabSize);
          out += " ".repeat(spaces);
          width += spaces;
        } else {
          out += part;
          width += graphemeWidth(part);
        }
      }
      return out;
    })
    .join("\n");
}

/** Format code points for the status bar / palette tooltips. */
export function codePointLabel(cluster: string): string {
  if (!cluster) return "";
  const points: string[] = [];
  for (const ch of cluster) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    points.push(`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  return points.join(" ");
}

/**
 * Human readable width name used in tooltips.
 */
export function widthLabel(cluster: string): string {
  const w = graphemeWidth(cluster);
  return w === 2 ? "wide" : w === 1 ? "narrow" : "zero";
}

/** Pad a string with spaces to a given display width. */
export function padDisplay(text: string, width: number): string {
  const current = displayWidth(text);
  return current >= width ? text : text + " ".repeat(width - current);
}

/** Convert a code point to a character safely. */
export function fromCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}
