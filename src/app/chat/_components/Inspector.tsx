'use client';
import type { DeckSession, ToolSummary } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { Kicker } from '@/components/Brand';

export function ChatInspector({
  profile, session, messageCount, tools, responseId,
}: {
  profile: string;
  session?: DeckSession;
  messageCount: number;
  tools: ToolSummary[];
  responseId?: string;
}) {
  const t = useT({
    zh: {
      kicker: '会话检查器',
      profile: 'Profile',
      session: '会话',
      notStarted: '尚未开始',
      source: '来源',
      model: '模型',
      modelDefault: 'Profile 默认',
      messages: '消息数',
      remotePrefix: ' · 远端 ',
      chain: '响应链',
      chainLinked: 'response_id 已链接',
      chainFresh: '新建链',
      toolsets: '工具集',
      enabled: '启用',
      off: '关闭',
      skills: '技能',
      available: '可用',
      mcp: 'MCP',
      server: '服务器',
      footPrefix: '置顶 / 文件夹 / 标签 / 重命名都属于',
      footBold: 'Deck 本地元数据',
      footSuffix: '，不会同步到 Hermes。',
    },
    en: {
      kicker: 'SESSION INSPECTOR',
      profile: 'Profile',
      session: 'Session',
      notStarted: 'not started',
      source: 'Source',
      model: 'Model',
      modelDefault: 'profile default',
      messages: 'Messages',
      remotePrefix: ' · remote ',
      chain: 'Chain',
      chainLinked: 'response_id linked',
      chainFresh: 'fresh chain',
      toolsets: 'Toolsets',
      enabled: 'enabled',
      off: 'off',
      skills: 'Skills',
      available: 'available',
      mcp: 'MCP',
      server: 'server',
      footPrefix: 'Pin / folder / tags / rename are ',
      footBold: 'local-only Deck metadata',
      footSuffix: ' and never reach Hermes.',
    },
  });
  const enabledToolsets = tools.filter((tt) => tt.kind === 'toolset' && tt.enabled !== false);
  const enabledMcp = tools.filter((tt) => tt.kind === 'mcp' && tt.enabled !== false);
  const enabledSkills = tools.filter((tt) => tt.kind === 'skill' && tt.enabled !== false);
  return (
    <div
      style={{
        padding: 12,
        marginBottom: 14,
        background: 'var(--surface-bg)',
        border: '1px solid var(--hairline)',
        borderRadius: 8,
        fontSize: 11.5,
      }}
    >
      <Kicker style={{ marginBottom: 6 }}>{t.kicker}</Kicker>
      <div style={{ display: 'grid', gridTemplateColumns: '88px 1fr', gap: 4, lineHeight: 1.45 }}>
        <span style={{ color: 'var(--muted-2)' }}>{t.profile}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{profile}</span>
        <span style={{ color: 'var(--muted-2)' }}>{t.session}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)', wordBreak: 'break-all' }}>
          {session?.id ? `${session.id.slice(0, 12)}…` : t.notStarted}
        </span>
        <span style={{ color: 'var(--muted-2)' }}>{t.source}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{session?.source || '—'}</span>
        <span style={{ color: 'var(--muted-2)' }}>{t.model}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
          {session?.model || t.modelDefault}
        </span>
        <span style={{ color: 'var(--muted-2)' }}>{t.messages}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
          {messageCount}{session?.messageCount && session.messageCount !== messageCount ? `${t.remotePrefix}${session.messageCount}` : ''}
        </span>
        <span style={{ color: 'var(--muted-2)' }}>{t.chain}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
          {responseId ? t.chainLinked : t.chainFresh}
        </span>
        <span style={{ color: 'var(--muted-2)' }}>{t.toolsets}</span>
        <span style={{ color: 'var(--text)' }}>
          {enabledToolsets.length} {t.enabled} · {tools.filter((tt) => tt.kind === 'toolset' && tt.enabled === false).length} {t.off}
        </span>
        <span style={{ color: 'var(--muted-2)' }}>{t.skills}</span>
        <span style={{ color: 'var(--text)' }}>{enabledSkills.length} {t.available}</span>
        <span style={{ color: 'var(--muted-2)' }}>{t.mcp}</span>
        <span style={{ color: 'var(--text)' }}>{enabledMcp.length} {t.server}{enabledMcp.length === 1 ? '' : 's'}</span>
      </div>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--hairline)', fontSize: 11, color: 'var(--muted-2)' }}>
        {t.footPrefix}<b>{t.footBold}</b>{t.footSuffix}
      </div>
    </div>
  );
}
