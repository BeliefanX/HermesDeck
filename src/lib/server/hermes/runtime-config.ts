import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { defaultHermesRoot, PROFILE_ID_RE } from './core';

const MAX_RUNTIME_CONFIG_BYTES = 1024 * 1024;

export type ProfileRuntimeConfig = {
  model?: string;
  provider?: string;
  reasoningEffort?: string;
};

function cleanScalar(value: string): string {
  const withoutComment = value.replace(/\s+#.*$/, '').trim();
  if (!withoutComment) return '';
  if ((withoutComment.startsWith('"') && withoutComment.endsWith('"'))
    || (withoutComment.startsWith("'") && withoutComment.endsWith("'"))) {
    return withoutComment.slice(1, -1).trim();
  }
  return withoutComment;
}

function firstString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function normalizeReasoning(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized !== 'auto' ? normalized : undefined;
}

function scalarPathsFromYaml(text: string): Map<string, string> {
  const values = new Map<string, string>();
  const stack: Array<{ indent: number; key: string }> = [];

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const indent = rawLine.match(/^ */)?.[0].length ?? 0;
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('- ')) continue;
    const match = trimmed.match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/);
    if (!match) continue;

    while (stack.length && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const key = match[1]!;
    const rawValue = (match[2] || '').trim();
    const path = [...stack.map((item) => item.key), key].join('.');

    if (!rawValue || rawValue === '|' || rawValue === '>') {
      stack.push({ indent, key });
      continue;
    }
    values.set(path, cleanScalar(rawValue));
  }

  return values;
}

function runtimeConfigFromYaml(text: string): ProfileRuntimeConfig {
  const values = scalarPathsFromYaml(text);
  const model = firstString(
    values.get('agent.model.default'),
    values.get('agent.model.id'),
    values.get('agent.model'),
    values.get('model.default'),
    values.get('model.id'),
    values.get('model'),
    values.get('default_model'),
    values.get('defaultModel'),
    values.get('current_model'),
    values.get('currentModel'),
  );
  const provider = firstString(
    values.get('agent.model.provider'),
    values.get('agent.provider'),
    values.get('model.provider'),
    values.get('provider'),
    values.get('default_provider'),
    values.get('defaultProvider'),
    values.get('current_provider'),
    values.get('currentProvider'),
  );
  const reasoningEffort = normalizeReasoning(firstString(
    values.get('agent.resolved_reasoning_effort'),
    values.get('agent.resolvedReasoningEffort'),
    values.get('agent.current_reasoning_effort'),
    values.get('agent.currentReasoningEffort'),
    values.get('agent.reasoning_effort'),
    values.get('agent.reasoningEffort'),
    values.get('agent.default_reasoning_effort'),
    values.get('agent.defaultReasoningEffort'),
    values.get('resolved_reasoning_effort'),
    values.get('resolvedReasoningEffort'),
    values.get('current_reasoning_effort'),
    values.get('currentReasoningEffort'),
    values.get('reasoning_effort'),
    values.get('reasoningEffort'),
    values.get('default_reasoning_effort'),
    values.get('defaultReasoningEffort'),
  ));

  return { model, provider, reasoningEffort };
}

export async function readProfileRuntimeConfig(profileId = 'default'): Promise<ProfileRuntimeConfig | null> {
  if (!PROFILE_ID_RE.test(profileId) || profileId === '.' || profileId === '..') return null;
  const root = defaultHermesRoot();
  const file = profileId === 'default'
    ? join(root, 'config.yaml')
    : join(root, 'profiles', profileId, 'config.yaml');
  try {
    const st = await fs.stat(file);
    if (!st.isFile() || st.size > MAX_RUNTIME_CONFIG_BYTES) return null;
    const text = await fs.readFile(file, 'utf8');
    const config = runtimeConfigFromYaml(text);
    return config.model || config.provider || config.reasoningEffort ? config : null;
  } catch {
    return null;
  }
}
