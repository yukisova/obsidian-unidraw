# Changelog

## 0.4.9 (2026-11-01)

- Changed the plugin author to **yukisova**.
- Replaced newer `revealLeaf` API with the `active: true` view state for
  compatibility with `minAppVersion` 1.5.0.

## 0.4.8 (2026-11-01)

- Fixed long-session rendering artifacts in Obsidian chrome by removing
  `backdrop-filter` and persistent card animations, isolating the view paint,
  capping canvas DPR at 2 and pruning toast timers.

## 0.4.7 (2026-11-01)

- Architecture cleanup: removed the unused layer panel, old stylebar/line
  inspector helpers and their APIs, dead drawing helpers, unused fields and
  imports.
- Enabled `noUnusedLocals` / `noUnusedParameters`.
- Removed roughly 21 KB of unreachable CSS and all plugin CSS classes with no
  source reference.

## 0.4.6 (2026-11-01)

- Changed the ribbon icon to `pencil-ruler`.
- Removed the toolbar grid-size selector and fixed the grid at 16 px.
- Restored text exports: clipboard fallback is synchronous and text/Markdown
  files save into the drawing's vault folder.

## 0.4.5 (2026-11-01)

- Linked line endpoints now accept a one-cell edge tolerance.
- Groups can be renamed, saved as JSON templates and switched between separate
  and merge intersection rendering.

## 0.4.4 (2026-11-01)

- Reworked 8-way direct line paths into a centered diagonal/axis/diagonal
  polyline, eliminating adjacent parallel diagonal glyphs on shallow or steep
  lines.

## 0.4.3 (2026-11-01)

- Added adaptive/custom arrow subcards for enabled line start/end arrows.
- Adaptive arrows use the four cardinal directions; start arrows point
  outward, opposite the end arrow at the same endpoint.

## 0.4.2 (2026-11-01)

- Reordered the line inspector into routing, avoidance, line type, conditional
  style/fill and end checkboxes.
- Added solid/dash-2/dash-3/dash-4 line-pattern presets for Straight and Bold.
- Moved Start/End/Interrupt to the bottom of the line card.

## 0.4.1 (2026-11-01)

- Removed the contextual tool-property bar below the toolbar. Tool settings
  now live in the selected-element inspector, with tool hints kept in the
  status bar.

## 0.4.0 (2026-11-01)

- Rebuilt the line inspector around routing direction, five line styles,
  interruption, independent start/end arrows and shape-ignore modes.
- Lines auto-link to shapes under their endpoints; linked endpoints follow
  shape moves and resizes.
- Added 4-way/8-way routing and obstacle-aware pathfinding using full shape
  bounds, with endpoint cells exempt.

## 0.2.20 (2026-11-01)

- Fixed Obsidian plugin lint findings: manifest description wording, safe SVG
  insertion, Platform API for OS shortcuts, CSS-helper style assignment,
  `Setting` headings and the minimum-version-compatible `getLeaf(true)` call.

## 0.2.19 (2026-11-01)

- Added an optional Interrupt feature for rectangle borders with segment
  length, gap length and offset inputs. The pattern wraps independently around
  horizontal and vertical edges, preserving the selected stroke style.

## 0.2.18 (2026-11-01)

- 1×n and n×1 rectangles now use half-line end caps: `╶─╴` horizontally and
  `╷│╵` vertically (style-aware equivalents for heavy, double, dashed, ASCII).

## 0.2.17 (2026-11-01)

- Removed the old Select-tool canvas right-click context menu; right-drag still
  scales the selection.
- Removed text labels from the four border pattern buttons.
- Confirmed and tested the Unicode dash families for Dash 2/3/4 on light and
  heavy borders.

## 0.2.16 (2026-11-01)

- Straight and Bold borders now offer Solid, Dash 2, Dash 3 and Dash 4
  patterns; Rounded remains limited to Straight.
- Cmd/Ctrl+D duplicates the selection at the current cursor cell.
- Moving and resizing elements can extend past the current auto-fit canvas
  bounds; the canvas grows live during the gesture.

## 0.2.15 (2026-11-01)

- Removed labels from the fill-mode and border-style tab buttons; each tab is
  now identified by its icon and tooltip.
- The border detail area is now conditional: dashed/rounded controls appear
  for Straight, Bold, Dashed and Rounded, and are hidden for Double and ASCII.

## 0.2.14 (2026-11-01)

- Fill tabs now use icons instead of preview glyphs.
- Border settings use a tabbed line-style card with icons, a dashed option and
  a rounded checkbox.

## 0.2.13 (2026-11-01)

- Redesigned the rectangle Fill subcard with three preview tabs: Empty,
  Block and Custom. Block mode exposes a block-glyph grid; Custom mode exposes
  the fill-character picker.

## 0.2.12 (2026-11-01)

- Centered all interactive controls inside the Text subcard and added small
  up/right/down/left icons above the four padding inputs.

## 0.2.11 (2026-11-01)

- Restructured the rectangle Text subcard into vertically stacked fields:
  alignment grid, writing direction, wrap direction and padding. The font
  selector and the text preview/edit row were removed.

## 0.2.10 (2026-11-01)

- Double-clicking an empty grid cell with the Select tool creates a 20×5
  borderless, fill-free text rectangle at that position and opens in-canvas
  text editing. Cancelling removes the temporary text box.

## 0.2.9 (2026-11-01)

- Right-clicking the global doodle row now offers a clear-content action.
- Enter on a selected rectangle enables its Text feature and starts in-canvas
  editing. The editor isolates the rectangle, matches the character-cell
  spacing and no longer shows elements underneath the text.

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
