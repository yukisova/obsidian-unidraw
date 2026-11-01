# Changelog

## 0.2.8 (2026-11-01)

- Text editing now happens in place over the rectangle on the canvas. The
  floating editor card, hint footer and centered popup are gone; the canvas
  label is hidden while an in-canvas textarea is active. Clicking outside
  applies, Enter applies, Shift+Enter adds a line and Esc cancels.

## 0.2.7 (2026-11-01)

- Removed the standalone Text tool, its toolbar entry, T shortcut and text-box
  creation gesture. Text remains available as a rectangle feature via the Text
  checkbox, the subcard edit button, Enter, or double-click.

## 0.2.6 (2026-11-01)

- Rectangle elements now expose optional Text, Fill and Border features with
  checkboxes and nested feature cards.
- Removed the standalone text element type; text is now a rectangle feature and
  the Text tool creates a rectangle with Text on and Border/Fill off.

## 0.2.5 (2026-11-01)

- Removed the temporary selected-row more-actions fallback now that the
  right-click element-row card works reliably.

## 0.2.4 (2026-11-01)

- Reimplemented the element-row context card as a fixed `document.body` overlay,
  opened from a window-capture right-button pointerdown. This avoids host
  context-menu consumption and clipping by the editor view.
- Added an icon-only "more actions" button on selected rows as a reliable
  fallback for opening the same duplicate/delete card.

## 0.2.3 (2026-11-01)

- Fixed the element-list context card for selected rows. The card now opens on
  the right pointerdown instead of relying only on `contextmenu`, which some
  host/draggable-row paths consume. The multi-selection is preserved.

## 0.2.2 (2026-11-01)

- Drawing-area tools now always target a doodle: the selected doodle, the
  non-global doodle under the pointer, or the global doodle.
- Element list rows support Ctrl/Cmd toggle and Shift range selection, plus
  drag-to-reorder z-index.
- Visibility toggles and lock toggles live in the element list; the global
  doodle has no lock button.
- The element edit card uses icon-only hierarchy and conversion areas, with
  type-specific title icons; duplicate and delete moved to a row context card.
- Element list rows support Shift range selection, Ctrl/Cmd toggle selection and
  drag-to-reorder z-index; the global doodle has no lock button.
- Fixed the element-row context card for multi-selections.
- Doodles no longer expose scale handles. Select-tool right-drag scales; Pan
  right-drag copies text; holding Space enters the Pan tool.
- Rectangles can gain text with Enter and show a text layout group with a 3x3
  alignment grid, direction, wrap and half-width padding.
- Single-cell shape symbols, in-board transforms, element fills and the
  right-side element list from 0.2.1 remain.

## 0.2.1 (2026-11-01)

- The element inspector is now a floating card over the canvas.
- The global doodle is fixed at the bottom of the z-order, cannot be clicked or
  moved, and is selected only with Escape. It has a subtle selection outline,
  no handles and no inspector card; drawing into it still works.
- Renamed the solid rectangle tool to **Rectangle fill** and gave it a clearer
  outline-plus-fill icon.
- The text tool now edits in an inline box centered on the selected area
  instead of opening a modal dialog.
- Select-tool right drag selects a red text region and copies it to the
  clipboard as a plain fenced code block for pasting into notes.
- Rectangle fill now previews right-drag erasing in red and supports a
  single-cell click to fill or clear.
- The canvas extent stays fixed while elements are moved or resized, avoiding
  premature canvas growth and forced scrolling.
- Non-global elements whose content is fully erased are deleted automatically.
- Elements are rasterized independently and stacked in z-order; overlapping
  shapes no longer merge into `┼`/`╬` junction glyphs.
- A right-side element list card shows every element in z-order and selects by
  click.
- Closed shapes support transparent, empty and character fills; empty fill
  covers underlying content while no fill reveals it.
- Shape previews no longer leave an initial ghost glyph; single-click rectangle,
  diamond and ellipse input `□`, `◇` and `○`.
- Moving/resizing keeps elements inside the board with live z-ordered
  composition, avoiding preview overlap and forced canvas growth.
- Element visibility and lock actions moved to the right element list; the left
  card uses icon-only z-order, convert and action areas with type-specific
  title icons.
- The toolbar is grouped into operation, shape, drawing and standalone text
  areas; solid rectangle is renamed Rectangle fill and the art-text button is
  removed.

## 0.2.0 (2026-11-01)

Element system release.

- Element model: rectangles, ellipses, diamonds, lines, doodles and groups,
  with per-element z-order, visibility and lock state.
- A default global doodle in every frame; drawing into a selected doodle and
  converting selections to doodles or to the global doodle.
- Single and multi element selection, drag/resize, element inspector, group
  merging, and right-click conversion/group/delete/show/lock menus.
- Three stacked canvases — StaticCanvas, InteractiveCanvas and
  NewElementCanvas — with lightweight previews for drawing, moving and
  resizing.
- JSON element documents with legacy plain-text import; text is represented as
  a borderless rectangle element.

## 0.1.0 (2026-10-31)

Initial release.

- Unicode character canvas with grapheme-accurate cells and East-Asian / emoji
  double-width handling.
- Pencil, eraser, flood fill, eyedropper, line, arrow, rectangle, ellipse,
  diamond, triangle, text, select and pan tools.
- Smart box-drawing lines with automatic corner, tee and cross merging.
- Light, heavy, double, rounded, dashed and ASCII strokes; straight and elbow
  routing; arrowheads on either end.
- Seamless vector rendering for box-drawing, block and braille glyphs.
- Shape fills: light, medium, dark, solid, dots, checker, hatch and custom.
- Selection marquee, move, Alt-drag duplicate, nudge, flip, rotate, copy, cut,
  paste and delete.
- Inline multi-line text editing with IME support and 15 ornamental Unicode
  alphabets.
- Multi-level undo/redo history, autosave and external-change detection.
- Zoom, pan, fit-to-view, theme-aware grid and high-DPI canvas.
- Plain UTF-8 `.unidraw` files, `![[drawing.unidraw]]` embeds and
  ` ```unidraw ` code blocks with copy/open actions.
- Copy/export as text, Markdown, PNG (themed or transparent) and `.txt`;
  insert directly into the active note.
- 16 drawing templates, a searchable Unicode character palette and a bilingual
  English / Chinese interface.
- Obsidian commands, ribbon action and a settings tab for fonts, grid,
  defaults, autosave and embed sizing.
