/**
 * Allow access to the dev server from LAN origins (phones, other devices).
 * Without this, Next 15+ blocks cross-origin dev assets and the page silently
 * fails to hydrate — the UI loads but API calls never fire, looking like
 * "everything is disconnected".
 */
module.exports = {
  reactStrictMode: true,
  // Keep pdf-parse / mammoth out of the client bundle and let them resolve as
  // CJS at runtime on the server. They pull in fs/path/buffer and would break
  // bundling otherwise.
  serverExternalPackages: ['pdf-parse', 'mammoth'],
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '10.10.10.253',
    '10.10.10.120',
    '198.18.0.1',
    '*.local',
  ],
};
