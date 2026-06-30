import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { register as registerLoader } from 'node:module';

registerLoader('./route-loader.mjs', import.meta.url);

const configModuleUrl = pathToFileURL(resolve('src/lib/server/hermes/config.ts')).href;
let nonce = 0;

async function loadConfigModule() {
  return import(`${configModuleUrl}?case=${Date.now()}-${nonce++}`);
}

test('config editor saves default MEMORY.md under resolved HERMES_HOME root', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hermesdeck-config-home-'));
  const hermesRoot = join(mkdtempSync(join(tmpdir(), 'hermesdeck-config-root-')), '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'coder'), { recursive: true });

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = `${join(hermesRoot, 'profiles', 'coder')}/`;

    const { readProfileConfig, saveProfileConfigFile } = await loadConfigModule();
    const content = 'remember HERMES_HOME root';
    await saveProfileConfigFile({ profileId: 'default', fileKey: 'memory', content });

    const savedPath = join(hermesRoot, 'memories', 'MEMORY.md');
    assert.equal(readFileSync(savedPath, 'utf8'), content);
    assert.equal(existsSync(join(home, '.hermes', 'memories', 'MEMORY.md')), false);

    const bundle = await readProfileConfig('default');
    assert.equal(bundle.baseDir, hermesRoot);
    assert.equal(bundle.files.find((file) => file.key === 'memory')?.content, content);
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }
});
