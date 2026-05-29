#!/usr/bin/env node
// Tiny HTTP server that listens on the legacy HermesDeck port (6117) and 301-
// redirects every request to the canonical port (6118). PWA installs from the
// previous default lock their origin to host:6117; without this redirect those
// installs would white-screen forever (nothing on 6117).
//
// We don't trust X-Forwarded-Host — this is a LAN-local helper. The Host header
// from the request is stripped of any explicit port and rewritten to 6118.

import { createServer } from 'node:http';

const FROM_PORT = Number(process.env.LEGACY_PORT || 6117);
const TO_PORT = Number(process.env.CANONICAL_PORT || 6118);

const server = createServer((req, res) => {
  const hostHeader = req.headers.host || '';
  // Strip the port from the incoming host (everything after the last ":").
  const hostNoPort = hostHeader.replace(/:\d+$/, '') || 'localhost';
  const target = `http://${hostNoPort}:${TO_PORT}${req.url || '/'}`;
  res.writeHead(301, {
    Location: target,
    'Cache-Control': 'no-store',
  });
  res.end(`Moved Permanently → ${target}\n`);
});

server.on('error', (err) => {
  // EADDRINUSE: someone is already on 6117. We don't kill them — could be the
  // user's old next dev — but we exit non-zero so the parent/CI status is not
  // silently green when the legacy redirect is unavailable.
  if (err && err.code === 'EADDRINUSE') {
    console.warn(`[redirect-6117] WARNING: :${FROM_PORT} already in use; redirect helper not started.`);
    process.exit(1);
  }
  console.error('[redirect-6117] error:', err);
  process.exit(1);
});

server.listen(FROM_PORT, '0.0.0.0', () => {
  console.log(`[redirect-6117] :${FROM_PORT} → :${TO_PORT} (LAN-wide).`);
});

// Best-effort cleanup on signal so a parent restart can rebind.
const shutdown = () => { try { server.close(); } catch {} process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
