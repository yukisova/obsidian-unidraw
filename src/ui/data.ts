import type { MessageKey } from "../core/i18n";
import type { ToolId } from "../core/types";

export interface ToolDef {
  id: ToolId;
  icon: string;
  shortcut: string;
  labelKey: MessageKey;
  hintKey: MessageKey;
  group: "navigate" | "draw" | "shapes";
}

export const TOOL_DEFS: ToolDef[] = [
  { id: "select", icon: "mouse-pointer-2", shortcut: "V", labelKey: "tool.select", hintKey: "hint.select", group: "navigate" },
  { id: "hand", icon: "hand", shortcut: "H", labelKey: "tool.hand", hintKey: "hint.hand", group: "navigate" },
  { id: "line", icon: "minus", shortcut: "L", labelKey: "tool.line", hintKey: "hint.line", group: "shapes" },
  { id: "rect", icon: "square", shortcut: "R", labelKey: "tool.rect", hintKey: "hint.rect", group: "shapes" },
  { id: "diamond", icon: "diamond", shortcut: "D", labelKey: "tool.diamond", hintKey: "hint.diamond", group: "shapes" },
  { id: "circle", icon: "circle", shortcut: "O", labelKey: "tool.circle", hintKey: "hint.circle", group: "shapes" },
  { id: "pencil", icon: "pencil", shortcut: "B", labelKey: "tool.pencil", hintKey: "hint.pencil", group: "draw" },
  { id: "solidRect", icon: "square", shortcut: "⇧R", labelKey: "tool.solidRect", hintKey: "hint.solidRect", group: "draw" },
  { id: "fill", icon: "paint-bucket", shortcut: "G", labelKey: "tool.fill", hintKey: "hint.fill", group: "draw" },
];


export const TOOL_GROUPS: ToolDef["group"][] = ["navigate", "shapes", "draw"];

export interface CharSection {
  labelKey: MessageKey;
  chars: string[];
}

export interface CharCategory {
  id: string;
  labelKey: MessageKey;
  icon: string;
  sections: CharSection[];
}

export const CHAR_CATEGORIES: CharCategory[] = [
  {
    id: "lines",
    labelKey: "palette.cat.lines",
    icon: "grid-3x3",
    sections: [
      {
        labelKey: "palette.section.light",
        chars: ["─", "│", "┌", "┐", "└", "┘", "├", "┤", "┬", "┴", "┼", "╴", "╵", "╶", "╷", "╼", "╽", "╾", "╿"],
      },
      {
        labelKey: "palette.section.heavy",
        chars: ["━", "┃", "┏", "┓", "┗", "┛", "┣", "┫", "┳", "┻", "╋", "╸", "╹", "╺", "╻"],
      },
      {
        labelKey: "palette.section.double",
        chars: ["═", "║", "╔", "╗", "╚", "╝", "╠", "╣", "╦", "╩", "╬"],
      },
      {
        labelKey: "palette.section.rounded",
        chars: ["╭", "╮", "╯", "╰", "◜", "◝", "◞", "◟"],
      },
      {
        labelKey: "palette.section.dashed",
        chars: ["┄", "┆", "┈", "┊", "╌", "╎", "╍", "╏", "╱", "╲", "╳"],
      },
      {
        labelKey: "palette.section.blocks",
        chars: ["░", "▒", "▓", "█", "▀", "▄", "▌", "▐", "▖", "▗", "▘", "▝", "▙", "▟", "▛", "▜", "▚", "▞"],
      },
    ],
  },
  {
    id: "arrows",
    labelKey: "palette.cat.arrows",
    icon: "move-up-right",
    sections: [
      {
        labelKey: "palette.section.arrows",
        chars: [
          "←", "↑", "→", "↓", "↔", "↕", "↖", "↗", "↘", "↙",
          "⇐", "⇑", "⇒", "⇓", "⇔", "⇕", "⇖", "⇗", "⇘", "⇙",
          "⟵", "⟶", "⟷", "⟸", "⟹", "⟺",
        ],
      },
      {
        labelKey: "palette.section.hooks",
        chars: ["↵", "↳", "↴", "↰", "↱", "⤴", "⤵", "↪", "↩", "↶", "↷", "↺", "↻", "⟳", "⟲"],
      },
      {
        labelKey: "palette.section.triangles",
        chars: ["▶", "◀", "▲", "▼", "▷", "◁", "△", "▽", "◢", "◣", "◤", "◥", "➤", "➣", "➢", "➡", "⬅", "⬆", "⬇"],
      },
    ],
  },
  {
    id: "shapes",
    labelKey: "palette.cat.shapes",
    icon: "shapes",
    sections: [
      {
        labelKey: "palette.section.geometry",
        chars: ["●", "○", "◯", "◉", "◎", "◍", "◆", "◇", "◈", "▲", "△", "▼", "▽", "■", "□", "▪", "▫", "▬", "▭", "▮", "▯"],
      },
      {
        labelKey: "palette.section.stars",
        chars: ["★", "☆", "✦", "✧", "✶", "✷", "✸", "✹", "✩", "✪", "✫", "✬", "✭", "✮", "✯", "✰", "✱", "✲", "✳", "✴", "❂", "❖", "⬢", "⬣", "⬤", "⬥"],
      },
      {
        labelKey: "palette.section.frames",
        chars: ["╭", "╮", "╯", "╰", "╔", "╗", "╚", "╝", "╠", "╣", "╦", "╩", "╬", "◜", "◝", "◞", "◟", "⌜", "⌝", "⌞", "⌟"],
      },
    ],
  },
  {
    id: "symbols",
    labelKey: "palette.cat.symbols",
    icon: "sparkles",
    sections: [
      {
        labelKey: "palette.section.marks",
        chars: ["•", "·", "°", "±", "×", "÷", "≠", "≈", "≤", "≥", "≡", "∞", "§", "¶", "©", "®", "™", "µ", "¥", "€", "£", "¢"],
      },
      {
        labelKey: "palette.section.checks",
        chars: ["✓", "✔", "✗", "✘", "☐", "☑", "☒", "★", "☆", "⚑", "⚐", "⚠", "☮", "☯", "☺", "☻", "♠", "♣", "♥", "♦", "♪", "♫", "☀", "☁", "☂", "☎", "✉", "✈"],
      },
      {
        labelKey: "palette.section.ornaments",
        chars: ["✎", "✏", "✐", "✑", "✒", "⌘", "⌥", "⇧", "⌃", "⌫", "⌦", "⎋", "⏎", "␣", "⌁", "⌂", "⌘", "☰", "☷", "⏚", "⏛"],
      },
    ],
  },
  {
    id: "braille",
    labelKey: "palette.cat.braille",
    icon: "braille",
    sections: [
      {
        labelKey: "palette.section.braille",
        chars: ["⠁", "⠂", "⠃", "⠄", "⠅", "⠆", "⠇", "⡀", "⡁", "⡂", "⡃", "⡄", "⡅", "⡆", "⣀", "⣁", "⣂", "⣄", "⣿", "⠿", "⡿", "⢿", "⣷", "⣯", "⣟", "⣻"],
      },
      {
        labelKey: "palette.section.gauges",
        chars: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█", "░", "▒", "▓"],
      },
    ],
  },
  {
    id: "emoji",
    labelKey: "palette.cat.emoji",
    icon: "smile",
    sections: [
      {
        labelKey: "palette.section.emoji",
        chars: ["✨", "🌟", "⭐", "🔥", "💡", "✅", "❌", "⚡", "💎", "🎯", "🚀", "🎨", "🧩", "📝", "📌", "📎", "🔍", "🔔", "🎉", "🎁", "🍀", "🌈", "☕", "🌙", "☀️", "🌊"],
      },
      {
        labelKey: "palette.section.faces",
        chars: ["🙂", "😀", "😎", "🤔", "😮", "😢", "😡", "🤖", "👽", "💀", "👻", "🐱", "🐶", "🦊", "🐼", "🐸", "🐙", "🦄", "🐝", "🦋"],
      },
    ],
  },
];

