'use client';
import Link from 'next/link';
import { Radio, Activity, ChevronRight } from 'lucide-react';
import { Page, Card, Kicker, Kbd, Tag, Btn } from '@/components/Brand';

export default function RunsPage() {
  return (
    <Page
      intro={
        <>
          Execution-event center. The chat page already shows a live Run Timeline on the right; this view will index the
          replayable history at <Kbd>/v1/runs/[run_id]/events</Kbd>.
        </>
      }
    >
      <Card hero>
        <Kicker>RUN TIMELINE</Kicker>
        <h1
          style={{
            margin: '6px 0 10px',
            fontSize: 24,
            fontWeight: 650,
            letterSpacing: '-.025em',
            color: 'var(--strong-text)',
          }}
        >
          Structured Hermes execution streams
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 640 }}>
          Live <Kbd>status</Kbd> &middot; <Kbd>delta</Kbd> &middot; <Kbd>tool.*</Kbd> &middot; <Kbd>run.completed</Kbd>{' '}
          events already render inside the chat thread. A standalone run index ships alongside the BFF replay buffer.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link href="/chat" style={{ textDecoration: 'none' }}>
            <Btn variant="primary" icon={<Radio size={14} />}>
              Open in chat
            </Btn>
          </Link>
          <Tag variant="green" icon={<Activity size={11} />}>SSE ready</Tag>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <PlannedCard title="Live events" desc="status · delta · tool · done · error — the standard event shape." />
        <PlannedCard title="Resumable replay" desc="BFF buffers recent events; reconnect from the last cursor." />
        <PlannedCard title="Run-level filters" desc="Slice history by profile, tool or status." />
      </div>
    </Page>
  );
}

function PlannedCard({ title, desc }: { title: string; desc: string }) {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--strong-text)' }}>{title}</h2>
        <ChevronRight size={14} style={{ color: 'var(--muted-2)' }} />
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55, margin: '6px 0 12px' }}>{desc}</p>
      <Tag variant="yellow">Planned</Tag>
    </Card>
  );
}
