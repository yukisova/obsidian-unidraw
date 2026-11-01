import { DrawingDocument } from "../src/core/document";
import {
  composeData,
  composedText,
  mergeLayers,
  parseUnidraw,
  serializeUnidraw,
} from "../src/core/file-format";
import {
  boundsOfObjects,
  createDefaultData,
  createLayer,
  createPadding,
  objectBounds,
  setObjectBounds,
  translateObject,
  type CellsObject,
  type CircleObject,
  type DiamondObject,
  type GroupObject,
  type LineObject,
  type RectObject,
  type UnidrawData,
} from "../src/core/objects";
import { renderObject } from "../src/model/rasterize";
import { eq, ok, test } from "./harness";

function line(partial: Partial<LineObject> = {}): LineObject {
  return {
    id: "line-1",
    kind: "line",
    x1: 1,
    y1: 1,
    x2: 10,
    y2: 1,
    style: "light",
    route: "straight",
    arrowStart: "none",
    arrowEnd: "none",
    ...partial,
  };
}

function cellObject(textCells: Array<[number, number, string]>, role: "draw" | "erase" = "draw"): CellsObject {
  return { id: `cells-${Math.random()}`, kind: "cells", role, cells: textCells };
}

function textObject(partial: Partial<RectObject> = {}): RectObject {
  return {
    id: "text-1",
    kind: "rect",
    x: 1,
    y: 1,
    w: 12,
    h: 4,
    filled: false,
    fillChar: " ",
    fill: null,
    fillEnabled: false,
    style: "light",
    borderless: true,
    textEnabled: true,
    text: "Hello world",
    font: "normal",
    hAlign: "left",
    vAlign: "top",
    direction: "horizontal",
    wrap: "down",
    padding: createPadding({ top: 0, right: 0, bottom: 0, left: 0 }),
    ...partial,
  };
}

test("JSON drawing files preserve layers and objects", () => {
  const data = createDefaultData();
  data.layers[0].objects.push(
    line(),
    cellObject([[2, 2, "A"]]),
    textObject(),
    { id: "rect-1", kind: "rect", x: 1, y: 1, w: 3, h: 2, filled: false, fillChar: "█", style: "rounded" } as RectObject,
    { id: "circle-1", kind: "circle", x: 2, y: 2, w: 7, h: 4, style: "light" } as CircleObject,
  );
  const raw = serializeUnidraw(data);
  ok(raw.startsWith("{"));
  ok(raw.endsWith("\n"));
  const parsed = parseUnidraw(raw);
  eq(parsed.layers.length, 1);
  eq(parsed.layers[0].objects.map((object) => object.kind), ["cells", "line", "cells", "rect", "rect", "circle"]);
  eq(parsed.layers[0].objects[1].id, "line-1");
});

test("legacy plain text files import as a single cells layer", () => {
  const data = parseUnidraw("  A\n┌─┐\n│B│\n└─┘\n");
  eq(data.layers.length, 1);
  eq(data.layers[0].objects.length, 1);
  eq(data.layers[0].objects[0].kind, "cells");
  const art = composedText(data);
  ok(art.includes("A"));
  ok(art.includes("┌─┐"));
  ok(art.includes("│B│"));
});

test("composeData hides invisible layers and preserves draw order", () => {
  const data = createDefaultData(4, 4);
  data.layers[0].objects.push(cellObject([[0, 0, "A"]], "draw"));
  const top = createLayer("Top", [cellObject([[0, 0, "B"]], "draw")]);
  data.layers.push(top);
  eq(composeData(data).doc.charAt(0, 0), "B");
  top.visible = false;
  eq(composeData(data).doc.charAt(0, 0), "A");
});

test("erase objects clear earlier content but do not expand the canvas", () => {
  const data = createDefaultData(4, 3);
  data.layers[0].objects.push(cellObject([[0, 0, "A"]], "draw"));
  data.layers[0].objects.push(cellObject([[0, 0, " "], [0, 1, " "], [0, 2, " "]], "erase"));
  eq(composeData(data).doc.charAt(0, 0), " ");
  const eraseOnly = createDefaultData(4, 3);
  eraseOnly.layers[0].objects.push(cellObject([[50, 50, " "]], "erase"));
  const composed = composeData(eraseOnly);
  eq([composed.cols, composed.rows], [4, 3]);
});