export interface DrawingTemplate {
  id: string;
  labelKey: MessageKey;
  art: string;
}

function lines(text: string): string {
  return text.replace(/^\n+|\n+$/g, "");
}

export const TEMPLATES: DrawingTemplate[] = [
  {
    id: "box",
    labelKey: "template.box",
    art: lines(`
┌──────────────┐
│              │
└──────────────┘`),
  },
  {
    id: "roundedBox",
    labelKey: "template.roundedBox",
    art: lines(`
╭──────────────╮
│              │
╰──────────────╯`),
  },
  {
    id: "doubleBox",
    labelKey: "template.doubleBox",
    art: lines(`
╔══════════════╗
║              ║
╚══════════════╝`),
  },
  {
    id: "titledBox",
    labelKey: "template.titledBox",
    art: lines(`
┌─ Title ──────────┐
│                  │
│                  │
└──────────────────┘`),
  },
  {
    id: "card",
    labelKey: "template.card",
    art: lines(`
╭──────────────────╮
│  ✎ Note          │
├──────────────────┤
│                  │
╰──────────────────╯`),
  },
  {
    id: "callout",
    labelKey: "template.callout",
    art: lines(`
 ╭────────────────╮
 │  Note           │
 ╰───────┬─────────╯
         ▼`),
  },
  {
    id: "table",
    labelKey: "template.table",
    art: lines(`
┌──────┬──────┬──────┐
│      │      │      │
├──────┼──────┼──────┤
│      │      │      │
└──────┴──────┴──────┘`),
  },
  {
    id: "tree",
    labelKey: "template.tree",
    art: lines(`
      ┌───────┐
      │ Root  │
      └───┬───┘
     ┌────┴────┐
 ┌───▼───┐ ┌───▼───┐
 │   A   │ │   B   │
 └───────┘ └───────┘`),
  },
  {
    id: "downArrow",
    labelKey: "template.downArrow",
    art: lines(`
┌────────────┐
│   Flow     │
└──────┬─────┘
       │
       ▼`),
  },
  {
    id: "rightArrow",
    labelKey: "template.rightArrow",
    art: lines(`
┌──────────┐
│  Action  │─────────→
└──────────┘`),
  },
  {
    id: "progress",
    labelKey: "template.progress",
    art: lines(`
██████████████░░░░░░░░░░ 58%`),
  },
  {
    id: "checklist",
    labelKey: "template.checklist",
    art: lines(`
☑  Design
☑  Draw
☐  Export`),
  },
  {
    id: "heart",
    labelKey: "template.heart",
    art: lines(`
 ███   ███
█████ █████
███████████
 █████████
   █████
     █`),
  },
  {
    id: "banner",
    labelKey: "template.banner",
    art: lines(`
╔════════════════════════════╗
║  U N I D R A W             ║
╚════════════════════════════╝`),
  },
  {
    id: "database",
    labelKey: "template.database",
    art: lines(`
   ╭────────────╮
  ╱              ╲
 │                │
  ╲              ╱
   ╰────────────╯`),
  },
  {
    id: "sparkles",
    labelKey: "template.sparkles",
    art: lines(`
   ✦       ★       ✦
      ╲     │     ╱
       ✧    │    ✧
  ──────────┼──────────
       ✧    │    ✧
      ╱     │     ╲
   ✦       ★       ✦`),
  },
];
