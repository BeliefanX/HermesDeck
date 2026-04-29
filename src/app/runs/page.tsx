'use client';
import { Radio, Activity, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export default function RunsPage() {
  return (
    <div className="page grid">
      <p className="page-intro">运行事件中心：聊天页右侧已有实时 Run Timeline；后续这里将汇总 <span className="kbd">/v1/runs/[run_id]/events</span> 的可重连事件历史。</p>

      <section className="card hero-card">
        <div className="hero-kicker">RUN TIMELINE</div>
        <h1>结构化的 Hermes 执行流</h1>
        <p className="muted small" style={{ marginTop: 10, maxWidth: 640 }}>
          已在聊天页实时显示 <code className="kbd">status</code>、<code className="kbd">delta</code>、
          <code className="kbd">tool.*</code>、<code className="kbd">run.completed</code> 等事件。
          独立的运行索引会随 BFF 落盘 replay buffer 一起上线。
        </p>
        <div className="row start" style={{ marginTop: 14, gap: 8, flexWrap: 'wrap' }}>
          <Link href="/chat" className="btn primary"><Radio size={15} /> 在对话中查看</Link>
          <span className="pill ok"><Activity size={13} /> SSE ready</span>
        </div>
      </section>

      <div className="grid cols-3">
        <PlannedCard title="实时事件" desc="status · delta · tool · done · error 标准事件流" />
        <PlannedCard title="可重连 replay" desc="BFF 缓存最近事件，断线后从最后 cursor 续接" />
        <PlannedCard title="运行级筛选" desc="按 profile / tool / status 过滤历史 runs" />
      </div>
    </div>
  );
}

function PlannedCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="card">
      <div className="row">
        <h2>{title}</h2>
        <ChevronRight size={14} color="var(--muted)" />
      </div>
      <p className="muted small" style={{ marginTop: 6 }}>{desc}</p>
      <span className="pill warn" style={{ marginTop: 12 }}>规划中</span>
    </div>
  );
}
