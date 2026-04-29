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
      <p className="page-intro">从 Hermes 动态发现工具、skills 与 MCP / toolset 能力，前端不硬编码任何能力清单。</p>

      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="input-group" style={{ flex: 1, minWidth: 240 }}>
          <Search size={15} className="icon" />
          <input
            className="input"
            placeholder="搜索 tool / skill / MCP"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="搜索工具"
          />
        </div>
      </div>

      <div className="row start" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className={`chip ${kind === 'all' ? 'active' : ''}`} onClick={() => setKind('all')}>全部 ({tools.length})</button>
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
            <h2>没有匹配的能力</h2>
            <p className="muted small">{tools.length === 0 ? 'Hermes CLI 未提供 tools / skills 清单。' : '尝试更短的关键词或切换分类。'}</p>
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
