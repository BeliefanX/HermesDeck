'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, BrainCircuit, CheckCircle2, Edit3, FileCog, FilePlus2, FileWarning,
  Info, Loader2, RefreshCw, Save, Sparkles, User, X,
} from 'lucide-react';
import { deckApi, ApiError } from '@/lib/api';
import { useActiveProfile } from '@/lib/profile-context';
import { useT } from '@/lib/i18n';
import { relTime } from '@/lib/format';
import { Page, Card, Kicker, SectionHead, Tag, Kbd } from '@/components/Brand';
import {
  type ConfigFileKey, type ConfigFileKind, type DeckConfigBundle, type DeckConfigFile,
  countConfigChars, parseMemoryLimits,
} from '@/lib/config-files';

const FILE_ICON: Record<ConfigFileKey, React.ReactNode> = {
  config: <FileCog size={16} />,
  soul: <Sparkles size={16} />,
  user: <User size={16} />,
  memory: <BrainCircuit size={16} />,
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Tall textarea / preview height per file kind — config.yaml runs long. */
function bodyHeight(kind: ConfigFileKind): number {
  if (kind === 'yaml') return 460;
  if (kind === 'markdown') return 360;
  return 220;
}

export default function ConfigPage() {
  const { activeProfile, profiles, hydrated } = useActiveProfile();
  const [bundle, setBundle] = useState<DeckConfigBundle | null>(null);
  const [selectedKey, setSelectedKey] = useState<ConfigFileKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const t = useT({
    zh: {
      intro: '预览并编辑当前 Agent 的 Hermes 配置文件。默认为只读预览，点击「编辑」进入编辑态；保存时会做格式与长度审查。切换顶栏的 Agent 即可查看其它 Agent 的配置。',
      kicker: '配置文件',
      title: 'Agent 配置',
      home: 'Hermes 配置目录',
      loadFailed: '加载失败：',
      retry: '重试',
      fileList: '文件列表',
      missing: '未创建',
    },
    en: {
      intro: 'Preview and edit the active Agent’s Hermes config files. Read-only by default — click Edit to make changes; saves are format- and length-checked. Switch the Agent in the top bar to inspect another Agent.',
      kicker: 'CONFIG FILES',
      title: 'Agent Config',
      home: 'Hermes home',
      loadFailed: 'Load failed: ',
      retry: 'Retry',
      fileList: 'Files',
      missing: 'Missing',
    },
  });

  useEffect(() => {
    if (!hydrated) return;
    const ac = new AbortController();
    setLoading(true);
    setErr('');
    deckApi.config(activeProfile, ac.signal)
      .then((b) => { if (!ac.signal.aborted) setBundle(b); })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) return;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [activeProfile, hydrated, reloadKey]);

  // When config.yaml is saved its memory budgets can move — patch the
  // USER/MEMORY limits in place so their meters stay correct without a
  // full refetch (which would reset any sibling card mid-edit).
  const handleSaved = useCallback(
    (key: ConfigFileKey, patch: { content: string; mtime: string; size: number; charCount: number }) => {
      setBundle((prev) => {
        if (!prev) return prev;
        let files = prev.files.map((f) =>
          f.key === key
            ? { ...f, content: patch.content, mtime: patch.mtime, size: patch.size, charCount: patch.charCount, exists: true }
            : f,
        );
        if (key === 'config') {
          const lim = parseMemoryLimits(patch.content);
          files = files.map((f) =>
            f.key === 'user' ? { ...f, charLimit: lim.user }
              : f.key === 'memory' ? { ...f, charLimit: lim.memory }
                : f,
          );
        }
        return { ...prev, files };
      });
    },
    [],
  );

  const profileName = profiles.find((p) => p.id === activeProfile)?.name || activeProfile;

  useEffect(() => {
    if (!bundle?.files.length) {
      setSelectedKey(null);
      return;
    }
    setSelectedKey((key) => (key && bundle.files.some((f) => f.key === key) ? key : bundle.files[0].key));
  }, [bundle, activeProfile]);

  const selectedFile = bundle?.files.find((f) => f.key === selectedKey) || bundle?.files[0];

  return (
    <Page intro={t.intro} style={{ flex: 1, minHeight: 0 }}>
      <SectionHead
        kicker={t.kicker}
        title={
          <>
            <FileCog size={15} style={{ color: 'var(--accent)' }} />
            <span>{t.title}</span>
            <Kbd>{activeProfile}</Kbd>
          </>
        }
        right={
          <Tag variant="cyan">{profileName}</Tag>
        }
      />

      <div style={{ marginTop: -6, fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{t.home}</span>
        <Kbd>{bundle?.baseDir || '~/.hermes'}</Kbd>
      </div>

      {err && (
        <Card style={{ borderColor: 'var(--status-red-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--red)' }}>
            <AlertCircle size={15} />
            <span style={{ flex: 1 }}>{t.loadFailed}{err}</span>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              style={miniBtnStyle}
            >
              <RefreshCw size={12} /> {t.retry}
            </button>
          </div>
        </Card>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch', flex: 1, minHeight: 0 }}>
          <Card style={{ flex: '0 0 280px', width: '100%', minWidth: 240, minHeight: 220 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skel" style={{ width: i === 0 ? '80%' : '100%', height: 42, marginTop: i ? 10 : 0 }} />
            ))}
          </Card>
          <Card style={{ flex: '1 1 520px', minWidth: 0, minHeight: 420 }}>
            <div className="skel" style={{ width: 220, height: 18 }} />
            <div style={{ height: 10 }} />
            <div className="skel" style={{ width: '100%', height: 260 }} />
          </Card>
        </div>
      ) : bundle && selectedFile ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch', flex: 1, minHeight: 0 }}>
          <Card padding={0} style={{ flex: '0 0 280px', width: '100%', minWidth: 240, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--hairline)' }}>
              <Kicker>{t.fileList}</Kicker>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', overflow: 'auto', minHeight: 0 }}>
              {bundle.files.map((f) => {
                const selected = f.key === selectedFile.key;
                const over = f.charLimit != null && f.charCount > f.charLimit;
                return (
                  <button
                    key={f.key}
                    type="button"
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => setSelectedKey(f.key)}
                    style={{
                      display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%', textAlign: 'left',
                      padding: '12px 14px', border: 0, borderBottom: '1px solid var(--hairline)', cursor: 'pointer',
                      background: selected ? 'var(--accent-soft, var(--surface-bg))' : 'transparent',
                      color: 'var(--text)',
                    }}
                  >
                    <span style={{ marginTop: 1, color: selected ? 'var(--accent)' : 'var(--muted)' }}>{FILE_ICON[f.key]}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 650, color: 'var(--strong-text)' }}>{f.filename}</span>
                        {!f.exists && <Tag variant="yellow">{t.missing}</Tag>}
                      </span>
                      <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--muted-2)', wordBreak: 'break-all' }}>{f.displayPath}</span>
                      <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: over ? 'var(--red)' : 'var(--muted)' }}>
                        {fmtBytes(f.size)}
                        {f.charLimit != null ? ` · ${f.charCount.toLocaleString()} / ${f.charLimit.toLocaleString()}` : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <div style={{ flex: '1 1 520px', minWidth: 0, display: 'flex', minHeight: 0 }}>
            <ConfigFileCard
              key={`${activeProfile}:${selectedFile.key}`}
              profile={activeProfile}
              file={selectedFile}
              onSaved={handleSaved}
              fill
            />
          </div>
        </div>
      ) : null}
    </Page>
  );
}

type Banner = { tone: 'error' | 'warn' | 'info'; text: string } | null;

function ConfigFileCard({
  profile,
  file,
  onSaved,
  fill = false,
}: {
  profile: string;
  file: DeckConfigFile;
  onSaved: (key: ConfigFileKey, patch: { content: string; mtime: string; size: number; charCount: number }) => void;
  fill?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [content, setContent] = useState(file.content);
  const [draft, setDraft] = useState(file.content);
  const [mtime, setMtime] = useState(file.mtime);
  const [size, setSize] = useState(file.size);
  const [exists, setExists] = useState(file.exists);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [confirmOver, setConfirmOver] = useState(false);
  const [flash, setFlash] = useState(false);

  const t = useT({
    zh: {
      descConfig: 'Agent 配置：模型、Provider、工具集、记忆预算等',
      descSoul: 'Agent 身份与人格 — 系统提示的第 1 槽',
      descUser: '用户档案 — Agent 记住的「你是谁」',
      descMemory: 'Agent 的长期记忆笔记',
      edit: '编辑',
      create: '创建',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      saveAnyway: '仍要保存',
      cancel: '取消',
      reload: '重新加载',
      modified: '修改于 ',
      readOnly: '只读',
      missing: '文件尚不存在',
      missingHint: (n: string) => `点击「创建」以新建 ${n}`,
      usage: '字符用量',
      yamlPrefix: 'YAML 格式错误：',
      lineCol: (l: number, c: number) => `（第 ${l} 行，第 ${c} 列）`,
      conflict: '保存冲突：磁盘上的文件在你打开后已被修改。请重新加载后再试。',
      validationSkipped: '已保存，但无法运行 YAML 校验器（缺少 python/pyyaml），未做格式审查。',
      overSoul: (c: number, l: number) =>
        `SOUL.md 当前 ${c.toLocaleString()} 字符，超过 ${l.toLocaleString()} 上限。超出部分会被 Hermes 截断（保留首尾）。仍要保存？`,
      overMemory: (c: number, l: number) =>
        `当前 ${c.toLocaleString()} 字符，超过 ${l.toLocaleString()} 上限。超限后记忆工具将无法再新增条目。仍要保存？`,
      over: '超出',
    },
    en: {
      descConfig: 'Agent config: model, providers, toolsets, memory budgets…',
      descSoul: 'Agent identity & persona — system-prompt slot #1',
      descUser: 'User profile — who you are, as the agent remembers it',
      descMemory: 'The agent’s long-term memory notes',
      edit: 'Edit',
      create: 'Create',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      saveAnyway: 'Save anyway',
      cancel: 'Cancel',
      reload: 'Reload',
      modified: 'modified ',
      readOnly: 'read-only',
      missing: 'File does not exist yet',
      missingHint: (n: string) => `Click Create to add ${n}`,
      usage: 'CHARACTER USAGE',
      yamlPrefix: 'YAML error: ',
      lineCol: (l: number, c: number) => ` (line ${l}, col ${c})`,
      conflict: 'Save conflict: the file changed on disk since you opened it. Reload and try again.',
      validationSkipped: 'Saved, but the YAML validator (python/pyyaml) was unavailable — format not checked.',
      overSoul: (c: number, l: number) =>
        `SOUL.md is ${c.toLocaleString()} chars, over the ${l.toLocaleString()} limit. Hermes truncates the overflow (keeps head + tail). Save anyway?`,
      overMemory: (c: number, l: number) =>
        `${c.toLocaleString()} chars, over the ${l.toLocaleString()} limit. Past the limit the memory tool can no longer add entries. Save anyway?`,
      over: 'over',
    },
  });

  const desc =
    file.key === 'config' ? t.descConfig
      : file.key === 'soul' ? t.descSoul
        : file.key === 'user' ? t.descUser
          : t.descMemory;

  const live = mode === 'edit' ? draft : content;
  const count = countConfigChars(file.key, live);
  const limit = file.charLimit;
  const overLimit = limit != null && count > limit;
  const dirty = draft !== content;

  const enterEdit = () => {
    setBanner(null);
    setConfirmOver(false);
    setMode('edit');
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const cancelEdit = () => {
    setDraft(content);
    setMode('view');
    setBanner(null);
    setConfirmOver(false);
  };

  const handleSave = useCallback(async () => {
    if (saving || !dirty) return;
    // Length gate for budgeted files — warn once, then let the user confirm.
    if (overLimit && limit != null && !confirmOver) {
      setBanner({
        tone: 'warn',
        text: file.key === 'soul' ? t.overSoul(count, limit) : t.overMemory(count, limit),
      });
      setConfirmOver(true);
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      const res = await deckApi.configSave(profile, file.key, draft, mtime || undefined);
      setContent(draft);
      setMtime(res.mtime);
      setSize(res.size);
      setExists(true);
      setMode('view');
      setConfirmOver(false);
      setFlash(true);
      onSaved(file.key, { content: draft, mtime: res.mtime, size: res.size, charCount: res.charCount });
      if (res.validationSkipped) setBanner({ tone: 'info', text: t.validationSkipped });
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const body = e.body as { detail?: string; line?: number; col?: number } | undefined;
        const loc = body?.line ? t.lineCol(body.line, body.col || 0) : '';
        setBanner({ tone: 'error', text: `${t.yamlPrefix}${body?.detail || e.message}${loc}` });
      } else if (e instanceof ApiError && e.status === 409) {
        setBanner({ tone: 'error', text: t.conflict });
      } else {
        setBanner({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, dirty, overLimit, limit, confirmOver, count, draft, mtime, profile, file.key]);

  // Cmd/Ctrl-S saves the card currently being edited.
  useEffect(() => {
    if (mode !== 'edit') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, handleSave]);

  // Clear the "Saved" flash after 2s.
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(false), 2000);
    return () => clearTimeout(id);
  }, [flash]);

  const editing = mode === 'edit';
  const h = bodyHeight(file.kind);

  return (
    <Card padding={0} style={fill ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--hairline)', flexShrink: 0 }}>
        <span
          style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: 'var(--surface-bg)', border: '1px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)',
          }}
        >
          {FILE_ICON[file.key]}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 650, color: 'var(--strong-text)', fontFamily: 'var(--font-mono)' }}>
              {file.filename}
            </span>
            <Tag variant={file.kind === 'yaml' ? 'cyan' : 'default'}>{file.kind}</Tag>
            {!exists && <Tag variant="yellow">new</Tag>}
            {file.readOnly && <Tag variant="yellow">{t.readOnly}</Tag>}
            {flash && <Tag variant="green" icon={<CheckCircle2 size={10} />}>{t.saved}</Tag>}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>{desc}</div>
          <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 3, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
            {file.displayPath}
            {exists && (
              <>
                <span> · {fmtBytes(size)}</span>
                {mtime && <span> · {t.modified}{relTime(mtime)}</span>}
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {!editing ? (
            <button type="button" onClick={enterEdit} style={btnStyle(true)}>
              {exists ? <Edit3 size={13} /> : <FilePlus2 size={13} />}
              {exists ? t.edit : t.create}
            </button>
          ) : (
            <>
              <button type="button" onClick={cancelEdit} disabled={saving} style={btnStyle(false)}>
                <X size={13} /> {t.cancel}
              </button>
              <button type="button" onClick={() => void handleSave()} disabled={saving || !dirty} style={btnStyle(true)}>
                {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
                {saving ? t.saving : (confirmOver ? t.saveAnyway : t.save)}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Character-usage meter — SOUL.md / USER.md / MEMORY.md only */}
      {limit != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--hairline)', flexShrink: 0 }}>
          <Kicker style={{ flexShrink: 0 }}>{t.usage}</Kicker>
          <CharMeter count={count} limit={limit} overLabel={t.over} />
        </div>
      )}

      {/* Inline banner */}
      {banner && (
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 16px', flexShrink: 0,
            borderBottom: '1px solid var(--hairline)', fontSize: 12,
            background:
              banner.tone === 'error' ? 'var(--status-red-bg)'
                : banner.tone === 'warn' ? 'var(--status-yellow-bg)'
                  : 'var(--status-cyan-bg)',
            color:
              banner.tone === 'error' ? 'var(--red)'
                : banner.tone === 'warn' ? 'var(--yellow)'
                  : 'var(--cyan)',
          }}
        >
          {banner.tone === 'info' ? <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            : <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span style={{ flex: 1, lineHeight: 1.5 }}>{banner.text}</span>
        </div>
      )}

      {/* Body */}
      <div style={{ padding: editing ? 0 : 0, flex: fill ? 1 : undefined, minHeight: fill ? 0 : undefined, display: fill ? 'flex' : undefined }}>
        {editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (confirmOver) setConfirmOver(false);
              if (banner?.tone === 'warn') setBanner(null);
            }}
            spellCheck={false}
            style={{
              display: 'block', width: '100%', height: fill ? '100%' : h, minHeight: fill ? h : undefined, resize: fill ? 'none' : 'vertical', flex: fill ? 1 : undefined,
              background: 'var(--bg-soft)', color: 'var(--text)', border: 'none', outline: 'none',
              padding: 16, fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.6, tabSize: 2,
              boxSizing: 'border-box',
            }}
          />
        ) : !exists ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', flex: fill ? 1 : undefined, width: '100%', boxSizing: 'border-box' }}>
            <FileWarning size={20} style={{ color: 'var(--muted-2)' }} />
            <div style={{ fontSize: 13, marginTop: 8 }}>{t.missing}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 2 }}>{t.missingHint(file.filename)}</div>
          </div>
        ) : content.trim() === '' ? (
          <div style={{ padding: 24, color: 'var(--muted-2)', fontSize: 12, fontStyle: 'italic', flex: fill ? 1 : undefined, width: '100%', boxSizing: 'border-box' }}>—</div>
        ) : (
          <pre
            style={{
              margin: 0, height: fill ? '100%' : undefined, minHeight: fill ? h : undefined, maxHeight: fill ? 'none' : h, overflow: 'auto', padding: 16, flex: fill ? 1 : undefined,
              background: 'var(--bg-soft)', color: 'var(--text)',
              fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.6, tabSize: 2,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          >
            {content}
          </pre>
        )}
      </div>
    </Card>
  );
}