test("the canvas shrinks again when erased content becomes blank", () => {
  const data = createDefaultData(4, 3);
  const draw: CellsObject = { id: "far", kind: "cells", role: "draw", cells: [[0, 20, "A"]] };
  const erase: CellsObject = { id: "far-erase", kind: "cells", role: "erase", cells: [[0, 20, " "]] };
  data.layers[0].objects.push(draw);
  eq(composeData(data).cols, 21);
  data.layers[0].objects.push(erase);
  eq(composeData(data).cols, 4);
});

test("merging layers keeps order, names and hidden content", () => {
  const data = createDefaultData(8, 6);
  const lower = data.layers[0];
  lower.name = "Lower";
  lower.objects.push(cellObject([[0, 0, "L"]], "draw"));
  const hidden = createLayer("Hidden", [cellObject([[0, 1, "H"]], "draw")]);
  hidden.visible = false;
  const upper = createLayer("Upper", [cellObject([[0, 2, "U"]], "draw")]);
  data.layers.push(hidden, upper);
  const result = mergeLayers(data, [lower.id, hidden.id, upper.id], false);
  ok(result);
  eq(data.layers.length, 1);
  eq(data.layers[0].name, "Upper");
  eq(data.layers[0].objects.length, 4);
  eq(data.layers[0].objects[0].id.includes("doodle"), true);
  eq(data.layers[0].objects[2].hidden, true);
  const art = composedText(data);
  ok(art.includes("L"));
  ok(art.includes("U"));
  ok(!art.includes("H"));
});

test("merge into a new layer leaves originals and regenerates IDs", () => {
  const data = createDefaultData(8, 6);
  const a = createLayer("A", [cellObject([[0, 0, "A"]])]);
  const b = createLayer("B", [cellObject([[0, 1, "B"]])]);
  data.layers.push(a, b);
  const originalIds = [a.objects[0].id, b.objects[0].id];
  const result = mergeLayers(data, [a.id, b.id], true);
  ok(result);
  eq(data.layers.length, 4);
  eq(data.layers.find((layer) => layer.id === a.id)?.objects.length, 1);
  eq(data.layers.find((layer) => layer.id === b.id)?.objects.length, 1);
  const merged = data.layers.find((layer) => layer.id === result?.targetLayerId);
  ok(merged);
  eq(merged?.objects.length, 2);
  ok(merged?.objects.every((object) => !originalIds.includes(object.id)));
});

test("locked layers cannot be merged", () => {
  const data = createDefaultData(4, 4);
  data.layers[0].locked = true;
  eq(mergeLayers(data, [data.layers[0].id], false), null);
});

test("line routes and arrow styles render", () => {
  const dict = new DrawingDocument(30, 12);
  renderObject(dict, line({ x1: 1, y1: 1, x2: 20, y2: 1, arrowEnd: "solid" }));
  eq(dict.charAt(1, 20), "▶");
  eq(dict.charAt(1, 1), "╶");
  const elbow = new DrawingDocument(16, 10);
  renderObject(elbow, line({ x1: 1, y1: 1, x2: 10, y2: 6, route: "elbow" }));
  eq(elbow.charAt(1, 10), "┐");
  eq(elbow.charAt(6, 10), "╵");
  const diagonal = new DrawingDocument(20, 12);
  renderObject(diagonal, line({ x1: 1, y1: 1, x2: 14, y2: 7, route: "diagonal" }));
  ok(diagonal.toText().includes("╲") || diagonal.toText().includes("╱"));
  ok(diagonal.toText().includes("─"));
});

test("text objects align, wrap, clip and turn vertical", () => {
  const doc = new DrawingDocument(30, 12);
  renderObject(doc, textObject({ x: 1, y: 1, w: 10, h: 3, text: "Hello world", hAlign: "center" }));
  ok(doc.toText().includes("Hello"));
  ok(doc.toText().includes("world"));
  const clipped = new DrawingDocument(30, 12);
  renderObject(clipped, textObject({ x: 1, y: 1, w: 6, h: 1, text: "1234567890" }));
  ok(!clipped.toText().includes("7890"));
  const vertical = new DrawingDocument(12, 20);
  renderObject(vertical, textObject({ x: 1, y: 1, w: 5, h: 10, text: "abc", direction: "vertical" }));
  const rows = vertical.toLines(true);
  ok(rows[1]?.includes("a"));
  ok(rows[2]?.includes("b"));
  ok(rows[3]?.includes("c"));
});

