'use client';
import { useEffect, useRef, useState } from 'react';
import { X, Save, Edit3, FileText, Loader2, AlertCircle, Eye, FolderOpen } from 'lucide-react';
import { deckApi } from '@/lib/api';
import { ApiError } from '@/lib/api';
import type { SkillContent } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { Tag, Kicker } from './Brand';
import { MessageContent } from './MessageContent';

interface Props {
  relPath: string;
  /** Best-known name to show in the header before content arrives. */
  name?: string;
  category?: string;
  onClose: () => void;
}

type Mode = 'view' | 'edit';

export function SkillEditor({ relPath, name, category, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [skill, setSkill] = useState<SkillContent | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(0);

  const t = useT({
    zh: {
      title: '技能详情',
      close: '关闭',
      view: '查看',
      edit: '编辑',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      cancel: '放弃修改',
      loading: '加载中…',
      readOnly: '只读',
      readOnlyHint: 'SKILL.md 在磁盘上是只读的，将尝试以当前用户身份覆盖。',
      conflict: '保存冲突：磁盘上的 SKILL.md 已被其他进程修改。请重新加载后再试。',
      reload: '重新加载',
      bytes: (n: number) => `${n} 字节`,
      mtime: '修改时间',
      pathLabel: '路径',
      noContent: '此技能没有 SKILL.md 内容。',
      saveSuccess: '已保存',
    },
    en: {
      title: 'Skill detail',
      close: 'Close',
      view: 'View',
      edit: 'Edit',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      cancel: 'Discard',
      loading: 'Loading…',
      readOnly: 'read-only',
      readOnlyHint: 'SKILL.md is marked read-only on disk; the save will be attempted as the current user.',
      conflict: 'Save conflict: the on-disk SKILL.md changed since you opened it. Reload and try again.',
      reload: 'Reload',
      bytes: (n: number) => `${n} bytes`,
      mtime: 'modified',
      pathLabel: 'path',
      noContent: 'This skill has no SKILL.md content.',
      saveSuccess: 'Saved',
    },
  });

  // Lock body scroll while open and trap focus in the card.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const load = (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    deckApi.skillRead(relPath, signal)
      .then((s) => {
        setSkill(s);
        setDraft(s.content);
      })
      .catch((e) => {
        if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!signal?.aborted) setLoading(false); });
  };

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relPath]);

  const dirty = mode === 'edit' && skill !== null && draft !== skill.content;

  const handleSave = async () => {
    if (!skill || !dirty) return;
    setSaving(true);
    setError('');
    try {
      const res = await deckApi.skillSave(relPath, draft, skill.mtime);
      setSkill({ ...skill, content: draft, mtime: res.mtime, size: res.size });
      setSavedAt(Date.now());
      setMode('view');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(t.conflict);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  };

  // Cmd/Ctrl-S to save while editing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode === 'edit' && (e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, draft, skill]);

  // Auto-clear the "Saved" indicator after 2s.
  useEffect(() => {
    if (!savedAt) return;
    const id = setTimeout(() => setSavedAt(0), 2000);
    return () => clearTimeout(id);
  }, [savedAt]);

  const headerName = skill?.name || name || relPath.split('/').slice(-1)[0] || 'skill';
  const headerCategory = skill?.category || category;
  const sizeLabel = skill ? t.bytes(skill.size) : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${t.title}: ${headerName}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4vh 2vw',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        ref={cardRef}
        style={{
          width: 'min(960px, 100%)',
          maxHeight: '92vh',
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <FileText size={16} style={{ color: 'var(--accent)' }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--strong-text)', fontFamily: 'var(--font-mono)' }}>
              {headerName}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {headerCategory && <Tag>{headerCategory}</Tag>}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)' }}>
                <FolderOpen size={11} /> {relPath}
              </span>
              {skill && (
                <>
                  <span>· {sizeLabel}</span>
                  <span>· {t.mtime} {new Date(skill.mtime).toLocaleString()}</span>
                  {skill.readOnly && <Tag variant="yellow">{t.readOnly}</Tag>}
                </>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {mode === 'view' ? (
              <button
                onClick={() => { setMode('edit'); setTimeout(() => textareaRef.current?.focus(), 0); }}
                disabled={loading || !skill}
                style={btnStyle(true)}
              >
                <Edit3 size={13} /> {t.edit}
              </button>
            ) : (
              <>
                <button
                  onClick={() => { if (skill) setDraft(skill.content); setMode('view'); }}
                  style={btnStyle(false)}
                  disabled={saving}
                >
                  <Eye size={13} /> {t.cancel}
                </button>
                <button
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  style={btnStyle(true)}
                >
                  {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
                  {saving ? t.saving : (savedAt ? t.saved : t.save)}
                </button>
              </>
            )}
            <button onClick={onClose} aria-label={t.close} style={iconBtnStyle}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Inline error / status banner */}
        {(error || (skill?.readOnly && mode === 'edit')) && (
          <div style={{
            padding: '8px 16px',
            background: error ? 'rgba(239,68,68,.10)' : 'rgba(234,179,8,.10)',
            borderBottom: '1px solid var(--hairline)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: error ? 'var(--red, #ef4444)' : 'var(--yellow, #eab308)',
          }}>
            <AlertCircle size={13} />
            <span style={{ flex: 1 }}>{error || t.readOnlyHint}</span>
            {error && (
              <button onClick={() => load()} style={{ ...btnStyle(false), padding: '4px 8px' }}>
                {t.reload}
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {loading ? (
            <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Loader2 size={14} className="spin" /> {t.loading}
            </div>
          ) : !skill ? (
            <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>{t.noContent}</div>
          ) : mode === 'edit' ? (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1,
                width: '100%',
                resize: 'none',
                background: 'var(--bg-soft)',
                color: 'var(--text)',
                border: 'none',
                outline: 'none',
                padding: 16,
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                lineHeight: 1.55,
                tabSize: 2,
              }}
            />
          ) : (
            <div style={{ flex: 1, overflow: 'auto', padding: '12px 18px' }}>
              <Kicker style={{ marginBottom: 6 }}>SKILL.md</Kicker>
              <MessageContent content={skill.content} />
            </div>
          )}
        </div>
      </div>
      <style jsx>{`
        .spin { animation: skill-spin 1s linear infinite; }
        @keyframes skill-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function btnStyle(primary: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 28,
    padding: '0 10px',
    borderRadius: 6,
    border: '1px solid var(--line)',
    background: primary ? 'var(--accent-soft, var(--surface-bg))' : 'var(--surface-bg)',
    color: primary ? 'var(--accent)' : 'var(--text)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };
}

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: 'var(--surface-bg)',
  color: 'var(--muted)',
  cursor: 'pointer',
};
