import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const modulePath = resolve('src/lib/server/hermes/chat-stream.ts');
let nonce = 0;

async function loadChatStream() {
  const source = readFileSync(modulePath, 'utf8')
    .replace(/import \{[\s\S]*?\} from '\.\/core';\n/, '')
    .replace(/import \{[\s\S]*?\} from '\.\/attachments';\n/, '')
    .replace(/import \{[\s\S]*?\} from '\.\/stream-hub';\n/, '');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      verbatimModuleSyntax: true,
    },
  });
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}#${Date.now()}-${nonce++}`);
}

test('extractRuntimeSettingsFromEvent reads actual model/reasoning from final response event', async () => {
  const { extractRuntimeSettingsFromEvent } = await loadChatStream();
  assert.deepEqual(extractRuntimeSettingsFromEvent({
    type: 'response.completed',
    response: {
      id: 'resp_1',
      model: 'claude-sonnet-4-20250514',
      reasoning: { effort: 'high' },
    },
  }), {
    model: 'claude-sonnet-4-20250514',
    reasoningEffort: 'high',
  });
});

test('extractRuntimeSettingsFromEvent does not invent reasoning for auto/missing values', async () => {
  const { extractRuntimeSettingsFromEvent } = await loadChatStream();
  assert.deepEqual(extractRuntimeSettingsFromEvent({
    type: 'response.completed',
    response: { model: 'gpt-5.5', reasoning: { effort: 'auto' } },
  }), { model: 'gpt-5.5' });
  assert.deepEqual(extractRuntimeSettingsFromEvent({
    type: 'response.completed',
    response: { model: 'gpt-5.5' },
  }), { model: 'gpt-5.5' });
});
