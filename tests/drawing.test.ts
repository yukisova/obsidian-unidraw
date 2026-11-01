import { DrawingDocument } from "../src/core/document";
import { serializeDrawing, parseDrawing, drawingToMarkdown, extractFencedArt } from "../src/core/format";
import {
  E,
  N,
  S,
  W,
  glyphFor,
  paintMask,
  strokeInfo,
  diagonalGlyph,
  arrowGlyph,
} from "../src/glyphs/box";
import { fillGlyph } from "../src/glyphs/fill";
import { transformText } from "../src/glyphs/text-styles";
import {
  drawDiamond,
  drawEllipse,
  drawLine,
  drawRectangle,
  drawTriangle,
} from "../src/glyphs/shapes";
import { eq, ok, test, text } from "./harness";

test("box glyph tables cover all connection masks", () => {
  eq(glyphFor(N | E | S | W, "light"), "┼");
  eq(glyphFor(N | E | S | W, "heavy"), "╋");
  eq(glyphFor(N | E | S | W, "double"), "╬");
  eq(glyphFor(E | S, "light"), "┌");
  eq(glyphFor(E | S, "rounded"), "╭");
  eq(glyphFor(N | S, "dashed"), "┆");
  eq(glyphFor(E | W, "ascii"), "-");
});

test("box glyphs are recognised for merging", () => {
  eq(strokeInfo("┼"), { mask: N | E | S | W, style: "light" });
  eq(strokeInfo("╬"), { mask: N | E | S | W, style: "double" });
  eq(strokeInfo("╭"), { mask: E | S, style: "rounded" });
  eq(strokeInfo("┄"), { mask: E | W, style: "dashed" });
  eq(strokeInfo("A"), null);
});

test("crossing strokes merge into junctions", () => {
  const doc = new DrawingDocument(3, 3);
  paintMask(doc, 1, 1, E | W, "light");
  paintMask(doc, 1, 1, N | S, "light");
  eq(doc.toText(), "\n ┼");
});

test("a line ending on an existing border creates a tee", () => {
  const doc = new DrawingDocument(7, 5);
  drawRectangle(doc, { row: 0, col: 0 }, { row: 4, col: 3 }, { style: "light", fill: "none" });
  drawLine(doc, { row: 2, col: 0 }, { row: 2, col: 3 }, { style: "light" });
  eq(text(doc)[2], "├──┤");
});

test("rectangles use the requested stroke style", () => {
  const light = new DrawingDocument(6, 5);
  drawRectangle(light, { row: 0, col: 0 }, { row: 4, col: 3 }, { style: "light", fill: "none" });
  eq(text(light), ["┌──┐", "│  │", "│  │", "│  │", "└──┘"]);

  const rounded = new DrawingDocument(6, 5);
  drawRectangle(rounded, { row: 0, col: 0 }, { row: 4, col: 3 }, { style: "rounded", fill: "none" });
  eq(text(rounded), ["╭──╮", "│  │", "│  │", "│  │", "╰──╯"]);

  const double = new DrawingDocument(6, 5);
  drawRectangle(double, { row: 0, col: 0 }, { row: 4, col: 3 }, { style: "double", fill: "none" });
  eq(text(double), ["╔══╗", "║  ║", "║  ║", "║  ║", "╚══╝"]);
});

test("shape fill only paints empty interior cells", () => {
  const doc = new DrawingDocument(6, 5);
  doc.pasteTextAt(2, 1, "hi");
  drawRectangle(doc, { row: 0, col: 0 }, { row: 4, col: 3 }, { style: "light", fill: "light", fillChar: "░" });
  eq(text(doc), ["┌──┐", "│░░│", "│hi│", "│░░│", "└──┘"]);
});

test("straight lines cap their free ends and place arrowheads", () => {
  const doc = new DrawingDocument(7, 2);
  drawLine(doc, { row: 0, col: 0 }, { row: 0, col: 4 }, { style: "light" });
  drawLine(doc, { row: 1, col: 0 }, { row: 1, col: 5 }, { style: "light", arrowEnd: true });
  eq(text(doc), ["─────", "─────→"]);
});

