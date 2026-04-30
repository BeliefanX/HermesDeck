'use client';
import { useEffect, useMemo, useState } from 'react';
import { deckApi } from '@/lib/api';
import type { ToolSummary } from '@/lib/types';
import { Search, Wrench, Sparkles, Plug, Boxes } from 'lucide-react';

const KIND_ICON: Record<string, React.ReactNode> = {
  toolset: <Wrench size={14} />,
  skill: <Sparkles size={14} />,
  mcp: <Plug size={14} />,
  unknown: <Boxes size={14} />,
};

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    deckApi.tools()
      .then((r) => setTools(r.tools))
      .catch(() => setTools([]))
      .finally(() => setLoading(false));
  }, []);

  const kinds = useMemo(() => {
    const set = new Set<string>(); tools.forEach((t) => set.add(t.kind));
    return Array.from(set);
  }, [tools]);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return tools.filter((t) => {
      if (kind !== 'all' && t.kind !== kind) return false;
      if (!needle) return true;
      return ((t.name || '') + (t.description || '')).toLowerCase().includes(needle);
    });
  }, [tools, q, kind]);

  return (
    <div className="page grid">
      <p className="page-intro">
        Tools, skills and MCP capabilities discovered from Hermes at runtime.
        The frontend never hard-codes a capability list.
      </p>

      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="input-group" style={{ flex: 1, minWidth: 240 }}>
          <Search size={15} className="icon" />
          <input
            className="input"
            placeholder="Search tool, skill or MCP server"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search tools"
          />
        </div>
      </div>

      <div className="row start" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className={`chip ${kind === 'all' ? 'active' : ''}`} onClick={() => setKind('all')}>All ({tools.length})</button>
        {kinds.map((k) => (
          <button key={k} className={`chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
            {KIND_ICON[k] || KIND_ICON.unknown} {k} ({tools.filter((t) => t.kind === k).length})
          </button>
        ))}
      </div>

      <section className="card list" style={{ padding: 14 }}>
        {loading && Array.from({ length: 5 }).map((_, i) => (
          <div className="list-row" key={i}><div className="meta"><div className="skel" style={{ width: 180, height: 14 }} /></div></div>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="empty-state" style={{ padding: 24 }}>
            <Wrench size={22} />
            <h2>No matches</h2>
            <p className="muted small">
              {tools.length === 0 ? 'Hermes CLI did not return a tools/skills list.' : 'Try a shorter keyword or another category.'}
            </p>
          </div>
        )}
        {!loading && filtered.map((t, i) => (
          <div className="list-row" key={`${t.name}-${i}`}>
            <div className="meta" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="metric-icon" style={{ width: 32, height: 32, borderRadius: 10 }}>
                {KIND_ICON[t.kind] || KIND_ICON.unknown}
              </span>
              <div style={{ minWidth: 0 }}>
                <b>{t.name}</b>
                {t.description && <div className="muted small">{t.description}</div>}
              </div>
            </div>
            <span className="pill">{t.kind}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
