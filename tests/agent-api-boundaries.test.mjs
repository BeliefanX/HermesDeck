import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = {
  runStatus: 'src/app/api/deck/chat/runs/[runId]/route.ts',
  runStop: 'src/app/api/deck/chat/runs/[runId]/stop/route.ts',
  cronDetail: 'src/app/api/deck/cron/[jobId]/route.ts',
  sessionFork: 'src/app/api/deck/sessions/[id]/fork/route.ts',
};

test('new Agent control routes keep server-side proof before upstream calls', () => {
  const runStatus = readFileSync(files.runStatus, 'utf8');
  assert.match(runStatus, /hasProjectedRun/);
  assert.match(runStatus, /requireProfileAccess/);
  assert.match(runStatus, /hermesApiGet<unknown>\(`\/v1\/runs/);

  const runStop = readFileSync(files.runStop, 'utf8');
  assert.match(runStop, /guardMutating/);
  assert.match(runStop, /guardRequestBody/);
  assert.match(runStop, /hasProjectedRun/);
  assert.match(runStop, /\/v1\/runs\/\$\{encodeURIComponent\(runId\)\}\/stop/);

  const cronDetail = readFileSync(files.cronDetail, 'utf8');
  assert.match(cronDetail, /isAdminRole/);
  assert.match(cronDetail, /getCronJobs\(\[profile\]\)/);
  assert.match(cronDetail, /guardMutating/);

  const fork = readFileSync(files.sessionFork, 'utf8');
  assert.match(fork, /assertSessionBelongsToProfile/);
  assert.match(fork, /requireProfileAccess/);
  assert.match(fork, /\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/fork/);
});
