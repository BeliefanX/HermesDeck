// Next.js instrumentation hook. Runs once per server process at startup.
//
// Both the Node and Edge runtimes import this file, but Edge has no
// `process.on`. We dynamic-import the Node-only side so the Edge build never
// parses code referring to it.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  await import('./instrumentation-node');
}
