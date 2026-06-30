import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const modulePath = resolve('src/lib/server/hermes/chat-stream.ts');
const timeoutsPath = resolve('src/lib/chat-timeouts.ts');
let nonce = 0;

async function loadChatStream() {
  const timeoutsSource = readFileSync(timeoutsPath, 'utf8');
  const source = readFileSync(modulePath, 'utf8')
    .replace(/import \{[\s\S]*?\} from '\.\/core';\n/, '')
    .replace(/import \{ CHAT_STREAM_DEFAULT_TIMEOUT_MS, CHAT_STREAM_HARD_TIMEOUT_MS \} from '\.\.\/\.\.\/chat-timeouts';\n/, `${timeoutsSource}\n`)
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

test('chat stream timeout defaults to Hermes subagent timeout plus five minutes', async () => {
  const { CHAT_STREAM_DEFAULT_TIMEOUT_MS, CHAT_STREAM_HARD_TIMEOUT_MS, HERMES_SUBAGENT_MAX_TIMEOUT_MS } = await loadChatStream();
  assert.equal(HERMES_SUBAGENT_MAX_TIMEOUT_MS, 30 * 60_000);
  assert.equal(CHAT_STREAM_DEFAULT_TIMEOUT_MS, HERMES_SUBAGENT_MAX_TIMEOUT_MS + 5 * 60_000);
  assert.equal(CHAT_STREAM_DEFAULT_TIMEOUT_MS, 2_100_000);
  assert.equal(CHAT_STREAM_HARD_TIMEOUT_MS, CHAT_STREAM_DEFAULT_TIMEOUT_MS);
});

test('Hermes request body preflight uses the current 10MB byte limit', async () => {
  const { HERMES_REQUEST_BODY_BYTE_LIMIT, hermesRequestBodyByteSize } = await loadChatStream();
  const b64 = (bytes) => 'A'.repeat(Math.ceil(bytes / 3) * 4);
  const kevinTwoImages = JSON.stringify({
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: 'two images' },
        { type: 'input_image', image_url: { url: `data:image/jpeg;base64,${b64(166_896)}`, detail: 'auto' } },
        { type: 'input_image', image_url: { url: `data:image/jpeg;base64,${b64(650_307)}`, detail: 'auto' } },
      ],
    }],
    stream: true,
    metadata: { profileId: 'sensgift', source: 'hermesdeck' },
  });

  assert.equal(HERMES_REQUEST_BODY_BYTE_LIMIT, 10_000_000);
  assert.equal(hermesRequestBodyByteSize('你'), 3);
  assert.ok(hermesRequestBodyByteSize(kevinTwoImages) > 1_000_000);
  assert.ok(hermesRequestBodyByteSize(kevinTwoImages) <= HERMES_REQUEST_BODY_BYTE_LIMIT);
  assert.ok(hermesRequestBodyByteSize(JSON.stringify({ input: 'x'.repeat(HERMES_REQUEST_BODY_BYTE_LIMIT) })) > HERMES_REQUEST_BODY_BYTE_LIMIT);
});
