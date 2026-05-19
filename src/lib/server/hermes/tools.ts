import type { ToolSummary } from '@/lib/types';
import { execFileAsync, makeCache } from './core';
import { indexSkillFiles } from './skills';

// Map a toolset name to a coarse task group so the deck UI can offer
// research / coding / browser filters without each toolset declaring its own
// taxonomy. Keep the table small — unknown entries fall through to "unknown".
const TOOLSET_GROUPS: Record<string, ToolSummary['taskGroup']> = {
  web: 'research', search: 'research', session_search: 'research',
  browser: 'browser',
  terminal: 'devops', code_execution: 'coding',
  file: 'files',
  vision: 'media', image_gen: 'media', tts: 'media',
  skills: 'planning', todo: 'planning', clarify: 'planning', delegation: 'agents',
  memory: 'memory',
  cronjob: 'devops',
  messaging: 'messaging',
  rl: 'agents', moa: 'agents',
  homeassistant: 'devops', spotify: 'media', yuanbao: 'agents',
};

const SKILL_GROUP_BY_CATEGORY: Record<string, ToolSummary['taskGroup']> = {
  'autonomous-ai-agents': 'agents',
  'software-development': 'coding',
  'creative': 'media',
  'apple': 'devops',
  'productivity': 'planning',
};

function inferTaskGroup(kind: ToolSummary['kind'], name: string, category?: string): ToolSummary['taskGroup'] {
  if (kind === 'toolset' && TOOLSET_GROUPS[name]) return TOOLSET_GROUPS[name];
  if (kind === 'skill' && category && SKILL_GROUP_BY_CATEGORY[category]) return SKILL_GROUP_BY_CATEGORY[category];
  if (kind === 'mcp') return 'research';
  if (/lark/.test(name)) return 'messaging';
  if (/browser|chrome|playwright|puppeteer/.test(name)) return 'browser';
  if (/file|drive|fs/.test(name)) return 'files';
  if (/git|deploy|docker|k8s|terraform/.test(name)) return 'devops';
  if (/test|review|lint|debug|coding/.test(name)) return 'coding';
  if (/memory/.test(name)) return 'memory';
  return 'unknown';
}

