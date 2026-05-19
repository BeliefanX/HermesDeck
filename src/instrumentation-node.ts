export {}; // mark this file as a module so TS-with-isolatedModules accepts it
// Node-runtime instrumentation: install global error handlers so a single
// uncaught error in a fire-and-forget path (SSE pump, child-process callback,
// background reaper) doesn't tear the dev/prod node process down.
//
// Node's default since v15 is to exit on `unhandledRejection` and to abort
// on `uncaughtException`. HermesDeck has many code paths that emit benign
// errors after a client disconnect (EPIPE / ERR_STREAM_PREMATURE_CLOSE on a
// closed SSE controller, AbortError when a fetch is cancelled). These should
// log, not crash.

const isBenign = (err: unknown): boolean => {
  const e = err as { code?: string; name?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === 'EPIPE' || e.code === 'ECONNRESET' || e.code === 'ERR_STREAM_PREMATURE_CLOSE') return true;
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  if (typeof e.message === 'string' && /Controller is already closed|aborted|invalid state/i.test(e.message)) return true;
  return false;
};

// Guard against duplicate registration during HMR — Next dev re-evaluates
// instrumentation modules. We tag the listeners so we can detect prior
// installs by name.
type Tagged = ((...args: unknown[]) => void) & { __hermesdeck?: true };

function installOnce(event: 'unhandledRejection' | 'uncaughtException' | 'warning', handler: Tagged) {
  for (const existing of process.listeners(event)) {
    if ((existing as Tagged).__hermesdeck) return;
  }
  handler.__hermesdeck = true;
  process.on(event, handler);
}

installOnce('unhandledRejection', ((reason: unknown) => {
  if (isBenign(reason)) {
    const m = reason instanceof Error ? reason.message : String(reason);
    console.warn('[hermesdeck] benign unhandledRejection swallowed:', m.slice(0, 200));
    return;
  }
  console.error('[hermesdeck] unhandledRejection:', reason);
}) as Tagged);

installOnce('uncaughtException', ((err: Error) => {
  if (isBenign(err)) {
    console.warn('[hermesdeck] benign uncaughtException swallowed:', err.message.slice(0, 200));
    return;
  }
  console.error('[hermesdeck] uncaughtException:', err);
}) as Tagged);

// Surface node-pty warnings explicitly — silent native binding failures used
// to surface as a delayed crash when the live terminal first spawned.
installOnce('warning', ((w: Error) => {
  if (/node-pty/i.test(String(w?.message ?? ''))) {
    console.warn('[hermesdeck] node-pty warning:', w.message);
  }
}) as Tagged);
