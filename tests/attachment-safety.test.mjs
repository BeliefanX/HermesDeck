import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const safeLinksUrl = pathToFileURL(resolve('src/lib/safe-links.ts')).href;
const storageUrl = pathToFileURL(resolve('src/app/chat/_lib/storage.ts')).href;
const {
  safeAttachmentDownloadUrl,
  safeAttachmentImageUrl,
} = await import(`${safeLinksUrl}?case=${Date.now()}`);
const {
  redactPersistedChatMessages,
} = await import(`${storageUrl}?case=${Date.now()}`);

test('attachment URL sanitizer permits image-safe URLs and blocks active/local URLs', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(safeAttachmentImageUrl(png), png);
  assert.equal(safeAttachmentDownloadUrl(png), png);
  assert.equal(safeAttachmentImageUrl('blob:https://example.com/id'), 'blob:https://example.com/id');
  assert.equal(safeAttachmentImageUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png');
  assert.equal(safeAttachmentImageUrl('/artifacts/a.png'), '/artifacts/a.png');

  assert.equal(safeAttachmentImageUrl('javascript:alert(1)'), null);
  assert.equal(safeAttachmentDownloadUrl('javascript:alert(1)'), null);
  assert.equal(safeAttachmentImageUrl('file:///Users/fanxuxin/.hermes/cache/images/a.png'), null);
  assert.equal(safeAttachmentDownloadUrl('/Users/fanxuxin/.hermes/cache/images/a.png'), null);
  assert.equal(safeAttachmentImageUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeAttachmentDownloadUrl('data:text/html,<script>alert(1)</script>'), null);
});

test('attachment download sanitizer blocks app API routes while image sanitizer only permits cache-image proxy', () => {
  assert.equal(safeAttachmentImageUrl('/api/deck/cache-image?path=%2FUsers%2Fme%2Fx.png'), '/api/deck/cache-image?path=%2FUsers%2Fme%2Fx.png');
  assert.equal(safeAttachmentDownloadUrl('/api/deck/cache-image?path=%2FUsers%2Fme%2Fx.png'), null);
  assert.equal(safeAttachmentImageUrl('/api/deck/auth/session'), null);
  assert.equal(safeAttachmentDownloadUrl('/api/deck/auth/session'), null);
});

test('persisted chat message redaction strips attachment bodies from localStorage snapshots', () => {
  const messages = {
    s1: [
      {
        id: 'm1',
        role: 'user',
        content: 'see attached',
        attachments: [
          {
            id: 'a1',
            name: 'secret.png',
            mime: 'image/png',
            size: 123,
            kind: 'image',
            dataUrl: 'data:image/png;base64,SECRET_BASE64',
            url: 'https://cdn.example.com/private-secret.png',
          },
          {
            id: 'a2',
            name: 'paste.txt',
            mime: 'text/plain',
            size: 42,
            kind: 'text',
            text: 'PASTED SECRET TEXT',
          },
        ],
      },
    ],
  };

  const redacted = redactPersistedChatMessages(messages);
  const snapshot = JSON.stringify({ messages: redacted });

  assert.equal(snapshot.includes('SECRET_BASE64'), false);
  assert.equal(snapshot.includes('PASTED SECRET TEXT'), false);
  assert.equal(snapshot.includes('private-secret.png'), false);
  assert.equal(redacted.s1[0].attachments[0].name, 'secret.png');
  assert.equal(redacted.s1[0].attachments[0].mime, 'image/png');
  assert.equal(redacted.s1[0].attachments[0].kind, 'image');
  assert.equal('dataUrl' in redacted.s1[0].attachments[0], false);
  assert.equal('url' in redacted.s1[0].attachments[0], false);
  assert.equal('text' in redacted.s1[0].attachments[1], false);
});
