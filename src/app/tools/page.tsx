'use client';
import { useEffect, useMemo, useState } from 'react';
import { deckApi } from '@/lib/api';
import type { ToolSummary } from '@/lib/types';
import { Search, Wrench, Sparkles, Plug, Boxes } from 'lucide-react';
import { Page, Card, Chip, Tag } from '@/components/Brand';

const KIND_ICON: Record<string, React.ReactNode> = {
  toolset: <Wrench size={14} />,
  skill: <Sparkles size={14} />,
  mcp: <Plug size={14} />,
  unknown: <Boxes size={14} />,
};
const CHIP_ICON: Record<string, React.ReactNode> = {
  toolset: <Wrench size={11} />,
  skill: <Sparkles size={11} />,
  mcp: <Plug size={11} />,
  unknown: <Boxes size={11} />,
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
    const set = new Set<string>();
    tools.forEach((t) => set.add(t.kind));
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
    <Page intro="Tools, skills and MCP capabilities discovered from Hermes at runtime. The frontend never hard-codes a capability list.">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 36,
          padding: '0 12px',
          background: 'var(--bg-soft)',
          border: '1px solid var(--line)',
          borderRadius: 8,
        }}
      >
        <Search size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tool, skill or MCP server"
          aria-label="Search tools"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text)',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip active={kind === 'all'} onClick={() => setKind('all')}>
          All ({tools.length})
        </Chip>
        {kinds.map((k) => (
          <Chip key={k} active={kind === k} onClick={() => setKind(k)} icon={CHIP_ICON[k] || CHIP_ICON.unknown}>
            {k} ({tools.filter((t) => t.kind === k).length})
          </Chip>
        ))}
      </div>

      <Card padding={6}>
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                }}
              >
                <div className="skel" style={{ width: 32, height: 32, borderRadius: 10 }} />
                <div className="skel" style={{ flex: 1, height: 14 }} />
              </div>
            ))
          : filtered.length === 0
          ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                padding: '32px 12px',
                color: 'var(--muted)',
              }}
            >
              <Wrench size={20} />
              <span style={{ fontSize: 13 }}>No matches</span>
              <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>
                {tools.length === 0
                  ? 'Hermes CLI did not return a tools/skills list.'
                  : 'Try a shorter keyword or another category.'}
              </span>
            </div>
          )
          : filtered.map((t, i) => (
              <div
                key={`${t.name}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                }}
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background: 'var(--surface-bg)',
                    border: '1px solid var(--line)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent)',
                    flexShrink: 0,
                  }}
                >
                  {KIND_ICON[t.kind] || KIND_ICON.unknown}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--strong-text)', fontFamily: 'var(--font-mono)' }}>
                    {t.name}
                  </div>
                  {t.description ? (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--muted)',
                        marginTop: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {t.description}
                    </div>
                  ) : null}
                </div>
                <Tag>{t.kind}</Tag>
              </div>
            ))}
      </Card>
    </Page>
  );
}