test("object translation, bounds and scaling are invertible", () => {
  const cells = cellObject([[1, 1, "A"], [1, 2, "B"]]);
  const before = objectBounds(cells);
  ok(before);
  translateObject(cells, 3, 4);
  eq(objectBounds(cells), { x: 5, y: 4, w: 2, h: 1 });
  setObjectBounds(cells, { x: 0, y: 0, w: 4, h: 2 });
  eq(objectBounds(cells), { x: 0, y: 0, w: 3, h: 1 });
  eq(boundsOfObjects([cells, line({ x1: 5, y1: 5, x2: 6, y2: 6 })]), { x: 0, y: 0, w: 7, h: 7 });
});

test("invalid JSON falls back to legacy text import", () => {
  const data = parseUnidraw("{ not valid json");
  eq(data.layers.length, 1);
  ok(composedText(data).includes("{ not valid json"));
});

test("drawingText is exactly the composed visible art", () => {
  const data: UnidrawData = createDefaultData(5, 3);
  data.layers[0].objects.push(cellObject([[0, 0, "A"], [1, 1, "B"]]));
  eq(composedText(data).trimEnd(), "A\n B");
});

test("default frames start with a global doodle element", () => {
  const data = createDefaultData(10, 6);
  eq(data.layers.length, 1);
  const global = data.layers[0].objects[0];
  eq(global.kind, "cells");
  eq((global as CellsObject).global, true);
  eq((global as CellsObject).cells.length, 0);
});

test("diamonds, groups, visibility and locking survive a round-trip", () => {
  const data = createDefaultData(20, 12);
  const diamond = {
    id: "diamond-1",
    kind: "diamond",
    x: 2,
    y: 2,
    w: 7,
    h: 5,
    style: "heavy",
    visible: false,
    locked: true,
  } as const;
  const group = {
    id: "group-1",
    kind: "group",
    children: [
      { id: "g-rect", kind: "rect", x: 1, y: 1, w: 4, h: 3, filled: false, fillChar: "█", style: "light" },
      { id: "g-line", kind: "line", x1: 1, y1: 5, x2: 6, y2: 5, style: "light", route: "straight", arrowStart: "none", arrowEnd: "none" },
    ],
  } as const;
  data.layers[0].objects.push(diamond as unknown as DiamondObject, group as unknown as GroupObject);
  const parsed = parseUnidraw(serializeUnidraw(data));
  const objects = parsed.layers[0].objects;
  const parsedDiamond = objects.find((object) => object.id === "diamond-1");
  const parsedGroup = objects.find((object) => object.id === "group-1");
  eq(parsedDiamond?.kind, "diamond");
  eq(parsedDiamond?.visible, false);
  eq(parsedDiamond?.locked, true);
  eq(parsedGroup?.kind, "group");
  eq(parsedGroup && parsedGroup.kind === "group" ? parsedGroup.children.length : -1, 2);
  const art = composedText(parsed);
  ok(art.includes("─"));
  eq(objectBounds(parsedGroup as GroupObject)?.w, 6);
});

test("legacy text objects become borderless rectangle elements", () => {
  const data = createDefaultData(30, 10);
  data.layers[0].objects.push({
    id: "text-1",
    kind: "text",
    x: 2,
    y: 2,
    w: 12,
    h: 3,
    text: "Hello",
    font: "bold",
    hAlign: "left",
    vAlign: "top",
    direction: "horizontal",
    wrap: "down",
    padding: createPadding(),
  } as unknown as import("../src/core/objects").DrawingObject);
  const parsed = parseUnidraw(serializeUnidraw(data));
  const element = parsed.layers[0].objects.find((object) => object.id === "text-1");
  eq(element?.kind, "rect");
  eq(element && element.kind === "rect" ? element.borderless : false, true);
  eq(element && element.kind === "rect" ? element.text : "", "Hello");
  ok(composedText(parsed).length > 0);
});

test("separate elements never merge into junction glyphs", () => {
  const data = createDefaultData(12, 6);
  data.layers[0].objects.push(
    line({ id: "h", x1: 1, y1: 2, x2: 10, y2: 2, style: "light" }),
    line({ id: "v", x1: 5, y1: 0, x2: 5, y2: 5, style: "light" }),
  );
  const art = composedText(data);
  ok(art.includes("│"));
  ok(!art.includes("┼"));
  ok(!art.includes("╬"));
});

