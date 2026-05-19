/**
 * Allow access to the dev server from LAN origins (phones, other devices).
 * Without this, Next 15+ blocks cross-origin dev assets and the page silently
 * fails to hydrate — the UI loads but API calls never fire, looking like
 * "everything is disconnected".
 *
 * Auto-discovers every non-loopback IPv4 on the host so a phone joining the
 * same Wi-Fi can hit the dev server without any manual edit. Operators can
 * still override / extend via DECK_DEV_ORIGINS.
 */
const os = require('os');
function discoverLanHosts() {
  const out = new Set();
  try {
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
      if (!list) continue;
      for (const ni of list) {
        if (!ni.internal && (ni.family === 'IPv4' || ni.family === 4)) out.add(ni.address);
      }
    }
  } catch {}
  return Array.from(out);
}
const devOriginsEnv = process.env.DECK_DEV_ORIGINS;
const baseOrigins = devOriginsEnv
  ? devOriginsEnv.split(',').map((s) => s.trim()).filter(Boolean)
  : ['localhost', '127.0.0.1', '0.0.0.0'];
const devOrigins = Array.from(new Set([...baseOrigins, ...discoverLanHosts(), '*.local']));

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

module.exports = {
  reactStrictMode: true,
  devIndicators: false,
  // Keep pdf-parse / mammoth out of the client bundle and let them resolve as
  // CJS at runtime on the server. They pull in fs/path/buffer and would break
  // bundling otherwise.
  serverExternalPackages: ['pdf-parse', 'mammoth'],
  // Note: Next 16 stabilized Node-runtime middleware; the auth proxy declares
  // `export const runtime = 'nodejs'` directly, so we no longer need the
  // experimental.nodeMiddleware flag (which was removed/renamed).
  allowedDevOrigins: devOrigins,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
    ];
  },
};
