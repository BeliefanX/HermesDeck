import type { TerminalAction, TerminalRunRequest, TerminalRunResult } from '@/lib/types';
import { execFileAsync, redactSecrets } from './core';
import { getHealth } from './health';

type TerminalActionSpec = TerminalAction & {
  build: (req: Required<Pick<TerminalRunRequest, 'profileId'>>) => { file: string; args: string[] } | { synthetic: () => Promise<{ stdout: string; stderr?: string }> };
};

const terminalActions: TerminalActionSpec[] = [
  { id: 'hermes.version', label: 'Hermes version', description: 'Print the active Hermes CLI version.', commandPreview: 'hermes --version', category: 'hermes', maxTimeoutMs: 8000, build: () => ({ file: 'hermes', args: ['--version'] }) },
  { id: 'hermes.profile.list', label: 'List profiles', description: 'List Hermes profiles used for agent / execution-context switching.', commandPreview: 'hermes profile list', category: 'hermes', maxTimeoutMs: 10000, build: () => ({ file: 'hermes', args: ['profile', 'list'] }) },
  { id: 'hermes.profile.show', label: 'Show profile', description: 'Print the configuration summary for the active or selected profile.', commandPreview: 'hermes profile show [profile]', category: 'hermes', profileAware: true, maxTimeoutMs: 10000, build: ({ profileId }) => ({ file: 'hermes', args: profileId && profileId !== 'default' ? ['profile', 'show', profileId] : ['profile', 'show'] }) },
  { id: 'hermes.tools.list', label: 'List tools', description: 'List the toolsets Hermes currently exposes.', commandPreview: 'hermes tools list', category: 'hermes', maxTimeoutMs: 12000, build: () => ({ file: 'hermes', args: ['tools', 'list'] }) },
  { id: 'hermes.skills.list', label: 'List skills', description: 'List Hermes skills (output is truncated to a safe length).', commandPreview: 'hermes skills list', category: 'hermes', maxTimeoutMs: 12000, build: () => ({ file: 'hermes', args: ['skills', 'list'] }) },
  { id: 'system.cwd', label: 'Process snapshot', description: 'Show the HermesDeck server working directory and Node runtime info.', commandPreview: 'node process snapshot', category: 'system', maxTimeoutMs: 3000, build: () => ({ synthetic: async () => ({ stdout: JSON.stringify({ cwd: process.cwd(), node: process.version, platform: process.platform, pid: process.pid, uptimeSeconds: Math.round(process.uptime()) }, null, 2) }) }) },
  { id: 'diagnostic.health', label: 'Deck health check', description: 'Run the HermesDeck BFF health check, including API Server / Dashboard probes.', commandPreview: 'HermesDeck health snapshot', category: 'diagnostic', maxTimeoutMs: 5000, build: () => ({ synthetic: async () => ({ stdout: JSON.stringify(await getHealth(), null, 2) }) }) },
];

function clampTimeout(input: unknown, max: number) {
  const n = Number(input || 8000);
  return Math.max(1000, Math.min(Number.isFinite(n) ? n : 8000, max, 15000));
}

function validateProfileId(input: unknown) {
  const id = String(input || 'default');
  if (!/^[\w.-]{1,64}$/.test(id)) throw new Error('Invalid profileId');
  return id;
}

function limitOutput(value: string, max = 64000) {
  if (value.length <= max) return { text: value, truncated: false };
  return { text: value.slice(0, max) + `\n\n[output truncated at ${max} chars]`, truncated: true };
}

export function listTerminalActions(): TerminalAction[] {
  return terminalActions.map(({ build: _build, ...action }) => action);
}

export async function runTerminalAction(body: TerminalRunRequest): Promise<TerminalRunResult> {
  const actionId = String(body?.actionId || '');
  const spec = terminalActions.find((a) => a.id === actionId);
  if (!spec) throw new Error('Unknown terminal action');
  const profileId = validateProfileId(body.profileId);
  const timeout = clampTimeout(body.timeoutMs, spec.maxTimeoutMs);
  const startedAtMs = Date.now();
  let stdout = '';
  let stderr = '';
  let exitCode: number | null = 0;
  let error: string | undefined;
  let timedOut = false;
  try {
    const built = spec.build({ profileId });
    if ('synthetic' in built) {
      const out = await built.synthetic();
      stdout = out.stdout;
      stderr = out.stderr || '';
    } else {
      const result = await execFileAsync(built.file, built.args, { timeout, maxBuffer: 256 * 1024, shell: false, env: { ...process.env, HERMES_PROFILE: profileId } });
      stdout = result.stdout;
      stderr = result.stderr;
    }
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { killed?: boolean; stdout?: string; stderr?: string; signal?: string };
    // execFile rejects on timeout with `killed === true` (signal SIGTERM).
    // We must NOT treat a timeout as a successful "exitCode === null" — the
    // user needs to see that the command was cut short.
    timedOut = err.killed === true || err.signal === 'SIGTERM';
    exitCode = typeof err.code === 'number' ? err.code : null;
    stdout = err.stdout || '';
    stderr = err.stderr || '';
    error = e instanceof Error ? e.message : String(e);
  }
  const out = limitOutput(redactSecrets(stdout));
  const err = limitOutput(redactSecrets(stderr));
  return {
    ok: !error && !timedOut && exitCode === 0,
    actionId: spec.id,
    label: spec.label,
    commandPreview: spec.commandPreview,
    startedAt: startedAtMs,
    durationMs: Date.now() - startedAtMs,
    exitCode,
    stdout: out.text,
    stderr: err.text,
    truncated: out.truncated || err.truncated,
    error: error ? redactSecrets(error) : undefined,
  };
}
