import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const cronPath = resolve('src/lib/server/hermes/cron.ts');
const attachmentsPath = resolve('src/lib/server/hermes/attachments.ts');
let nonce = 0;

async function loadTranspiled(path) {
  const source = readFileSync(path, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, verbatimModuleSyntax: true },
  });
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}#${Date.now()}-${nonce++}`);
}

async function loadCronWithDedicatedProof(value) {
  globalThis.__dedicatedProfileRoutingProof = value;
  const source = readFileSync(cronPath, 'utf8')
    .replace(/import \{ hasDedicatedProfileRouting, hermesApiGet \} from '\.\/core';/, 'const hasDedicatedProfileRouting = () => globalThis.__dedicatedProfileRoutingProof; const hermesApiGet = async () => ({});')
    .replace(/import type \{ DeckCronJob \} from '@\/lib\/types';/, '');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, verbatimModuleSyntax: true },
  });
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(outputText)}#${Date.now()}-${nonce++}`);
}

test('cron profileless jobs require dedicated named-profile routing proof', async () => {
  const mod = await loadCronWithDedicatedProof(false);
  assert.equal(mod.assertProfileRoutingConfirmed({ jobs: [{ id: 'job_default' }] }, [{ id: 'job_default' }], 'default'), true);
  assert.equal(mod.assertProfileRoutingConfirmed({ jobs: [] }, [], 'default'), true);
  assert.throws(
    () => mod.assertProfileRoutingConfirmed({ jobs: [{ id: 'job_other', profile_id: 'other' }] }, [{ id: 'job_other', profile_id: 'other' }], 'default'),
    (err) => err?.code === 'cron_profile_mismatch' && err?.status === 403,
  );

  assert.throws(
    () => mod.assertProfileRoutingConfirmed({ jobs: [{ id: 'job_1' }] }, [{ id: 'job_1' }], 'named'),
    (err) => err?.code === 'profile_routing_unavailable' && err?.status === 502,
  );
  assert.throws(
    () => mod.assertProfileRoutingConfirmed({ jobs: [] }, [], 'named'),
    (err) => err?.code === 'profile_routing_unavailable' && err?.status === 502,
  );

  const routed = await loadCronWithDedicatedProof(true);
  assert.equal(routed.assertProfileRoutingConfirmed({ jobs: [{ id: 'job_1' }] }, [{ id: 'job_1' }], 'named'), true);
  assert.equal(routed.assertProfileRoutingConfirmed({ jobs: [{ id: 'job_1', profile_id: 'named' }] }, [{ id: 'job_1', profile_id: 'named' }], 'named'), false);
  assert.throws(
    () => routed.assertProfileRoutingConfirmed({ jobs: [{ id: 'job_2', profile_id: 'other' }] }, [{ id: 'job_2', profile_id: 'other' }], 'named'),
    (err) => err?.code === 'cron_profile_mismatch' && err?.status === 403,
  );
  assert.throws(
    () => routed.assertProfileRoutingConfirmed({ profile: 'other', jobs: [] }, [], 'named'),
    (err) => err?.code === 'cron_profile_mismatch' && err?.status === 403,
  );
});

test('image attachment prompts retain a text hint without sending /v1/responses multimodal parts to /v1/runs', async () => {
  const source = readFileSync(resolve('src/lib/server/hermes/chat-stream.ts'), 'utf8');
  const bodyBuild = source.slice(source.indexOf('const inputForApi'), source.indexOf('const apiBody'));
  assert.match(bodyBuild, /hasImages \? String\(enrichedMessage\) : enrichedMessage/);
  assert.doesNotMatch(bodyBuild, /input_image|image_url/);

  const { buildPromptWithAttachments } = await loadTranspiled(attachmentsPath);
  const prompt = buildPromptWithAttachments('what is this?', [{
    kind: 'image',
    name: 'photo.png',
    mime: 'image/png',
    size: 1536,
    dataUrl: 'data:image/png;base64,AAAA',
  }]);
  assert.match(prompt, /Attached image: photo\.png \(image\/png, 1\.5 KB\)/);
  assert.match(prompt, /what is this\?/);
});