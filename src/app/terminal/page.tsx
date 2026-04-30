'use client';
import { useEffect, useMemo, useState } from 'react';
import { Copy, Play, ShieldCheck, Terminal as TerminalIcon, Trash2, ChevronDown, AlertCircle } from 'lucide-react';
import { deckApi } from '@/lib/api';
import type { DeckProfile, TerminalAction, TerminalRunResult } from '@/lib/types';
import { Page, Card, Kicker, Tag, Btn, Kbd } from '@/components/Brand';

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
        id: `${Date.now()}_error`, ok: false, actionId, label: 'Request failed',
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
    <Page intro="Allowlisted, server-side actions only. Each run uses shell:false with a timeout, output truncation, and automatic secret redaction.">
      <div className="terminal-layout">
        {/* Allowlist sidebar */}
        <Card padding={14}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Kicker>ACTIONS</Kicker>
            <Tag variant="green" icon={<ShieldCheck size={11} />}>{actions.length} verbs</Tag>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 10, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '.12em', padding: '4px 4px 2px', fontWeight: 500 }}>
                  {category}
                </div>
                {items.map((a) => {
                  const active = selected === a.id;
                  return (
                    <button
                      key={a.id}
                      onClick={() => setSelected(a.id)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 3,
                        padding: '8px 10px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        background: active ? 'var(--accent-soft)' : 'transparent',
                        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                        border: 'none',
                        textAlign: 'left',
                        transition: 'all 200ms cubic-bezier(.2,.7,.2,1)',
                        width: '100%',
                      }}
                    >
                      <span style={{ fontSize: 12.5, fontWeight: 550, color: active ? 'var(--accent)' : 'var(--strong-text)' }}>
                        {a.label}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                        {a.commandPreview}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--hairline)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <PolicyRow label="timeout" value={`${(timeoutMs / 1000).toFixed(0)}s`} />
            <PolicyRow label="shell" value="false" tone="green" />
            <PolicyRow label="profile" value={profile} mono />
          </div>
        </Card>

        {/* Output panel */}
        <Card padding={0}>
          {/* Toolbar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              borderBottom: '1px solid var(--hairline)',
              flexWrap: 'wrap',
            }}
          >
            <TerminalIcon size={14} style={{ color: 'var(--muted)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--value-text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {selectedAction?.commandPreview || 'select an action'}
            </span>
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              style={selectStyle}
              aria-label="Profile"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.active ? ' · active' : ''}</option>
              ))}
            </select>
            <select
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              style={selectStyle}
              aria-label="Timeout"
            >
              <option value={3000}>3s</option>
              <option value={8000}>8s</option>
              <option value={12000}>12s</option>
              <option value={15000}>15s</option>
            </select>
            <Btn
              size="sm"
              variant="primary"
              icon={<Play size={12} />}
              onClick={() => run()}
              disabled={!selected || busy}
            >
              {busy ? 'Running…' : 'Run'}
            </Btn>
            <Btn size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => setRuns([])}>
              Clear
            </Btn>
          </div>

          {selectedAction && (
            <div
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--hairline)',
                background: 'var(--surface-bg)',
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--strong-text)' }}>{selectedAction.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{selectedAction.description}</div>
              </div>
              <Kbd>{selectedAction.commandPreview}</Kbd>
            </div>
          )}

          {error && (
            <div
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--hairline)',
                color: 'var(--red)',
                fontSize: 12.5,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(239,68,68,.06)',
              }}
            >
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {/* Output area */}
          <div
            style={{
              padding: 14,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              lineHeight: 1.55,
              minHeight: 280,
              background: 'var(--bg-soft)',
              borderRadius: '0 0 10px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            {runs.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '36px 12px', color: 'var(--muted)', textAlign: 'center' }}>
                <TerminalIcon size={22} />
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--strong-text)' }}>Awaiting run</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted-2)', maxWidth: 360 }}>
                  Pick an action and run it &mdash; output appears here. Free-form commands are intentionally not accepted; the WebUI never becomes a remote shell.
                </div>
              </div>
            ) : (
              runs.map((r) => (
                <article key={r.id} style={{ borderLeft: `2px solid ${r.ok ? 'var(--green)' : 'var(--red)'}`, paddingLeft: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--strong-text)', fontFamily: 'var(--font-sans)' }}>{r.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 2 }}>
                        {r.commandPreview} · {r.durationMs}ms · exit {r.exitCode ?? 'n/a'}{r.truncated ? ' · truncated' : ''}
                      </div>
                    </div>
                    <Btn
                      size="sm"
                      variant="ghost"
                      icon={<Copy size={11} />}
                      onClick={() => copy(r.id, [r.stdout, r.stderr, r.error].filter(Boolean).join('\n'))}
                    >
                      {copied === r.id ? 'Copied' : 'Copy'}
                    </Btn>
                  </div>
                  {r.error && (
                    <pre style={{ margin: 0, color: 'var(--red)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.error}</pre>
                  )}
                  {r.stdout && (
                    <pre style={{ margin: 0, color: 'var(--value-text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.stdout}</pre>
                  )}
                  {r.stderr && (
                    <pre style={{ margin: '6px 0 0', color: 'var(--yellow)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.stderr}</pre>
                  )}
                  {!r.error && !r.stdout && !r.stderr && (
                    <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-sans)' }}>
                      <ChevronDown size={12} /> no output
                    </div>
                  )}
                </article>
              ))
            )}
            {busy && (
              <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center', color: 'var(--muted)' }}>
                <span style={{ display: 'inline-block', width: 6, height: 14, background: 'var(--accent)', animation: 'hd-blink 1s steps(2,start) infinite' }} />
              </div>
            )}
          </div>
        </Card>
      </div>

      <style jsx>{`
        @keyframes hd-blink { 50% { opacity: 0; } }
      `}</style>
    </Page>
  );
}

const selectStyle: React.CSSProperties = {
  height: 28,
  padding: '0 8px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: 'var(--panel-2)',
  color: 'var(--text)',
  fontFamily: 'var(--font-sans)',
  fontSize: 11.5,
  cursor: 'pointer',
  outline: 'none',
  flexShrink: 0,
};

function PolicyRow({ label, value, tone, mono }: { label: string; value: string; tone?: 'green'; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
      <span>{label}</span>
      <span
        style={{
          fontFamily: mono === false ? undefined : 'var(--font-mono)',
          color: tone === 'green' ? 'var(--green)' : 'var(--value-text)',
          maxWidth: 140,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}
