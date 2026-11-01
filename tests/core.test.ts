import { DrawingDocument, WIDE_CONT } from "../src/core/document";
import { History } from "../src/core/history";
import { displayWidth, graphemeWidth, graphemes, normalizeText, codePointLabel } from "../src/core/unicode";
import { eq, ok, test, text } from "./harness";

test("grapheme segmentation handles flags, emoji and combining marks", () => {
  eq(graphemes("A🇨🇳e\u0301😀").length, 4);
});

test("display width follows East Asian and emoji rules", () => {
  eq(graphemeWidth("A"), 1);
  eq(graphemeWidth("中"), 2);
  eq(graphemeWidth("😀"), 2);
  eq(graphemeWidth("❤️"), 2);
  eq(graphemeWidth("❤"), 1);
  eq(graphemeWidth("e\u0301"), 1);
  eq(graphemeWidth("🇨🇳"), 2);
  eq(displayWidth("中a😀"), 5);
});

test("normalizeText expands tabs and normalises newlines", () => {
  eq(normalizeText("a\tb\r\n中\tc"), "a   b\n中  c");
  eq(codePointLabel("中"), "U+4E2D");
});

test("document round-trips Unicode text", () => {
  const source = "┌───┐\n│ 中 │\n└───┘\nwide: 😀";
  const doc = DrawingDocument.fromText(source);
  eq(doc.toText(), source);
  eq(doc.cols, 8);
  eq(doc.rows, 4);
});

test("wide glyphs occupy two cells and clear atomically", () => {
  const doc = new DrawingDocument(6, 2);
  ok(doc.setGlyph(0, 1, "中"));
  eq(doc.raw(0, 1), "中");
  eq(doc.raw(0, 2), WIDE_CONT);
  eq(doc.extractRegion({ r0: 0, c0: 0, r1: 0, c1: 3 })[0], " 中 ");
  doc.erase(0, 2);
  eq(doc.raw(0, 1), " ");
  eq(doc.raw(0, 2), " ");
});

test("trailing blanks are trimmed but leading spaces survive", () => {
  const doc = DrawingDocument.fromText("  ┌─┐   \n  └─┘   \n\n\n");
  eq(doc.toText(), "  ┌─┐\n  └─┘");
  const doc2 = DrawingDocument.fromText("\n\n  hi");
  eq(doc2.toText(), "\n\n  hi");
});

test("tight bounds ignore surrounding blank space", () => {
  const doc = DrawingDocument.fromText("     \n  ┌─┐ \n  └─┘ \n     ");
  eq(doc.tightContentBounds(), { r0: 1, c0: 2, r1: 2, c1: 4 });
});

test("content bounds and empty state", () => {
  const empty = new DrawingDocument(10, 5);
  eq(empty.contentBounds(), { cols: 0, rows: 0 });
  ok(empty.isEmpty());
  const doc = DrawingDocument.fromText("a\n  b");
  eq(doc.contentBounds(), { cols: 3, rows: 2 });
});

test("extract region preserves rectangular width", () => {
  const doc = DrawingDocument.fromText("abcd\n中ef\nghij");
  eq(doc.extractRegion({ r0: 0, c0: 1, r1: 2, c1: 3 }), ["bcd", " ef", "hij"]);
});

test("paste grows the canvas and handles wide characters", () => {
  const doc = new DrawingDocument(2, 2);
  const result = doc.pasteTextAt(1, 1, "中\n😀x");
  eq(result.r1, 2);
  eq(result.c1, 3);
  ok(doc.cols >= 4);
  eq(doc.toText(), "\n 中\n 😀x");
});

test("history supports undo and redo with snapshots", () => {
  const doc = DrawingDocument.fromText("one");
  const history = new History();
  const first = doc.snapshot();
  doc.pasteTextAt(0, 0, "two");
  history.push(first);
  const current = doc.snapshot();
  const previous = history.undo(current);
  ok(previous);
  doc.restore(previous!);
  eq(doc.toText(), "one");
  const next = history.redo(doc.snapshot());
  ok(next);
  doc.restore(next!);
  eq(doc.toText(), "two");
});
