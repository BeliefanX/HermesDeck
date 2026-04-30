'use client';
import { Radio, Activity, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export default function RunsPage() {
  return (
    <div className="page grid">
      <p className="page-intro">
        Execution-event center. The chat page already shows a live Run Timeline on the right; this view will index the replayable history at <span className="kbd">/v1/runs/[run_id]/events</span>.
      </p>

      <section className="card hero-card">
        <div className="hero-kicker">RUN TIMELINE</div>
        <h1>Structured Hermes execution streams</h1>
        <p className="muted small" style={{ marginTop: 10, maxWidth: 640 }}>
          Live <code className="kbd">status</code>, <code className="kbd">delta</code>,
          <code className="kbd">tool.*</code>, <code className="kbd">run.completed</code> events
          already render inside the chat thread. A standalone run index ships alongside the BFF replay buffer.
        </p>
        <div className="row start" style={{ marginTop: 14, gap: 8, flexWrap: 'wrap' }}>
          <Link href="/chat" className="btn primary"><Radio size={15} /> Open in chat</Link>
          <span className="pill ok"><Activity size={13} /> SSE ready</span>
        </div>
      </section>

      <div className="grid cols-3">
        <PlannedCard title="Live events" desc="status · delta · tool · done · error — the standard event shape." />
        <PlannedCard title="Resumable replay" desc="BFF buffers recent events; reconnect from the last cursor." />
        <PlannedCard title="Run-level filters" desc="Slice history by profile, tool or status." />
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
      <span className="pill warn" style={{ marginTop: 12 }}>Planned</span>
    </div>
  );
}
