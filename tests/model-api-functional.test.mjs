import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const modelsModulePath = resolve('src/lib/server/hermes/models.ts');
let importNonce = 0;
let handler = () => ({ status: 404, body: { error: 'not_found' } });

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const result = handler(req);
  json(res, result.status ?? 200, result.body);
});

await new Promise((resolveStart) => server.listen(0, '127.0.0.1', resolveStart));
test.after(() => new Promise((resolveStop) => server.close(resolveStop)));

process.env.HERMES_API_BASE = `http://127.0.0.1:${server.address().port}`;
process.env.HERMES_HOME = mkdtempSync(join(tmpdir(), 'hermesdeck-model-api-'));

async function loadModels() {
  const shim = `
const HERMES_API_BASE = process.env.HERMES_API_BASE;
function getHermesApiBase() { return HERMES_API_BASE; }
function apiHeaders() { return { 'Content-Type': 'application/json' }; }
function makeKeyedCache(_ttlMs, fetcher) { return (key) => fetcher(key); }
`;
  const source = readFileSync(modelsModulePath, 'utf8')
    .replace(/import type \{[^}]+\} from '@\/lib\/types';\n/, '')
    .replace(/import \{ apiHeaders, getHermesApiBase, HERMES_API_BASE, makeKeyedCache \} from '\.\/core';\n/, shim);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      verbatimModuleSyntax: true,
    },
  });
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}#${Date.now()}-${importNonce++}`);
}

function setMockHermesApi({ models, profiles }) {
  handler = (req) => {
    if (req.url === '/v1/models') return { body: models };
    if (req.url === '/v1/profiles') return { body: profiles };
    if (req.url === '/api/profiles') return { body: profiles };
    return { status: 404, body: { error: 'not_found' } };
  };
}

function flattenModelIds(response) {
  return response.providers.flatMap((provider) => provider.models.map((model) => model.id));
}

test('getModels uses /v1/profiles runtime model when /v1/models only exposes the Hermes placeholder', async () => {
  setMockHermesApi({
    models: { data: [{ id: 'Hermes Agent', provider: 'hermes' }] },
    profiles: { profiles: [{ id: 'default', model: 'gpt-5.5', provider: 'openai', reasoning_effort: 'auto' }] },
  });

  const { getModels } = await loadModels();
  const response = await getModels('default');

  assert.deepEqual(flattenModelIds(response), ['gpt-5.5']);
  assert.equal(response.default?.model, 'gpt-5.5');
  assert.equal(response.default?.provider, 'openai');
  assert.equal(response.reasoningEffort, 'medium');
  assert.equal(response.reasoningLevels.includes('medium'), true);
});

test('getModels maps missing/auto reasoning to medium and preserves explicit API reasoning', async () => {
  setMockHermesApi({
    models: { data: [{ id: 'Hermes Agent', provider: 'hermes' }] },
    profiles: { profiles: [{ id: 'default', model: 'gpt-5.5', provider: 'openai' }] },
  });
  let mod = await loadModels();
  let response = await mod.getModels('default');
  assert.equal(response.reasoningEffort, 'medium');

  setMockHermesApi({
    models: { data: [{ id: 'Hermes Agent', provider: 'hermes' }] },
    profiles: { profiles: [{ id: 'default', model: 'gpt-5.5', provider: 'openai', reasoningEffort: 'auto' }] },
  });
  mod = await loadModels();
  response = await mod.getModels('default');
  assert.equal(response.reasoningEffort, 'medium');

  setMockHermesApi({
    models: { data: [{ id: 'Hermes Agent', provider: 'hermes' }] },
    profiles: { profiles: [{ id: 'default', model: 'gpt-5.5', provider: 'openai', reasoningEffort: 'high' }] },
  });
  mod = await loadModels();
  response = await mod.getModels('default');
  assert.equal(response.reasoningEffort, 'high');
  assert.equal(response.reasoningLevels.includes('high'), true);
});

test('getModels does not re-add profile runtime placeholders from /v1/profiles', async () => {
  setMockHermesApi({
    models: { data: [{ id: 'Hermes Agent', provider: 'hermes' }] },
    profiles: { profiles: [{ id: 'default', model: 'Hermes Agent', provider: 'hermes', reasoningEffort: 'medium' }] },
  });

  const { getModels } = await loadModels();
  const response = await getModels('default');

  assert.deepEqual(response.providers, []);
  assert.equal(response.default, undefined);
  assert.equal(response.reasoningEffort, 'medium');
});
