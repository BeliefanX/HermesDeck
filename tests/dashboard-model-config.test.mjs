import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const modulePath = resolve('src/lib/server/hermes/dashboard.ts');
const seen = [];
let rejectOptional = false;
const server = createServer((req, res) => {
  seen.push({ url: req.url, token: req.headers['x-hermes-session-token'] });
  const path = new URL(req.url, 'http://localhost').pathname;
  if (rejectOptional && path !== '/api/model/info') {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: 'unauthorized' }));
    return;
  }
  const body = path === '/api/model/info' ? { model: 'gpt-test', provider: 'openai', auto_context_length: 100, capabilities: { supports_tools: true } }
    : path === '/api/model/auxiliary' ? { tasks: [
      { task: 'vision', provider: 'auto', model: '', base_url: 'https://user:secret@example.test/v1' },
      { task: 'unsafe', provider: 'auto', base_url: 'file:///private/config' },
    ] }
      : path === '/api/config' ? { delegation: { model: 'small', provider: 'openai', base_url: 'https://example.test/v1?api_key=must-not-leak', api_key: 'must-not-leak' } }
        : [{ id: 'job-1', model_snapshot: 'gpt-snapshot', provider_snapshot: 'openai', base_url: 'https://example.test/v1#access_token=must-not-leak' }];
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
});
await new Promise((resolveStart) => server.listen(0, '127.0.0.1', resolveStart));
test.after(() => new Promise((resolveStop) => server.close(resolveStop)));
process.env.HERMES_DASHBOARD_BASE = `http://127.0.0.1:${server.address().port}`;
process.env.HERMES_DASHBOARD_SESSION_TOKEN = 'deck-test-token';

async function load() {
  const source = readFileSync(modulePath, 'utf8').replace(/import type \{ DeckModelConfig \} from '@\/lib\/types';\n/, '');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, verbatimModuleSyntax: true } });
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}#${Date.now()}`);
}

test('Dashboard model config whitelists fields, strips URL secrets, and scopes every request', async () => {
  seen.length = 0;
  const { getDashboardModelConfig } = await load();
  const result = await getDashboardModelConfig('research');
  assert.equal(result.main.model, 'gpt-test');
  assert.equal(result.delegation?.baseUrl, 'https://example.test/v1');
  assert.equal(result.auxiliary[0]?.baseUrl, 'https://example.test/v1');
  assert.equal(result.auxiliary[1]?.baseUrl, undefined);
  assert.equal(result.cron[0]?.baseUrl, 'https://example.test/v1');
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
  assert.equal(result.cron[0]?.modelSnapshot, 'gpt-snapshot');
  assert.equal(seen.length, 4);
  assert.ok(seen.every((request) => request.url.includes('profile=research') && request.token === 'deck-test-token'));
});

test('Dashboard auth failures remain explicit while public main metadata renders', async () => {
  seen.length = 0;
  rejectOptional = true;
  const { getDashboardModelConfig } = await load();
  const result = await getDashboardModelConfig('default');
  rejectOptional = false;
  assert.equal(result.available, true);
  assert.equal(result.main.model, 'gpt-test');
  assert.match(result.errors.auxiliary || '', /HTTP 401/);
  assert.match(result.errors.delegation || '', /HTTP 401/);
  assert.match(result.errors.cron || '', /HTTP 401/);
});

test('Dashboard session token is never sent to a remote base', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  process.env.HERMES_DASHBOARD_BASE = 'https://dashboard.example.test';
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), token: new Headers(init?.headers).get('X-Hermes-Session-Token') });
    return new Response(null, { status: 401 });
  };
  try {
    const { getDashboardModelConfig } = await load();
    const result = await getDashboardModelConfig('default');
    assert.equal(requests.length, 4);
    assert.ok(requests.every((request) => request.url.startsWith('https://dashboard.example.test/') && request.token === null));
    assert.equal(result.available, false);
    assert.ok(Object.values(result.errors).every((error) => /HTTP 401/.test(error)));
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HERMES_DASHBOARD_BASE = `http://127.0.0.1:${server.address().port}`;
  }
});
