'use client';
import { useEffect, useMemo, useState } from 'react';
import { Copy, Play, ShieldCheck, Terminal, Trash2, ChevronDown } from 'lucide-react';
import { deckApi } from '@/lib/api';
import type { DeckProfile, TerminalAction, TerminalRunResult } from '@/lib/types';

type RunEntry = TerminalRunResult & { id: string };

export default function TerminalPage() {
  const [actions, setActions] = useState<TerminalAction[]>([]);
  const [profiles, setProfiles] = useState<DeckProfile[]>([]);
  const [selected, setSelected] = useState('');
  const [profile, setProfile] = useState('default');
  const [timeoutMs, setTimeoutMs] = useState(8000);
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string>('');

  useEffect(() => {
    deckApi.terminalActions().then((r) => {
      setActions(r.actions);
      setSelected(r.actions[0]?.id || '');
    }).catch((e) => setError(e.message));
    deckApi.profiles().then((r) => {
      setProfiles(r.profiles);
      setProfile(r.profiles.find((p) => p.active)?.id || r.profiles[0]?.id || 'default');
    }).catch(() => {});
  }, []);

  const selectedAction = useMemo(() => actions.find((a) => a.id === selected), [actions, selected]);
  const grouped = useMemo(
    () => actions.reduce<Record<string, TerminalAction[]>>((acc, a) => { (acc[a.category] ||= []).push(a); return acc; }, {}),
    [actions],
  );

  async function run(actionId = selected) {
    if (!actionId || busy) return;
    setBusy(true); setError('');
    try {
      const result = await deckApi.terminalRun({ actionId, profileId: profile, timeoutMs });
      setRuns((prev) => [{ ...result, id: `${Date.now()}_${actionId}` }, ...prev].slice(0, 20));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setRuns((prev) => [{
        id: `${Date.now()}_error`, ok: false, actionId, label: '请求失败',
        commandPreview: actionId, startedAt: Date.now(), durationMs: 0,
        exitCode: null, stdout: '', stderr: '', truncated: false, error: msg,
      }, ...prev].slice(0, 20));
    } finally { setBusy(false); }
  }

  function copy(id: string, text: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(''), 1400);
    }).catch(() => {});
  }

  return (
    <div className="page terminal-page">
      <section className="card terminal-hero">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="compact-title">SAFE OPS CONSOLE</div>
          <h2 style={{ fontSize: 18, marginBottom: 8, color: 'var(--strong-text)' }}>不是裸 Web Shell，而是受控终端</h2>
          <p className="muted small">
            HermesDeck 的安全终端只允许服务端白名单动作，使用 <span className="kbd">shell:false</span>
            执行，并自动做超时、截断和敏感信息脱敏。
          </p>
        </div>
        <span className="pill ok"><ShieldCheck size={13} /> allowlisted</span>
      </section>

      <div className="terminal-layout">
        <aside className="card terminal-actions">
          <div className="compact-title">Actions</div>
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category} className="terminal-group">
              <div className="terminal-group-title">{category}</div>
              {items.map((a) => (
                <button
                  key={a.id}
                  className={`session-item ${selected === a.id ? 'active' : ''}`}
                  onClick={() => setSelected(a.id)}
                >
                  <div className="session-title">{a.label}</div>
                  <div className="tiny" style={{ marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>{a.commandPreview}</div>
                </button>
              ))}
            </div>
          ))}
        </aside>

        <main className="card terminal-main">
          <div className="terminal-control-grid">
            <label>
              <div className="tiny">Action</div>
              <select className="select" value={selected} onChange={(e) => setSelected(e.target.value)}>
                {actions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </label>
            <label>
              <div className="tiny">Profile</div>
              <select className="select" value={profile} onChange={(e) => setProfile(e.target.value)}>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? ' · active' : ''}</option>)}
              </select>
            </label>
            <label>
              <div className="tiny">Timeout</div>
              <select className="select" value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))}>
                <option value={3000}>3s</option>
                <option value={8000}>8s</option>
                <option value={12000}>12s</option>
                <option value={15000}>15s</option>
              </select>
            </label>
          </div>

          {selectedAction && (
            <div className="surface terminal-preview">
              <div style={{ minWidth: 0 }}>
                <b>{selectedAction.label}</b>
                <p className="muted small" style={{ marginTop: 4 }}>{selectedAction.description}</p>
              </div>
              <code>{selectedAction.commandPreview}</code>
            </div>
          )}

          <div className="row terminal-toolbar">
            <button className="btn primary" disabled={!selected || busy} onClick={() => run()}>
              <Play size={15} />{busy ? '执行中…' : '运行'}
            </button>
            <button className="btn" onClick={() => setRuns([])}><Trash2 size={14} /> 清空输出</button>
            {error && <span className="pill bad">{error}</span>}
          </div>

          <div className="terminal-output-list">
            {runs.length === 0 ? (
              <div className="empty-state">
                <Terminal size={22} />
                <h2>等待执行</h2>
                <p className="muted small">选择一个动作运行，输出会显示在这里。当前终端不接受自由命令，避免把 WebUI 变成危险的远程 Shell。</p>
              </div>
            ) : runs.map((r) => (
              <article className={`terminal-output ${r.ok ? '' : 'failed'}`} key={r.id}>
                <div className="row">
                  <div style={{ minWidth: 0 }}>
                    <b>{r.label}</b>
                    <div className="tiny" style={{ marginTop: 3, fontFamily: "'JetBrains Mono', monospace", color: 'var(--muted-2)' }}>
                      {r.commandPreview} · {r.durationMs}ms · exit {r.exitCode ?? 'n/a'}{r.truncated ? ' · truncated' : ''}
                    </div>
                  </div>
                  <button
                    className="btn sm"
                    onClick={() => copy(r.id, [r.stdout, r.stderr, r.error].filter(Boolean).join('\n'))}
                    aria-label="复制输出"
                  >
                    <Copy size={13} /> {copied === r.id ? '已复制' : '复制'}
                  </button>
                </div>
                {r.error && <pre className="terminal-error">{r.error}</pre>}
                {r.stdout && <pre>{r.stdout}</pre>}
                {r.stderr && <pre className="terminal-stderr">{r.stderr}</pre>}
                {!r.error && !r.stdout && !r.stderr && (
                  <div className="muted small" style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <ChevronDown size={13} /> 无输出
                  </div>
                )}
              </article>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