test("overlapping rectangles keep their own corners and borders", () => {
  const data = createDefaultData(24, 12);
  data.layers[0].objects.push(
    { id: "r1", kind: "rect", x: 2, y: 1, w: 9, h: 7, filled: false, fillChar: "█", style: "rounded" } as RectObject,
    { id: "r2", kind: "rect", x: 7, y: 3, w: 12, h: 8, filled: false, fillChar: "█", style: "double" } as RectObject,
  );
  const art = composedText(data);
  ok(art.includes("╭"));
  ok(art.includes("╔"));
  ok(!art.includes("╬"));
  ok(!art.includes("┼"));
});

test("shape fills distinguish transparent, empty and custom coverage", () => {
  const make = (fill: string | null | undefined) => {
    const data = createDefaultData(12, 8);
    data.layers[0].objects.push(
      { id: "under", kind: "cells", role: "draw", cells: [[2, 2, "X"], [3, 3, "Y"]], fill: undefined } as unknown as CellsObject,
      {
        id: "shape",
        kind: "rect",
        x: 1,
        y: 1,
        w: 8,
        h: 5,
        filled: fill !== null && fill !== undefined,
        fillChar: "█",
        style: "light",
        fill,
      } as RectObject,
    );
    return composedText(data);
  };
  const transparent = make(null);
  ok(transparent.includes("X"));
  ok(transparent.includes("Y"));
  const empty = make("");
  ok(!empty.includes("X"));
  ok(!empty.includes("Y"));
  const custom = make("░");
  ok(custom.includes("░"));
  ok(!custom.includes("X"));
  ok(!custom.includes("Y"));
});

test("empty fill survives JSON serialization", () => {
  const data = createDefaultData(10, 6);
  data.layers[0].objects.push({
    id: "empty-fill",
    kind: "rect",
    x: 1,
    y: 1,
    w: 6,
    h: 4,
    filled: true,
    fillChar: "█",
    fill: "",
    style: "light",
  } as RectObject);
  const parsed = parseUnidraw(serializeUnidraw(data));
  const shape = parsed.layers[0].objects.find((object) => object.id === "empty-fill");
  eq(shape && shape.kind === "rect" ? shape.fill : "missing", "");
});

test("single-cell shapes use box, diamond and circle glyphs", () => {
  const data = createDefaultData(10, 6);
  data.layers[0].objects.push(
    { id: "r", kind: "rect", x: 1, y: 1, w: 1, h: 1, filled: false, fillChar: "█", style: "light" } as RectObject,
    { id: "d", kind: "diamond", x: 3, y: 1, w: 1, h: 1, style: "light" } as unknown as import("../src/core/objects").DiamondObject,
    { id: "c", kind: "circle", x: 5, y: 1, w: 1, h: 1, style: "light" } as unknown as import("../src/core/objects").CircleObject,
  );
  const art = composedText(data).split("\n");
  eq(art[1].slice(1, 2), "□");
  eq(art[1].slice(3, 4), "◇");
  eq(art[1].slice(5, 6), "○");
});

