'use client';
import { Bot, ShieldAlert } from 'lucide-react';
import { Card, Kicker } from './Brand';
import { useT } from '@/lib/i18n';

type NoAssignedAgentsStateProps = {
  compact?: boolean;
};

export function NoAssignedAgentsState({ compact = false }: NoAssignedAgentsStateProps) {
  const t = useT({
    zh: {
      kicker: '未分配 Agent',
      title: '你的账户还没有分配 Agent Profile。',
      body: '请联系管理员分配 Agent Profile；在分配之前无法使用仪表盘指标、Profiles、会话或聊天。',
      required: '需要 RBAC profile 分配',
    },
    en: {
      kicker: 'No assigned Agents',
      title: 'No Agent profiles are assigned to your account.',
      body: 'Contact an admin to request access to an Agent profile before using dashboard metrics, profiles, sessions, or chat.',
      required: 'RBAC profile assignment required',
    },
  });
  return (
    <Card style={{ padding: compact ? 18 : 28, textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 14, background: 'rgba(56,189,248,.10)', color: 'var(--accent)', marginBottom: 10 }}>
        <Bot size={22} />
      </div>
      <Kicker style={{ justifyContent: 'center', marginBottom: 6 }}>{t.kicker}</Kicker>
      <h2 style={{ margin: '0 0 6px', fontSize: compact ? 15 : 18, fontWeight: 650, color: 'var(--strong-text)' }}>
        {t.title}
      </h2>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
        {t.body}
      </p>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 11.5, color: 'var(--muted-2)' }}>
        <ShieldAlert size={12} /> {t.required}
      </div>
    </Card>
  );
}
