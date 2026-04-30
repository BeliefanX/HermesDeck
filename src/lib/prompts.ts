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
  { kind: 'action', key: 'new',     label: 'New chat',     description: 'Open a fresh local conversation',        action: 'new' },
  { kind: 'action', key: 'clear',   label: 'Clear thread', description: 'Clear messages (keep the session)',      action: 'clear' },
  { kind: 'action', key: 'regen',   label: 'Regenerate',   description: 'Re-answer the last user message',        action: 'regen' },
  { kind: 'action', key: 'stop',    label: 'Stop',         description: 'Abort the in-flight streaming response', action: 'stop' },

  {
    kind: 'prompt',
    key: 'summarize',
    label: 'Summarize',
    description: 'Summarize the conversation or attachments above',
    template: 'Please summarize the content above, listing the key points and conclusions. {cursor}',
  },
  {
    kind: 'prompt',
    key: 'translate-en',
    label: 'Translate to English',
    description: 'Translate the following text into English',
    template: 'Please translate the following text into natural, idiomatic English:\n\n{cursor}',
  },
  {
    kind: 'prompt',
    key: 'translate-zh',
    label: 'Translate to Chinese',
    description: 'Translate the following text into Chinese',
    template: '请将下面的内容翻译成自然、地道的中文：\n\n{cursor}',
  },
  {
    kind: 'prompt',
    key: 'explain',
    label: 'Explain code',
    description: 'Explain how the code below works',
    template: 'Please explain how the code below works, including key logic, possible side effects, and performance characteristics:\n\n```\n{cursor}\n```',
  },
  {
    kind: 'prompt',
    key: 'fix',
    label: 'Fix bug',
    description: 'Identify and fix bugs in the code',
    template: 'The code below may contain a bug. Please help me find the issue and provide a fixed version:\n\n```\n{cursor}\n```',
  },
  {
    kind: 'prompt',
    key: 'test',
    label: 'Write tests',
    description: 'Generate unit tests for the code',
    template: 'Please write unit tests for the code below, covering edge cases:\n\n```\n{cursor}\n```',
  },
  {
    kind: 'prompt',
    key: 'refactor',
    label: 'Refactor code',
    description: 'Improve readability and structure',
    template: 'Please refactor the code below to improve readability, naming, and structure while preserving behavior:\n\n```\n{cursor}\n```',
  },
  {
    kind: 'prompt',
    key: 'docstring',
    label: 'Add comments',
    description: 'Add comments or docstrings',
    template: 'Please add appropriate comments or docstrings to the code below, only where they add real clarity:\n\n```\n{cursor}\n```',
  },
  {
    kind: 'prompt',
    key: 'improve',
    label: 'Improve writing',
    description: 'Polish the text below',
    template: 'Please polish the text below so it reads more clearly and naturally, while keeping the original meaning:\n\n{cursor}',
  },
  {
    kind: 'prompt',
    key: 'brainstorm',
    label: 'Brainstorm',
    description: 'Explore ideas around a topic',
    template: 'Please brainstorm around the topic below — give 5–8 angles, each with a short explanation:\n\n{cursor}',
  },
  {
    kind: 'prompt',
    key: 'plan',
    label: 'Plan steps',
    description: 'Break a goal into actionable steps',
    template: 'Please break the goal below into a clear, actionable step-by-step plan:\n\n{cursor}',
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