test("elbow connectors create a clean corner", () => {
  const doc = new DrawingDocument(6, 4);
  drawLine(doc, { row: 0, col: 0 }, { row: 3, col: 5 }, { style: "light", route: "elbow" });
  eq(text(doc), ["─────┐", "     │", "     │", "     │"]);
});

test("45 degree lines use diagonal glyphs", () => {
  const doc = new DrawingDocument(4, 4);
  drawLine(doc, { row: 0, col: 0 }, { row: 3, col: 3 }, { style: "light" });
  eq(text(doc), ["╲", " ╲", "  ╲", "   ╲"]);
  eq(diagonalGlyph(1, -1, "ascii"), "/");
  eq(arrowGlyph(0, 1), "→");
});

test("ellipses are closed and filled", () => {
  const doc = new DrawingDocument(12, 14);
  drawEllipse(doc, { row: 0, col: 0 }, { row: 8, col: 12 }, { style: "light", fill: "none" });
  const lines = text(doc);
  ok(lines.length > 4);
  const nonBlank = lines.filter((line) => line.trim().length > 0);
  ok(nonBlank.length >= 6);
  ok(nonBlank.some((line) => line.includes("─")));
  ok(nonBlank.some((line) => line.includes("│")));

  const filled = new DrawingDocument(12, 14);
  drawEllipse(filled, { row: 0, col: 0 }, { row: 8, col: 12 }, { style: "light", fill: "light", fillChar: "░" });
  ok(text(filled).some((line) => line.includes("░")));
});

test("diamonds and triangles draw sloped edges", () => {
  const diamond = new DrawingDocument(10, 12);
  drawDiamond(diamond, { row: 0, col: 0 }, { row: 8, col: 10 }, { style: "light", fill: "none" });
  const diamondText = text(diamond).join("\n");
  ok(diamondText.includes("╱"));
  ok(diamondText.includes("╲"));

  const triangle = new DrawingDocument(10, 12);
  drawTriangle(triangle, { row: 0, col: 0 }, { row: 6, col: 10 }, { style: "light", fill: "none" });
  const triangleLines = text(triangle);
  ok(triangleLines[6].includes("─"));
  ok(triangleLines[1].includes("╱") || triangleLines[1].includes("╲"));
});

test("text transforms map the Latin alphabet", () => {
  eq(transformText("Unidraw", "normal"), "Unidraw");
  eq(transformText("Unidraw", "bold"), "𝐔𝐧𝐢𝐝𝐫𝐚𝐰");
  eq(transformText("AB 1", "fullwidth"), "ＡＢ １");
  eq(transformText("hello", "smallCaps"), "ʜᴇʟʟᴏ");
  eq(transformText("abc", "circled"), "ⓐⓑⓒ");
  eq(transformText("Unidraw", "monospace"), "𝚄𝚗𝚒𝚍𝚛𝚊𝚠");
});

test("fill patterns produce stable glyphs", () => {
  eq(fillGlyph("none", 0, 0, ""), " ");
  eq(fillGlyph("light", 0, 0, ""), "░");
  eq(fillGlyph("dots", 0, 0, ""), "·");
  eq(fillGlyph("dots", 0, 1, ""), " ");
  eq(fillGlyph("custom", 0, 0, "#"), "#");
});

test("file format trims and parses drawings", () => {
  const doc = DrawingDocument.fromText("  hello   \n\n");
  eq(serializeDrawing(doc), "  hello\n");
  const parsed = parseDrawing("hello");
  ok(parsed.cols >= 80);
  ok(parsed.rows >= 30);
  eq(parsed.trimmedText(), "hello");
  eq(parseDrawing("").trimmedText(), "");
  eq(extractFencedArt("text\n```unidraw\nabc\n```\nmore"), "abc");
  eq(
    drawingToMarkdown("abc"),
    "```unidraw\nabc\n```",
  );
});
