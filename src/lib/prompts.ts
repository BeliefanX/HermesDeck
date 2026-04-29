/**
 * Slash command catalog. Triggered when the user types `/` at the start of
 * the composer (or after a newline). Two flavors:
 *
 * - `prompt` — inserts a template into the input, replacing the slash token.
 *   The user can keep typing context, attachments, etc. before sending.
 * - `action` — fires a control-plane action (new chat, regenerate, stop,
 *   clear current). The slash token is removed; nothing is inserted.
 */

export type SlashAction = 'new' | 'clear' | 'regen' | 'stop';

export type SlashCommand =
  | {
      kind: 'prompt';
      key: string;
      label: string;
      description: string;
      template: string;
      /**
       * Marker inserted into the template that the caret should land on after
       * insertion. Strip from the visible text. Default: '{cursor}'.
       */
      cursorMarker?: string;
    }
  | {
      kind: 'action';
      key: string;
      label: string;
      description: string;
      action: SlashAction;
    };

/**
 * Built-in catalog. Keys must be unique and lowercase; matching is
 * case-insensitive on prefix.
 */
export const BUILTIN_COMMANDS: SlashCommand[] = [
  { kind: 'action', key: 'new',     label: '新对话',       description: '开启一个新的本地对话', action: 'new' },
  { kind: 'action', key: 'clear',   label: '清空当前对话', description: '清除消息（保留会话）', action: 'clear' },
  { kind: 'action', key: 'regen',   label: '重新生成',     description: '基于上一条用户消息重答', action: 'regen' },
  { kind: 'action', key: 'stop',    label: '停止生成',     description: '中止当前流式响应', action: 'stop' },

  {
    kind: 'prompt',
    key: 'summarize',
    label: '总结上文',
    description: '请助手对前面对话或附件做摘要',
    template: '请总结上面的内容，列出要点和结论。{cursor}',
  },
  {
    kind: 'prompt',
    key: 'translate-en',
    label: '翻译为英文',
    description: '将后文翻译成英语',
    template: 'Please translate the following text to natural English:\n\n{cursor}',
  },
  {
    kind: 'prompt',
    key: 'translate-zh',
    label: '翻译为中文',
    description: '将后文翻译成中文',
    template: '请将下面的内容翻译成自然、地道的中文：\n\n{cursor}',
  },
  {
    kind: 'prompt',
    key: 'explain',
    label: '解释代码',
    description: '解释下方代码的工作原理',
    template: '请解释下面这段代码的工作原理，包括关键逻辑、可能的副作用和性能特征：\n\n```\n{cursor}\n```',
  },
  {
    kind: 'prompt',
    key: 'fix',
    label: '修复 Bug',
    description: '指出并修复代码中的 Bug',
    template: '下面这段代码可能有 Bug，请帮我定位问题并给出修复后的版本：\n\n```\n{cursor}\n```',
  },
  {
    kind: 'prompt',
    key: 'test',
    label: '编写测试',
    description: '为代码生成测试',
    template: '请为下面这段代码写单元测试，覆盖边界情况：\n\n```\n{cursor}\n```',
  },
  {
    kind: 'prompt',
    key: 'refactor',
    label: '重构代码',
    description: '改进代码可读性和结构',
    template: '请重构下面这段代码，提升可读性、命名和结构，保持行为不变：\n\n```\n{cursor}\n```',
  },
  {
    kind: 'prompt',
    key: 'docstring',
    label: '补全注释',
    description: '为代码添加注释或文档',
    template: '请为下面这段代码添加合适的中文注释或 docstring，仅在必要处添加：\n\n```\n{cursor}\n```',
  },
  {
    kind: 'prompt',
    key: 'improve',
    label: '改进表达',
    description: '润色我的文字',
    template: '请帮我润色下面这段文字，使其更清晰、地道，但保留原意：\n\n{cursor}',
  },
  {
    kind: 'prompt',
    key: 'brainstorm',
    label: '头脑风暴',
    description: '围绕某个主题展开想法',
    template: '请围绕以下主题进行头脑风暴，给出 5–8 个角度，每个角度配一段简短解释：\n\n{cursor}',
  },
  {
    kind: 'prompt',
    key: 'plan',
    label: '制定计划',
    description: '把任务拆成可执行步骤',
    template: '请帮我把下面这个目标拆成清晰、可执行的步骤计划：\n\n{cursor}',
  },
];

/** Strip the leading `/foo` token from the input. */
export function extractSlashQuery(text: string, caret: number): null | { start: number; end: number; query: string } {
  // Only trigger when the slash is at the start, or right after a newline.
  // The token runs from `/` to the next whitespace/newline.
  if (caret <= 0) return null;
  // Find the start of the current line.
  let lineStart = caret;
  while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart -= 1;
  // The line must begin with '/'.
  if (text[lineStart] !== '/') return null;
  // The token ends at the next whitespace OR at the caret OR end of string.
  let end = caret;
  // Token only counts up to the first whitespace within the line.
  for (let i = lineStart + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      end = i;
      break;
    }
    end = i + 1;
  }
  // If the caret is past the token (e.g. after a space), don't trigger.
  if (caret > end) return null;
  const query = text.slice(lineStart + 1, end);
  return { start: lineStart, end, query };
}

/** Filter commands whose key/label matches the prefix query (case-insensitive). */
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  // Two passes: (1) prefix matches on key, (2) substring matches on label.
  const prefix = commands.filter((c) => c.key.toLowerCase().startsWith(q));
  const substr = commands.filter((c) => !prefix.includes(c) && (
    c.key.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)
  ));
  return [...prefix, ...substr];
}

/**
 * Replace the slash token at [start, end) with the resolved template, and
 * return the new text plus the caret position the editor should jump to.
 *
 * If the template contains the cursor marker, the caret lands there and the
 * marker is stripped. Otherwise the caret lands at the end of the inserted
 * text.
 */
export function applyPromptTemplate(
  text: string,
  start: number,
  end: number,
  template: string,
  cursorMarker = '{cursor}',
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const idx = template.indexOf(cursorMarker);
  if (idx === -1) {
    const next = before + template + after;
    return { text: next, caret: (before + template).length };
  }
  const head = template.slice(0, idx);
  const tail = template.slice(idx + cursorMarker.length);
  const next = before + head + tail + after;
  return { text: next, caret: (before + head).length };
}
