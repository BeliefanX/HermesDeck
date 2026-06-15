'use client';
import { MessageSquare } from 'lucide-react';
import { Kbd, Kicker } from '@/components/Brand';
import type { ChatT } from '../_lib/i18n';

export function EmptyState({
  t, suggestions, onSendSuggestion,
}: {
  t: ChatT;
  suggestions: string[];
  onSendSuggestion: (s: string) => void;
}) {
  return (
    <div
      className="empty-state"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 12,
        padding: '48px 16px',
        maxWidth: 560,
        margin: '0 auto',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          background: 'var(--accent-soft)',
          border: '1px solid var(--accent-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent)',
        }}
      >
        <MessageSquare size={20} />
      </div>
      <Kicker>{t.newConversationKicker}</Kicker>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 650, color: 'var(--strong-text)', letterSpacing: '-.025em' }}>
        {t.startSession}
      </h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0, maxWidth: 460 }}>
        {t.emptyHint1}<Kbd>response_id</Kbd>{t.emptyHint2}
      </p>
      <div className="suggest" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 4 }}>
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onSendSuggestion(s)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              height: 30,
              padding: '0 12px',
              borderRadius: 999,
              background: 'var(--panel-2)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              cursor: 'pointer',
              transition: 'background 200ms cubic-bezier(.2,.7,.2,1), border-color 200ms cubic-bezier(.2,.7,.2,1), color 200ms cubic-bezier(.2,.7,.2,1)',
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
