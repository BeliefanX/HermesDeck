import type { ToolSummary } from '@/lib/types';
import { hermesApiGet, makeKeyedCache } from './core';
import { indexSkillFiles } from './skills';

type ToolsOptions = { allowLocalFallback?: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function arrayFromPayload(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  if (isRecord(payload.data)) return arrayFromPayload(payload.data, keys);
  return [];
}

function taskGroupForName(name: string, category?: string): ToolSummary['taskGroup'] {
  const haystack = `${category ?? ''} ${name}`.toLowerCase();
  if (/\b(browser|playwright|puppeteer|web|selenium)\b/.test(haystack)) return 'browser';
  if (/\b(git|github|code|codex|repo|dev|test|ci|npm|python|node)\b/.test(haystack)) return 'coding';
  if (/\b(search|research|tavily|web-search|readwise)\b/.test(haystack)) return 'research';
  if (/\b(file|drive|doc|sheet|excel|spreadsheet|pdf)\b/.test(haystack)) return 'files';
  if (/\b(slack|telegram|discord|mail|message|lark|feishu|im)\b/.test(haystack)) return 'messaging';
  if (/\b(deploy|vercel|cloudflare|aws|docker|terminal|shell)\b/.test(haystack)) return 'devops';
  if (/\b(image|video|audio|music|spotify|media|presentation|deck)\b/.test(haystack)) return 'media';
  if (/\b(agent|skill|memory|task|plan)\b/.test(haystack)) return 'agents';
  return 'unknown';
}

function normalizeApiItem(raw: unknown, kind: ToolSummary['kind']): ToolSummary | null {
  if (typeof raw === 'string') {
    const name = raw.trim();
    return name ? { name, kind, enabled: true, source: 'builtin', taskGroup: taskGroupForName(name) } : null;
  }
  if (!isRecord(raw)) return null;
  const name = stringValue(raw.name) || stringValue(raw.id) || stringValue(raw.slug);
  if (!name) return null;
  const category = stringValue(raw.category) || stringValue(raw.group);
  return {
    name,
    kind,
    enabled: raw.enabled === undefined ? true : raw.enabled !== false,
    description: stringValue(raw.description) || stringValue(raw.summary),
    category,
    source: stringValue(raw.source) as ToolSummary['source'] || 'builtin',
    trust: stringValue(raw.trust),
    taskGroup: taskGroupForName(name, category),
  };
}

async function getApiTools(profile: string): Promise<ToolSummary[]> {
  const [skillsPayload, toolsetsPayload] = await Promise.all([
    hermesApiGet<unknown>('/v1/skills', 5000, profile),
    hermesApiGet<unknown>('/v1/toolsets', 5000, profile),
  ]);
  return [
    ...arrayFromPayload(skillsPayload, ['skills', 'items', 'data']).map((item) => normalizeApiItem(item, 'skill')),
    ...arrayFromPayload(toolsetsPayload, ['toolsets', 'items', 'data']).map((item) => normalizeApiItem(item, 'toolset')),
  ].filter((tool): tool is ToolSummary => tool !== null);
}

async function getLocalTools(): Promise<ToolSummary[]> {
  const skills = await indexSkillFiles();
  return skills.map((skill) => ({
    name: skill.name,
    kind: 'skill',
    enabled: true,
    category: skill.category,
    source: 'local',
    taskGroup: taskGroupForName(skill.name, skill.category),
    relPath: skill.relPath,
  }));
}

async function getToolsUncached(key: string): Promise<ToolSummary[]> {
  const [profile, fallbackFlag] = key.split('\t');
  const allowLocalFallback = fallbackFlag === '1';
  const out: ToolSummary[] = [];
  const seen = new Set<string>();
  const add = (tool: ToolSummary) => {
    const dedupe = `${tool.kind}:${tool.source ?? 'unknown'}:${tool.name}:${tool.relPath ?? ''}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push(tool);
  };

  try {
    for (const tool of await getApiTools(profile || 'default')) add(tool);
  } catch (err) {
    if (!allowLocalFallback) throw err;
    for (const tool of await getLocalTools()) add(tool);
  }

  return out.sort((a, b) => {
    const group = (a.taskGroup ?? 'unknown').localeCompare(b.taskGroup ?? 'unknown');
    if (group) return group;
    const kind = a.kind.localeCompare(b.kind);
    if (kind) return kind;
    return a.name.localeCompare(b.name);
  });
}

const getToolsCached = makeKeyedCache(10_000, getToolsUncached);

export function getTools(profile = 'default', options: ToolsOptions = {}): Promise<ToolSummary[]> {
  return getToolsCached(`${profile}\t${options.allowLocalFallback ? '1' : '0'}`);
}
