export type SlashLocalAction = 'new' | 'clear' | 'regen' | 'stop';
export type SlashControl = 'model' | 'reasoning';
export type SlashUnsupportedMode = 'telegram' | 'gateway';

export type SlashCommand =
  | { kind: 'local'; key: string; aliases?: string[]; label: string; description: string; category: string; action: SlashLocalAction; argHint?: string }
  | { kind: 'control'; key: SlashControl; aliases?: string[]; label: string; description: string; category: string; control: SlashControl; argHint?: string }
  | { kind: 'unsupported'; key: string; aliases?: string[]; label: string; description: string; category: string; unsupportedMode: SlashUnsupportedMode; argHint?: string }
  | { kind: 'snippet'; key: string; aliases?: string[]; label: string; description: string; category: string; template: string; cursorMarker?: string; argHint?: string };

export type ParsedSlashCommand = { raw: string; key: string; args: string; commandText: string };

export type SlashSubmitResolution =
  | { handled: false; reason: 'not-slash' | 'unknown' | 'multiline' }
  | { handled: true; type: 'local'; action: SlashLocalAction; key: string }
  | { handled: true; type: 'model'; value?: string; error?: string }
  | { handled: true; type: 'reasoning'; value?: string; mode?: 'reset' | 'view-toggle'; error?: string }
  | { handled: true; type: 'unsupported'; key: string; message: string }
  | { handled: true; type: 'snippet'; text: string; caret: number };

export const TELEGRAM_MENU_PRIORITY = [
  'help', 'new', 'stop', 'status', 'resume', 'sessions', 'model', 'debug', 'restart', 'update',
  'commands', 'approve', 'deny', 'queue', 'steer', 'background', 'reasoning', 'usage', 'platform',
  'profile', 'whoami', 'start', 'topic', 'retry', 'undo', 'title', 'branch', 'compress', 'rollback',
  'agents',
] as const;

export const REASONING_COMMAND_VALUES = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export const REASONING_META_VALUES = ['show', 'hide', 'on', 'off', 'reset'] as const;

export function priorityOfSlashCommand(key: string): number {
  const idx = TELEGRAM_MENU_PRIORITY.indexOf(key as (typeof TELEGRAM_MENU_PRIORITY)[number]);
  return idx === -1 ? 10_000 : idx;
}

export function extractSlashQuery(text: string, caret: number): null | { start: number; end: number; query: string } {
  if (caret <= 0) return null;
  let lineStart = caret;
  while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart -= 1;
  if (text[lineStart] !== '/') return null;
  let end = caret;
  for (let i = lineStart + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n') { end = i; break; }
    end = i + 1;
  }
  if (caret > end) return null;
  return { start: lineStart, end, query: text.slice(lineStart + 1, end) };
}

export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const matches = (c: SlashCommand, mode: 'prefix' | 'contains') => {
    const fields = [c.key, ...(c.aliases || []), c.label, c.description, c.category].map((s) => s.toLowerCase());
    return mode === 'prefix' ? fields.some((f) => f.startsWith(q)) : fields.some((f) => f.includes(q));
  };
  const prefix = commands.filter((c) => matches(c, 'prefix'));
  const substr = commands.filter((c) => !prefix.includes(c) && matches(c, 'contains'));
  return [...prefix, ...substr];
}

export function applyPromptTemplate(text: string, start: number, end: number, template: string, cursorMarker = '{cursor}'): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const idx = template.indexOf(cursorMarker);
  if (idx === -1) {
    const next = before + template + after;
    return { text: next, caret: (before + template).length };
  }
  const head = template.slice(0, idx);
  const tail = template.slice(idx + cursorMarker.length);
  return { text: before + head + tail + after, caret: (before + head).length };
}

export function parseSlashSubmit(input: string): ParsedSlashCommand | null {
  const raw = input.trim();
  if (!raw.startsWith('/')) return null;
  if (/\n/.test(raw)) return null;
  const match = raw.match(/^\/([A-Za-z][A-Za-z0-9_-]*)(?:\s+(.*))?$/);
  if (!match) return null;
  return { raw, key: match[1].toLowerCase(), args: (match[2] || '').trim(), commandText: match[0] };
}

export function findSlashCommand(commands: SlashCommand[], key: string): SlashCommand | undefined {
  const q = key.toLowerCase();
  return commands.find((cmd) => cmd.key.toLowerCase() === q || (cmd.aliases || []).some((a) => a.toLowerCase() === q));
}

export function resolveSlashSubmit(input: string, commands: SlashCommand[], opts: { modelIds?: string[]; reasoningLevels?: string[]; defaultReasoning?: string } = {}): SlashSubmitResolution {
  const parsed = parseSlashSubmit(input);
  if (!parsed) return { handled: false, reason: input.trim().startsWith('/') && /\n/.test(input.trim()) ? 'multiline' : 'not-slash' };
  const cmd = findSlashCommand(commands, parsed.key);
  if (!cmd) return { handled: false, reason: 'unknown' };
  if (cmd.kind === 'local') return { handled: true, type: 'local', action: cmd.action, key: cmd.key };
  if (cmd.kind === 'unsupported') return { handled: true, type: 'unsupported', key: cmd.key, message: `/${cmd.key} is recognized by Hermes Agent, but HermesDeck does not support it yet. Use Telegram for this command.` };
  if (cmd.kind === 'snippet') return { handled: true, type: 'snippet', ...applyPromptTemplate(input, 0, input.length, cmd.template, cmd.cursorMarker) };
  if (cmd.control === 'model') {
    if (!parsed.args) return { handled: true, type: 'model', error: 'Usage: /model <model-id>' };
    const ids = opts.modelIds || [];
    const match = ids.find((id) => id === parsed.args) || ids.find((id) => id.toLowerCase() === parsed.args.toLowerCase());
    if (!match) return { handled: true, type: 'model', error: `Unknown model: ${parsed.args}` };
    return { handled: true, type: 'model', value: match };
  }
  if (!parsed.args) return { handled: true, type: 'reasoning', error: 'Usage: /reasoning <none|minimal|low|medium|high|xhigh|reset>' };
  const arg = parsed.args.toLowerCase();
  if (arg === 'reset') return { handled: true, type: 'reasoning', mode: 'reset', value: opts.defaultReasoning || '' };
  if ((REASONING_META_VALUES as readonly string[]).includes(arg)) return { handled: true, type: 'reasoning', mode: 'view-toggle' };
  const levels = Array.from(new Set([...(opts.reasoningLevels || []), ...REASONING_COMMAND_VALUES].map((v) => v.toLowerCase())));
  if (!levels.includes(arg)) return { handled: true, type: 'reasoning', error: `Unknown reasoning effort: ${parsed.args}` };
  return { handled: true, type: 'reasoning', value: arg };
}
