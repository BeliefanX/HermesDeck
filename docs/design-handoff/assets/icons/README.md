# Icons

The product uses **lucide-react** exclusively.

- In React production code: `import { Bot, MessageSquare, ... } from 'lucide-react'`.
- In single-file HTML prototypes (e.g. `ui_kits/webui/index.html`), load the lucide UMD bundle from CDN:
  ```html
  <script src="https://unpkg.com/lucide@0.474.0/dist/umd/lucide.min.js"></script>
  ```
  Then mark up icons with `<i data-lucide="message-square"></i>` and call `lucide.createIcons()` after render.

## Sizing

| Context | Size |
|---|---|
| In a pill / badge | 11–12 |
| Inline w/ text | 13 |
| In a button (`.btn`) | 15 |
| In `.metric-icon` / hero | 18 |
| Empty-state hero glyph | 22 |

## Stroke weight

Default lucide stroke (`2px`) is used everywhere — never overridden. Color always inherits or is set inline to a token: `var(--accent)`, `var(--muted)`, `var(--green)`, etc.

## Active glyph set (verbatim from the codebase)

Navigation: `Home, MessageSquare, Bot, Cpu, Radio, Wrench, Terminal, Settings`.
Topbar / shell: `PanelLeftClose, PanelLeftOpen, Sun, Moon, Menu, X`.
Dashboard: `HeartPulse, Database, Hash, BarChart3, Activity, Server, Sparkles, Plug, Boxes, Layers, Clock, GitBranch, ArrowUpRight, ChevronRight, Coins, ArrowDownRight, TrendingUp, DollarSign, Zap, CalendarDays, Flame`.
Chat: `Plus, Square, Send, AlertTriangle, AlertCircle, CheckCircle2, ArrowDown, Paperclip, Upload, Network, MoreHorizontal, Search, Pin, PinOff, Pencil, FolderInput, FolderMinus, FolderPlus, Tag, Archive, ArchiveRestore, Trash2, Inbox, ListFilter`.
Code blocks: `Copy, Check`.
Terminal: `Play, ShieldCheck, ChevronDown`.

**No emoji, no unicode glyphs as icons.** The em-dash `—` is the only allowed unicode character (used for empty values).
