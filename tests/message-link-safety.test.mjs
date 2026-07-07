import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const moduleUrl = pathToFileURL(resolve('src/lib/safe-links.ts')).href;
const { safeMarkdownHref } = await import(`${moduleUrl}?case=${Date.now()}`);

test('safeMarkdownHref permits normal web links and app-relative chat deep links', () => {
  assert.equal(safeMarkdownHref('https://example.com/path?q=1'), 'https://example.com/path?q=1');
  assert.equal(safeMarkdownHref('http://example.com'), 'http://example.com');
  assert.equal(safeMarkdownHref('mailto:kevin@example.com'), 'mailto:kevin@example.com');
  assert.equal(safeMarkdownHref('/chat?session=sensgift-owned'), '/chat?session=sensgift-owned');
  assert.equal(safeMarkdownHref('docs/abc'), 'docs/abc');
  assert.equal(safeMarkdownHref('#section'), '#section');
});

test('safeMarkdownHref blocks links that can navigate the PWA to unsupported/local pages', () => {
  assert.equal(safeMarkdownHref('/Users/fanxuxin/.hermes/cache/images/a.png'), null);
  assert.equal(safeMarkdownHref('/home/kevin/secret.txt'), null);
  assert.equal(safeMarkdownHref('/private/tmp/artifact.txt'), null);
  assert.equal(safeMarkdownHref('file:///Users/fanxuxin/.hermes/cache/images/a.png'), null);
  assert.equal(safeMarkdownHref('javascript:alert(1)'), null);
  assert.equal(safeMarkdownHref('data:text/html,<h1>x</h1>'), null);
  assert.equal(safeMarkdownHref('/api/deck/auth/session'), null);
});
