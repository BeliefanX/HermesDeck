// Shared (client + server) descriptors and pure helpers for the Hermes
// per-profile configuration files surfaced on the /config page:
//
//   config.yaml   — agent config (YAML).            <home>/config.yaml
//   SOUL.md       — agent identity / persona.        <home>/SOUL.md
//   USER.md       — curated "who the user is".       <home>/memories/USER.md
//   MEMORY.md     — agent's curated personal notes.  <home>/memories/MEMORY.md
//
// where <home> is `~/.hermes` for the `default` profile and
// `~/.hermes/profiles/<id>` for every named profile.
//
// Character budgets enforced by Hermes (mirrored here so the deck can show a
// live count / limit / percentage and validate on save):
//   SOUL.md   — CONTEXT_FILE_MAX_CHARS = 20000 (truncated head+tail past it).
//   USER.md   — config.yaml `memory.user_char_limit`   (default 1375).
//   MEMORY.md — config.yaml `memory.memory_char_limit` (default 2200).
// config.yaml itself has no character budget.

export type ConfigFileKey = 'config' | 'soul' | 'user' | 'memory';
export type ConfigFileKind = 'yaml' | 'markdown' | 'memory';

/** Hermes truncates SOUL.md past this many characters (agent/prompt_builder.py). */
export const SOUL_CHAR_LIMIT = 20_000;
/** config.yaml `memory.memory_char_limit` default (hermes_cli/config.py). */
export const DEFAULT_MEMORY_CHAR_LIMIT = 2_200;
/** config.yaml `memory.user_char_limit` default. */
export const DEFAULT_USER_CHAR_LIMIT = 1_375;

/** Entry separator used inside USER.md / MEMORY.md (tools/memory_tool.py). */
export const MEMORY_ENTRY_DELIMITER = '\n§\n';

export interface ConfigFileMeta {
  key: ConfigFileKey;
  /** On-disk filename. */
  filename: string;
  /** Sub-directory under the profile home ('' or 'memories'). */
  subdir: string;
  kind: ConfigFileKind;
  /** Whether Hermes enforces a character budget on this file. */
  hasLimit: boolean;
}

export const CONFIG_FILE_META: readonly ConfigFileMeta[] = [
  { key: 'config', filename: 'config.yaml', subdir: '',         kind: 'yaml',     hasLimit: false },
  { key: 'soul',   filename: 'SOUL.md',     subdir: '',         kind: 'markdown', hasLimit: true  },
  { key: 'user',   filename: 'USER.md',     subdir: 'memories', kind: 'memory',   hasLimit: true  },
  { key: 'memory', filename: 'MEMORY.md',   subdir: 'memories', kind: 'memory',   hasLimit: true  },
];

export function configFileMeta(key: ConfigFileKey): ConfigFileMeta {
  const meta = CONFIG_FILE_META.find((m) => m.key === key);
  if (!meta) throw new Error(`unknown_config_file:${String(key)}`);
  return meta;
}

/** Per-file shape returned by GET /api/deck/config. */
export interface DeckConfigFile {
  key: ConfigFileKey;
  filename: string;
  /** Display-only path, e.g. `~/.hermes/memories/USER.md`. */
  displayPath: string;
  kind: ConfigFileKind;
  exists: boolean;
  content: string;
  /** Byte size on disk (0 when absent). */
  size: number;
  /** ISO mtime, '' when absent. Doubles as an optimistic-lock token on save. */
  mtime: string;
  /** Character count measured the way Hermes measures it. */
  charCount: number;
  /** Hermes-enforced character budget; null when the file has none. */
  charLimit: number | null;
  /** True when the file is not owner-writable on disk (informational). */
  readOnly: boolean;
}

export interface DeckConfigBundle {
  profile: string;
  /** Display path of the profile's Hermes home. */
  baseDir: string;
  files: DeckConfigFile[];
}

export interface SaveConfigResult {
  ok: true;
  key: ConfigFileKey;
  mtime: string;
  size: number;
  charCount: number;
  charLimit: number | null;
  /** Set when YAML validation could not run (validator unavailable). */
  validationSkipped?: boolean;
}

/**
 * Count characters in a USER.md / MEMORY.md the way Hermes' MemoryStore does:
 * split on the entry delimiter, strip each entry, drop empties, de-duplicate,
 * then measure the re-joined string. Code points (not UTF-16 units) so the
 * count matches Python's `len()` for CJK / emoji content.
 */
export function countMemoryChars(raw: string): number {
  const entries = raw
    .split(MEMORY_ENTRY_DELIMITER)
    .map((e) => e.trim())
    .filter(Boolean);
  const deduped = [...new Set(entries)];
  return [...deduped.join(MEMORY_ENTRY_DELIMITER)].length;
}

/** Character count for a given config file, matching Hermes' own measurement. */
export function countConfigChars(key: ConfigFileKey, raw: string): number {
  if (key === 'user' || key === 'memory') return countMemoryChars(raw);
  // SOUL.md is measured after a strip(); config.yaml is informational only.
  if (key === 'soul') return [...raw.trim()].length;
  return [...raw].length;
}

/**
 * Extract `memory.user_char_limit` / `memory.memory_char_limit` from a
 * config.yaml body via a small block scan — enough for Hermes' stable
 * block-style output, and it falls back to the documented defaults otherwise.
 */
export function parseMemoryLimits(configYaml: string): { user: number; memory: number } {
  const out = { user: DEFAULT_USER_CHAR_LIMIT, memory: DEFAULT_MEMORY_CHAR_LIMIT };
  let inMemoryBlock = false;
  for (const line of configYaml.split(/\r?\n/)) {
    if (/^memory:\s*(#.*)?$/.test(line)) { inMemoryBlock = true; continue; }
    if (!inMemoryBlock) continue;
    // A non-blank, non-indented line ends the `memory:` block.
    if (line.trim() && !/^\s/.test(line)) break;
    const mem = line.match(/^\s+memory_char_limit:\s*(\d+)/);
    if (mem) out.memory = Number.parseInt(mem[1]!, 10);
    const usr = line.match(/^\s+user_char_limit:\s*(\d+)/);
    if (usr) out.user = Number.parseInt(usr[1]!, 10);
  }
  return out;
}

/** Resolve the enforced character budget for a file given a config.yaml body. */
export function charLimitFor(key: ConfigFileKey, configYaml: string): number | null {
  if (key === 'soul') return SOUL_CHAR_LIMIT;
  if (key === 'user') return parseMemoryLimits(configYaml).user;
  if (key === 'memory') return parseMemoryLimits(configYaml).memory;
  return null;
}
