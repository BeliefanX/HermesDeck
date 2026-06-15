import type { ToolSummary } from '@/lib/types';
import { makeCache } from './core';
import { indexSkillFiles } from './skills';

function taskGroupForName(name: string, category?: string): ToolSummary['taskGroup'] {
  const haystack = `${category ?? ''} ${name}`.toLowerCase();
  if (/\b(browser|playwright|puppeteer|web|selenium)\b/.test(haystack)) return 'browser';
  if (/\b(git|github|code|codex|repo|dev|test|ci|npm|python|node)\b/.test(haystack)) return 'coding';
  if (/\b(search|research|tavily|web-search|readwise)\b/.test(haystack)) return 'research';
  if (/\b(file|drive|doc|sheet|excel|spreadsheet|pdf)\b/.test(haystack)) return 'files';
  if (/\b(slack|telegram|discord|mail|message|lark|feishu|im)\b/.test(haystack)) return 'messaging';
  if (/\b(deploy|vercel|cloudflare|aws|docker|terminal|shell)\b/.test(haystack)) return 'devops';
  if (/\b(image|video|audio|music|spotify|media|presentation|deck)\b/.test(haystack)) return 'media';
  if (/\b(agent|skill|memory|kanban|task|plan)\b/.test(haystack)) return 'agents';
  return 'unknown';
}

async function getToolsUncached(): Promise<ToolSummary[]> {
  const out: ToolSummary[] = [];
  const seen = new Set<string>();
  const add = (tool: ToolSummary) => {
    const key = `${tool.kind}:${tool.source ?? 'unknown'}:${tool.name}:${tool.relPath ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tool);
  };

  const skills = await indexSkillFiles();
  for (const skill of skills) {
    add({
      name: skill.name,
      kind: 'skill',
      enabled: true,
      category: skill.category,
      source: 'local',
      taskGroup: taskGroupForName(skill.name, skill.category),
      relPath: skill.relPath,
    });
  }

  return out.sort((a, b) => {
    const group = (a.taskGroup ?? 'unknown').localeCompare(b.taskGroup ?? 'unknown');
    if (group) return group;
    const kind = a.kind.localeCompare(b.kind);
    if (kind) return kind;
    return a.name.localeCompare(b.name);
  });
}

export const getTools = makeCache(10_000, getToolsUncached);
