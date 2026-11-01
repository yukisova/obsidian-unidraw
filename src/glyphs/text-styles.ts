import type { TextTransform } from "../core/types";
import { graphemes } from "../core/unicode";

interface MathAlphabet {
  upper: number;
  lower: number;
  digit?: number;
  upperExceptions?: Record<string, string>;
  lowerExceptions?: Record<string, string>;
}

const MATH_ALPHABETS: Partial<Record<TextTransform, MathAlphabet>> = {
  bold: { upper: 0x1d400, lower: 0x1d41a, digit: 0x1d7ce },
  italic: {
    upper: 0x1d434,
    lower: 0x1d44e,
    lowerExceptions: { h: "\u210e" },
  },
  boldItalic: { upper: 0x1d468, lower: 0x1d482 },
  script: {
    upper: 0x1d49c,
    lower: 0x1d4b6,
    upperExceptions: {
      B: "\u212c",
      E: "\u2130",
      F: "\u2131",
      H: "\u210b",
      I: "\u2110",
      L: "\u2112",
      M: "\u2133",
      R: "\u211b",
    },
    lowerExceptions: { e: "\u212f", g: "\u210a", o: "\u2134" },
  },
  boldScript: { upper: 0x1d4d0, lower: 0x1d4ea },
  fraktur: {
    upper: 0x1d504,
    lower: 0x1d51e,
    upperExceptions: {
      C: "\u212d",
      H: "\u210c",
      I: "\u2111",
      R: "\u211c",
      Z: "\u2128",
    },
  },
  doubleStruck: {
    upper: 0x1d538,
    lower: 0x1d552,
    digit: 0x1d7d8,
    upperExceptions: {
      C: "\u2102",
      H: "\u210d",
      N: "\u2115",
      P: "\u2119",
      Q: "\u211a",
      R: "\u211d",
      Z: "\u2124",
    },
  },
  sansSerif: { upper: 0x1d5a0, lower: 0x1d5ba, digit: 0x1d7e2 },
  sansBold: { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec },
  monospace: { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 },
};

const SMALL_CAPS: Record<string, string> = {
  a: "ᴀ",
  b: "ʙ",
  c: "ᴄ",
  d: "ᴅ",
  e: "ᴇ",
  f: "ꜰ",
  g: "ɢ",
  h: "ʜ",
  i: "ɪ",
  j: "ᴊ",
  k: "ᴋ",
  l: "ʟ",
  m: "ᴍ",
  n: "ɴ",
  o: "ᴏ",
  p: "ᴘ",
  q: "ǫ",
  r: "ʀ",
  s: "ꜱ",
  t: "ᴛ",
  u: "ᴜ",
  v: "ᴠ",
  w: "ᴡ",
  x: "x",
  y: "ʏ",
  z: "ᴢ",
};

function codePointSafe(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

function mapMathChar(ch: string, alpha: MathAlphabet): string {
  const cp = ch.codePointAt(0) ?? 0;
  if (ch >= "A" && ch <= "Z") {
    return alpha.upperExceptions?.[ch] ?? codePointSafe(alpha.upper + (cp - 65));
  }
  if (ch >= "a" && ch <= "z") {
    return alpha.lowerExceptions?.[ch] ?? codePointSafe(alpha.lower + (cp - 97));
  }
  if (ch >= "0" && ch <= "9" && alpha.digit !== undefined) {
    return codePointSafe(alpha.digit + (cp - 48));
  }
  return ch;
}

function transformOne(ch: string, style: TextTransform): string {
  const cp = ch.codePointAt(0) ?? 0;
  if (ch.length !== 1 && cp < 0x10000) return ch;
  const alphabet = MATH_ALPHABETS[style];
  if (alphabet) {
    if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || (cp >= 48 && cp <= 57)) {
      return mapMathChar(ch, alphabet);
    }
    return ch;
  }
  if (style === "fullwidth") {
    if (cp >= 0x21 && cp <= 0x7e) return codePointSafe(cp + 0xfee0);
    return ch;
  }
  if (style === "circled") {
    if (cp >= 65 && cp <= 90) return codePointSafe(0x24b6 + (cp - 65));
    if (cp >= 97 && cp <= 122) return codePointSafe(0x24d0 + (cp - 97));
    if (cp >= 49 && cp <= 57) return codePointSafe(0x2460 + (cp - 49));
    if (cp === 48) return "\u24ea";
    return ch;
  }
  if (style === "squared") {
    if (cp >= 65 && cp <= 90) return codePointSafe(0x1f130 + (cp - 65));
    if (cp >= 97 && cp <= 122) return codePointSafe(0x1f130 + (cp - 97));
    return ch;
  }
  if (style === "smallCaps") {
    const lower = ch.toLowerCase();
    return SMALL_CAPS[lower] ?? ch;
  }
  return ch;
}

/** Apply a Unicode alphabet transform to typed text. */
export function transformText(text: string, style: TextTransform): string {
  if (style === "normal" || !text) return text;
  let out = "";
  for (const part of graphemes(text)) {
    if (part === "\n") {
      out += "\n";
      continue;
    }
    out += transformOne(part, style);
  }
  return out;
}

export const TEXT_TRANSFORMS: TextTransform[] = [
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

export const TEXT_TRANSFORM_SAMPLES: Record<TextTransform, string> = {
  normal: "Unidraw",
  fullwidth: "Ｕｎｉｄｒａｗ",
  bold: "𝐔𝐧𝐢𝐝𝐫𝐚𝐰",
  italic: "𝑈𝑛𝑖𝑑𝑟𝑎𝑤",
  boldItalic: "𝑼𝒏𝒊𝒅𝒓𝒂𝒘",
  script: "𝒰𝓃𝒾𝒹𝓇𝒶𝓌",
  boldScript: "𝓤𝓷𝓲𝓭𝓻𝓪𝔀",
  fraktur: "𝔘𝔫𝔦𝔡𝔯𝔞𝔴",
  doubleStruck: "𝕌𝕟𝕚𝕕𝕣𝕒𝕨",
  sansSerif: "𝖴𝗇𝗂𝖽𝗋𝖺𝗐",
  sansBold: "𝗨𝗻𝗶𝗱𝗿𝗮𝘄",
  monospace: "𝚄𝚗𝚒𝚍𝚛𝚊𝚠",
  circled: "Ⓤⓝⓘⓓⓡⓐⓦ",
  squared: "🄰🄱🄲",
  smallCaps: "ᴜɴɪᴅʀᴀᴡ",
};
