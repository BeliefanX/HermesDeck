import type { TerminalAction, TerminalRunRequest, TerminalRunResult } from '@/lib/types';
import { execFileAsync, redactSecrets } from './core';
import { getHealth, hermesVersion } from './health';
import { getProfiles } from './profiles';

type BuiltTerminalAction = { file: string; args: string[] } | { synthetic: () => Promise<{ stdout: string; stderr?: string }> };
type TerminalActionSpec = TerminalAction & {
  localOnly?: boolean;
  build: (req: Required<Pick<TerminalRunRequest, 'profileId'>>) => BuiltTerminalAction;
};

const apiTerminalActions: TerminalActionSpec[] = [
  { id: 'diagnostic.health', label: 'Deck health check', description: 'Run the HermesDeck BFF health check against the Hermes Agent API.', commandPreview: 'Hermes Agent API health snapshot', category: 'diagnostic', maxTimeoutMs: 5000, build: () => ({ synthetic: async () => ({ stdout: JSON.stringify(await getHealth(), null, 2) }) }) },
  { id: 'hermes.api.version', label: 'Hermes API version', description: 'Read Hermes Agent version information from the configured API.', commandPreview: 'Hermes Agent API /health', category: 'hermes', maxTimeoutMs: 5000, build: () => ({ synthetic: async () => ({ stdout: `${await hermesVersion()}\n` }) }) },
  { id: 'hermes.api.profiles', label: 'List profiles', description: 'List Hermes profiles from the Hermes Agent profiles API.', commandPreview: 'Hermes Agent API profiles', category: 'hermes', maxTimeoutMs: 8000, build: () => ({ synthetic: async () => ({ stdout: JSON.stringify({ profiles: await getProfiles() }, null, 2) }) }) },
];

const localDiagnosticActions: TerminalActionSpec[] = [
  { id: 'hermes.version', label: 'Hermes CLI version', description: 'Developer-only local Hermes CLI version diagnostic.', commandPreview: 'hermes --version', category: 'hermes', localOnly: true, maxTimeoutMs: 8000, build: () => ({ file: 'hermes', args: ['--version'] }) },
  { id: 'hermes.profile.list', label: 'List profiles (CLI)', description: 'Developer-only local Hermes CLI profile listing.', commandPreview: 'hermes profile list', category: 'hermes', localOnly: true, maxTimeoutMs: 10000, build: () => ({ file: 'hermes', args: ['profile', 'list'] }) },
  { id: 'hermes.profile.show', label: 'Show profile (CLI)', description: 'Developer-only local Hermes CLI profile summary.', commandPreview: 'hermes profile show [profile]', category: 'hermes', profileAware: true, localOnly: true, maxTimeoutMs: 10000, build: ({ profileId }) => ({ file: 'hermes', args: profileId && profileId !== 'default' ? ['profile', 'show', profileId] : ['profile', 'show'] }) },
  { id: 'hermes.tools.list', label: 'List tools (CLI)', description: 'Developer-only local Hermes CLI tools listing.', commandPreview: 'hermes tools list', category: 'hermes', localOnly: true, maxTimeoutMs: 12000, build: () => ({ file: 'hermes', args: ['tools', 'list'] }) },
  { id: 'hermes.skills.list', label: 'List skills (CLI)', description: 'Developer-only local Hermes CLI skills listing.', commandPreview: 'hermes skills list', category: 'hermes', localOnly: true, maxTimeoutMs: 12000, build: () => ({ file: 'hermes', args: ['skills', 'list'] }) },
  { id: 'system.cwd', label: 'Process snapshot', description: 'Developer-only HermesDeck server process snapshot.', commandPreview: 'node process snapshot', category: 'system', localOnly: true, maxTimeoutMs: 3000, build: () => ({ synthetic: async () => ({ stdout: JSON.stringify({ cwd: process.cwd(), node: process.version, platform: process.platform, pid: process.pid, uptimeSeconds: Math.round(process.uptime()) }, null, 2) }) }) },
];

function localDiagnosticsEnabled() {
  return process.env.HERMESDECK_LOCAL_DIAGNOSTICS === '1';
}

function availableTerminalActions(): TerminalActionSpec[] {
  return localDiagnosticsEnabled() ? [...apiTerminalActions, ...localDiagnosticActions] : apiTerminalActions;
}

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
  return availableTerminalActions().map(({ build: _build, localOnly: _localOnly, ...action }) => action);
}

export async function runTerminalAction(body: TerminalRunRequest): Promise<TerminalRunResult> {
  const actionId = String(body?.actionId || '');
  const spec = availableTerminalActions().find((a) => a.id === actionId);
  if (!spec) {
    const localSpec = localDiagnosticActions.find((a) => a.id === actionId);
    if (localSpec) throw new Error('Terminal action unavailable: local diagnostics require HERMESDECK_LOCAL_DIAGNOSTICS=1.');
    throw new Error('Unknown terminal action');
  }
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
