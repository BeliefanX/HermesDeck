'use client';
import { useEffect, useState } from 'react';
import { deckApi } from '@/lib/api';
import type { DeckProfile } from '@/lib/types';
import { Bot, Cpu, Network } from 'lucide-react';

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<DeckProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    deckApi.profiles()
      .then((r) => setProfiles(r.profiles))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page grid">
      <p className="page-intro">Profile 是 HermesDeck 的 Agent / 执行上下文切换基础，每个 profile 拥有独立的 <span className="kbd">~/.hermes/profiles/{'<id>'}</span> 状态目录。</p>

      <div className="grid cols-3">
        {loading && Array.from({ length: 3 }).map((_, i) => (
          <div className="card" key={i}>
            <div className="skel" style={{ width: 140, height: 18 }} />
            <div style={{ height: 8 }} />
            <div className="skel" style={{ width: 220, height: 12 }} />
            <div style={{ height: 6 }} />
            <div className="skel" style={{ width: 180, height: 12 }} />
          </div>
        ))}
        {!loading && profiles.map((p) => (
          <article key={p.id} className="card hover-lift">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="metric-icon"><Bot size={18} /></div>
              {p.active && <span className="pill ok">active</span>}
            </div>
            <h2 style={{ marginTop: 12 }}>{p.name}</h2>
            <div className="stack" style={{ marginTop: 8, gap: 6 }}>
              <div className="row start" style={{ gap: 8 }}>
                <Cpu size={13} color="var(--muted)" />
                <span className="small">{p.model || 'model from Hermes config'}</span>
              </div>
              <div className="row start" style={{ gap: 8 }}>
                <Network size={13} color="var(--muted)" />
                <span className="small">{p.gateway || 'gateway —'}</span>
              </div>
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <span className="tiny">PROFILE ID</span>
              <span className="kbd">{p.id}</span>
            </div>
          </article>
        ))}
        {!loading && profiles.length === 0 && (
          <div className="empty-state" style={{ gridColumn: '1 / -1', padding: 24 }}>
            <Bot size={22} />
            <h2>未发现 profile</h2>
            <p className="muted small">HermesDeck 将以 default 上下文运行。可使用 <span className="kbd">hermes profile create</span> 添加新的执行上下文。</p>
          </div>
        )}
      </div>
    </div>
  );
}