test("rectangle feature switches gate text and fill", () => {
  const data = createDefaultData(12, 8);
  const rect: RectObject = {
    id: "feature-rect",
    kind: "rect",
    x: 1,
    y: 1,
    w: 7,
    h: 4,
    filled: false,
    fillChar: " ",
    fill: "#",
    fillEnabled: false,
    style: "light",
    borderless: true,
    text: "Hidden",
    textEnabled: false,
    font: "normal",
    hAlign: "left",
    vAlign: "top",
    direction: "horizontal",
    wrap: "down",
    padding: createPadding({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
  data.layers[0].objects.push(rect);
  let art = composedText(data);
  ok(!art.includes("Hidden"));
  ok(!art.includes("#"));
  rect.textEnabled = true;
  rect.fillEnabled = true;
  art = composedText(data);
  ok(art.includes("Hidden"));
  ok(art.includes("#"));
});

test("legacy text objects gain text-only rectangle features", () => {
  const data = createDefaultData(30, 10);
  data.layers[0].objects.push({
    id: "legacy-text",
    kind: "text",
    x: 2,
    y: 2,
    w: 12,
    h: 3,
    text: "Hello",
    padding: createPadding(),
  } as unknown as import("../src/core/objects").DrawingObject);
  const parsed = parseUnidraw(serializeUnidraw(data));
  const element = parsed.layers[0].objects.find((object) => object.id === "legacy-text");
  eq(element && element.kind === "rect" ? element.textEnabled : false, true);
  eq(element && element.kind === "rect" ? element.fillEnabled : true, false);
  eq(element && element.kind === "rect" ? element.borderless : false, true);
});

test("rectangle fill tab mode survives JSON serialization", () => {
  const data = createDefaultData(12, 8);
  data.layers[0].objects.push({
    id: "mode-rect",
    kind: "rect",
    x: 1,
    y: 1,
    w: 6,
    h: 4,
    filled: true,
    fillChar: "▓",
    fill: "▓",
    fillEnabled: true,
    fillMode: "block",
    style: "light",
  });
  const parsed = parseUnidraw(serializeUnidraw(data));
  const element = parsed.layers[0].objects.find((object) => object.id === "mode-rect");
  eq(element && element.kind === "rect" ? element.fillMode : "", "block");
  eq(element && element.kind === "rect" ? element.fill : "", "▓");
});

test("heavy dash border presets use the heavy dashed glyph family", () => {
  const data = createDefaultData(14, 8);
  data.layers[0].objects.push({
    id: "heavy-dash",
    kind: "rect",
    x: 1,
    y: 1,
    w: 8,
    h: 5,
    filled: false,
    fillChar: " ",
    style: "heavyDash3",
  });
  const art = composedText(data);
  ok(art.includes("╍") || art.includes("┅"));
  ok(art.includes("┏"));
});

test("dash 2/3/4 border presets map to the requested Unicode families", () => {
  const cases: Array<[import("../src/core/types").StrokeStyle, string, string]> = [
    ["dash2", "╎", "╌"],
    ["heavyDash2", "╏", "╍"],
    ["dashed", "┆", "┄"],
    ["heavyDash3", "┇", "┅"],
    ["dash4", "┊", "┈"],
    ["heavyDash4", "┋", "┉"],
  ];
  for (const [style, vertical, horizontal] of cases) {
    const data = createDefaultData(14, 8);
    data.layers[0].objects.push({
      id: `dash-${style}`,
      kind: "rect",
      x: 1,
      y: 1,
      w: 8,
      h: 5,
      filled: false,
      fillChar: " ",
      style,
    });
    const art = composedText(data);
    ok(art.includes(vertical), `${style} vertical ${vertical}`);
    ok(art.includes(horizontal), `${style} horizontal ${horizontal}`);
  }
});

test("single-row and single-column rectangles use half-line caps", () => {
  const data = createDefaultData(14, 10);
  data.layers[0].objects.push(
    { id: "h-line", kind: "rect", x: 1, y: 2, w: 3, h: 1, filled: false, fillChar: " ", style: "light" },
    { id: "v-line", kind: "rect", x: 6, y: 2, w: 1, h: 3, filled: false, fillChar: " ", style: "light" },
  );
  const art = composedText(data);
  ok(art.includes("╶─╴"));
  ok(art.includes("╷"));
  ok(art.includes("│"));
  ok(art.includes("╵"));
});

test("interrupted rectangle borders follow segment, gap and offset", () => {
  const make = (segment: number, gap: number, offset: number): string => {
    const data = createDefaultData(14, 9);
    data.layers[0].objects.push({
      id: "interrupt",
      kind: "rect",
      x: 1,
      y: 1,
      w: 10,
      h: 5,
      filled: false,
      fillChar: " ",
      style: "light",
      interruptEnabled: true,
      interrupt: { segment, gap, offset },
    });
    return composedText(data);
  };
  const alternating = make(1, 1, 0);
  ok(alternating.includes("┌ ─ ─ ─ ─"));
  ok(alternating.includes("└ ─ ─ ─ ─"));
  const doubled = make(2, 2, 0);
  ok(doubled.includes("┌─  ──  ─┐"));
  ok(doubled.includes(" ──  ──  ┘"));
  const offset = make(2, 2, 1);
  ok(offset.includes(" ──  ──  ┐"));
  ok(offset.includes("└─  ──  ─┘"));
});