async function getToolsUncached(): Promise<ToolSummary[]> {
  const tools: ToolSummary[] = [];
  // Hermes emits ANSI color codes and Rich box-drawing tables. We need to
  // strip both before parsing — the ESC byte (0x1B) sometimes survives transport
  // (real ANSI), other times it's already been stripped leaving literal `[1;36m`.
  const stripAnsi = (s: string): string =>
    s
      .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\[[0-9]+(?:;[0-9]+)*m/g, '');
  const isBoxChar = (ch: string): boolean => /[─-╿]/.test(ch);
  // The skills footer reads e.g. `0 hub-installed, 89 builtin, 86 local —
  // 175 enabled, 0 disabled`. Without this guard the previous parser swallowed
  // it as a phantom skill called "0".
  const isSkillsFooter = (s: string): boolean =>
    /\b\d+\s+(hub-installed|builtin|local|enabled|disabled)\b/.test(s);
  // `hermes tools list` prefixes each line with a status glyph
  // (✓ enabled / ✗ disabled / ● etc.) followed by the tool identifier.
  const stripStatus = (line: string): { rest: string; enabled: boolean } => {
    const m = line.match(/^([✓✔✗✘●○•])\s*(?:enabled|disabled|on|off)?\s+(.*)$/i);
    if (m) return { rest: m[2], enabled: !/✗|✘/.test(m[1]) && !/disabled|off/i.test(line) };
    return { rest: line, enabled: !/disabled|off/i.test(line) };
  };
  // Force a wide pseudo-terminal width so Rich tables don't truncate names
  // with an ellipsis in the middle column.
  const wideEnv = { ...process.env, COLUMNS: '400', FORCE_COLOR: '0', NO_COLOR: '1' };

  // `tools list` and `skills list` are independent CLI invocations — running
  // them in parallel halves wall-clock latency on a cold call. We also kick
  // off a filesystem walk for SKILL.md paths so we can attach `relPath` to
  // each skill row without a follow-up call from the UI.
  const [toolsRes, skillsRes, skillIndexRes] = await Promise.allSettled([
    execFileAsync('hermes', ['tools', 'list'], { timeout: 12000, env: wideEnv }),
    execFileAsync('hermes', ['skills', 'list'], { timeout: 12000, env: wideEnv }),
    indexSkillFiles(),
  ]);

  const skillPathByName = new Map<string, string>();
  if (skillIndexRes.status === 'fulfilled') {
    for (const entry of skillIndexRes.value) {
      // Last-writer-wins on duplicate names — categorized matches first since
      // the walk is deterministic, and Hermes only ships one of each anyway.
      skillPathByName.set(entry.name, entry.relPath);
    }
  }

  if (toolsRes.status === 'fulfilled') {
    const { stdout } = toolsRes.value;
    let mode: 'toolset' | 'mcp' | 'unknown' = 'unknown';
    let mcpSource: 'builtin' | 'mcp' = 'mcp';
    let mcpScope = '';
    for (const raw of stdout.split(/\r?\n/)) {
      const line = stripAnsi(raw);
      const t = line.trim();
      if (!t) continue;
      // Section headers — track which list we're inside.
      const lc = t.toLowerCase();
      if (/built-?in toolsets/.test(lc)) { mode = 'toolset'; mcpSource = 'builtin'; continue; }
      if (/^mcp servers?:/.test(lc)) { mode = 'mcp'; mcpSource = 'mcp'; continue; }
      if (/^plugin\b/.test(lc) && /:$/.test(t)) { mode = 'mcp'; mcpSource = 'plugin' as 'mcp'; mcpScope = ''; continue; }
      if (/^(tool|tools|---|===)/i.test(t) || /:$/.test(t)) continue;
      if (mode === 'toolset') {
        const { rest, enabled } = stripStatus(t);
        const cols = rest.split(/\s{2,}|\t/).filter(Boolean);
        const name = cols[0] || rest.split(/\s+/)[0];
        if (!name) continue;
        const description = cols.slice(1).join(' · ').replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*/u, '').trim();
        tools.push({
          name,
          kind: 'toolset',
          enabled,
          description: description || rest,
          source: 'builtin',
          taskGroup: inferTaskGroup('toolset', name),
        });
      } else if (mode === 'mcp') {
        // Lines look like:  searxng  [include only: searxng_web_search]
        const cols = t.split(/\s{2,}|\t/).map((s) => s.trim()).filter(Boolean);
        const name = cols[0];
        if (!name) continue;
        if (isSkillsFooter(t)) continue;
        const description = cols.slice(1).join(' · ');
        tools.push({
          name,
          kind: 'mcp',
          enabled: true,
          source: mcpSource,
          description: description || undefined,
          taskGroup: inferTaskGroup('mcp', name),
        });
      }
      void mcpScope;
    }
  }

  if (skillsRes.status === 'fulfilled') {
    const { stdout } = skillsRes.value;
    const lines = stdout.split(/\r?\n/);
    let seenHeader = false;
    let seen = 0;
    for (const raw of lines) {
      if (seen >= 240) break;
      const cleaned = stripAnsi(raw);
      const trimmed = cleaned.trim();
      if (!trimmed) continue;
      const first = trimmed[0];
      if (first === '│' || first === '┃') {
        const cells = trimmed
          .split(/[│┃]/)
          .map((c) => c.trim())
          .filter((c) => c.length > 0);
        if (cells.length === 0) continue;
        const name = cells[0];
        if (!seenHeader && /^name$/i.test(name)) { seenHeader = true; continue; }
        if (!name || /^name$/i.test(name)) continue;
        const category = cells[1] || '';
        const sourceRaw = (cells[2] || '').toLowerCase();
        const trust = cells[3] || '';
        const status = (cells[4] || '').toLowerCase();
        const enabled = status ? /enabled|on/.test(status) : undefined;
        const source: ToolSummary['source'] = sourceRaw.startsWith('built') ? 'builtin'
          : sourceRaw.startsWith('hub') ? 'hub'
          : sourceRaw.startsWith('local') ? 'local'
          : sourceRaw ? 'unknown' : 'unknown';
        tools.push({
          name,
          kind: 'skill',
          enabled,
          category: category || undefined,
          source,
          trust: trust || undefined,
          description: [category, sourceRaw, trust].filter(Boolean).join(' · '),
          taskGroup: inferTaskGroup('skill', name, category),
          relPath: skillPathByName.get(name),
        });
        seen++;
        continue;
      }
      if (isBoxChar(first)) continue;
      // Filter the skills footer summary explicitly so it never reaches the
      // generic plain-text fallback below.
      if (isSkillsFooter(trimmed)) continue;
      if (/^(installed skills|name\s+category)/i.test(trimmed)) continue;
      // Plain-text fallback for older Hermes builds.
      const { rest } = stripStatus(trimmed);
      const name = rest.split(/\s{2,}|\t/)[0].trim();
      if (!name || /^[-=:]/.test(name)) continue;
      tools.push({
        name,
        kind: 'skill',
        description: rest,
        taskGroup: inferTaskGroup('skill', name),
        relPath: skillPathByName.get(name),
      });
      seen++;
    }
  }
  return tools.slice(0, 240);
}

export const getTools = makeCache(10_000, getToolsUncached);