function CharMeter({ count, limit, overLabel }: { count: number; limit: number; overLabel: string }) {
  const pct = limit > 0 ? (count / limit) * 100 : 0;
  const over = count > limit;
  const near = !over && pct >= 75;
  const color = over ? 'var(--red)' : near ? 'var(--yellow)' : 'var(--accent)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--surface-bg)', borderRadius: 3, overflow: 'hidden', minWidth: 60 }}>
        <div
          style={{
            height: '100%', width: `${Math.min(100, Math.max(2, pct))}%`,
            background: color, borderRadius: 3,
          }}
        />
      </div>
      <span
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 11.5, fontVariantNumeric: 'tabular-nums',
          color, whiteSpace: 'nowrap', flexShrink: 0,
        }}
      >
        {count.toLocaleString()} / {limit.toLocaleString()} · {pct.toFixed(0)}%
        {over && <span> · {overLabel} {(count - limit).toLocaleString()}</span>}
      </span>
    </div>
  );
}

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px',
    borderRadius: 6, border: '1px solid var(--line)',
    background: primary ? 'var(--accent-soft, var(--surface-bg))' : 'var(--surface-bg)',
    color: primary ? 'var(--accent)' : 'var(--text)',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  };
}

const miniBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px',
  borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface-bg)',
  color: 'var(--text)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
};
