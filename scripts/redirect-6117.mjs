#!/usr/bin/env node
// Tiny HTTP reverse proxy that keeps the legacy HermesDeck LAN origin on :6117
// while the canonical Next.js process listens on :6118. PWA installs and phone
// bookmarks often lock to host:6117; redirecting them to :6118 changes origin
// and can make LAN access look broken. Proxying preserves the visible origin.
//
// We don't trust X-Forwarded-Host — this is a LAN-local helper. The original
// Host header is forwarded so Next.js sees the same origin the browser used.

import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';

const FROM_PORT = Number(process.env.LEGACY_PORT || 6117);
const TO_PORT = Number(process.env.CANONICAL_PORT || 6118);
const TARGET_HOST = process.env.CANONICAL_HOST || '127.0.0.1';

const server = createServer((req, res) => {
  const headers = { ...req.headers };
  // Node will set the socket target separately; preserve browser-facing Host.
  const upstream = httpRequest({
    host: TARGET_HOST,
    port: TO_PORT,
    method: req.method,
    path: req.url || '/',
    headers,
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage || undefined, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    res.end(`HermesDeck upstream :${TO_PORT} unavailable: ${err.message}\n`);
  });

  req.pipe(upstream);
});

// Best-effort WebSocket/upgrade support. HermesDeck mostly uses normal HTTP/SSE,
// but this keeps the helper transparent if Next.js adds upgraded connections.
server.on('upgrade', (req, socket, head) => {
  const upstream = connect(TO_PORT, TARGET_HOST, () => {
    upstream.write(`${req.method} ${req.url || '/'} HTTP/${req.httpVersion}\r\n`);
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) upstream.write(`${name}: ${v}\r\n`);
      } else if (value !== undefined) {
        upstream.write(`${name}: ${value}\r\n`);
      }
    }
    upstream.write('\r\n');
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
});

server.on('error', (err) => {
  // EADDRINUSE: someone is already on 6117. We don't kill them — could be the
  // user's old next dev — but we exit non-zero so the parent/CI status is not
  // silently green when the legacy proxy is unavailable.
  if (err && err.code === 'EADDRINUSE') {
    console.warn(`[redirect-6117] WARNING: :${FROM_PORT} already in use; proxy helper not started.`);
    process.exit(1);
  }
  console.error('[redirect-6117] error:', err);
  process.exit(1);
});

server.listen(FROM_PORT, '0.0.0.0', () => {
  console.log(`[redirect-6117] :${FROM_PORT} ⇄ ${TARGET_HOST}:${TO_PORT} (LAN-wide reverse proxy).`);
});

// Best-effort cleanup on signal so a parent restart can rebind.
const shutdown = () => { try { server.close(); } catch {} process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
