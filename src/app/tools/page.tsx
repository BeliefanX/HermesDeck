'use client';
import { useEffect, useMemo, useState } from 'react';
import { deckApi } from '@/lib/api';
import type { ToolSummary } from '@/lib/types';
import {
  Search, Wrench, Sparkles, Plug, Boxes, FileSearch, Code2, Globe, FolderOpen,
  MessageCircle, Server, Image as ImageIcon, BrainCircuit, ListChecks, Bot, Database, AlertCircle,
  FileText,
} from 'lucide-react';
import { Page, Card, Chip, Tag, Kicker, Kbd, SectionHead } from '@/components/Brand';
import { useT } from '@/lib/i18n';
import { SkillEditor } from '@/components/SkillEditor';

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

type Group = NonNullable<ToolSummary['taskGroup']>;
const GROUP_ICON: Record<Group, React.ReactNode> = {
  research:    <FileSearch size={11} />,
  coding:      <Code2 size={11} />,
  browser:     <Globe size={11} />,
  files:       <FolderOpen size={11} />,
  messaging:   <MessageCircle size={11} />,
  devops:      <Server size={11} />,
  media:       <ImageIcon size={11} />,
  agents:      <Bot size={11} />,
  memory:      <BrainCircuit size={11} />,
  planning:    <ListChecks size={11} />,
  unknown:     <Boxes size={11} />,
};

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<string>('all');
  const [group, setGroup] = useState<string>('all');
  const [showDisabled, setShowDisabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [openSkill, setOpenSkill] = useState<{ relPath: string; name: string; category?: string } | null>(null);

  const t = useT({
    zh: {
      intro: '能力注册表。从 Hermes CLI 实时发现——工具集、技能、MCP 服务器与插件。可按任务或状态过滤。',
      groupResearch: '研究',
      groupCoding: '编码',
      groupBrowser: '浏览器',
      groupFiles: '文件',
      groupMessaging: '消息',
      groupDevops: '运维',
      groupMedia: '媒体',
      groupAgents: '智能体',
      groupMemory: '记忆',
      groupPlanning: '规划',
      groupUnknown: '其他',
      kickerTotal: '总计',
      kickerToolsets: '工具集',
      kickerSkills: '技能',
      kickerMcp: 'MCP',
      subEnabledDisabled: (e: number, d: number) => `${e} 已启用 · ${d} 已禁用`,
      subToolsets: 'Hermes 内建能力',
      subSkills: '内建 · Hub · 本地',
      subMcp: '外部服务器',
      hermesFailed: 'Hermes CLI 调用失败：',
      searchPlaceholder: '搜索工具、技能、MCP、分类…',
      searchAria: '搜索工具',
      kindLabel: '类型',
      taskLabel: '任务',
      all: '全部',
      hideDisabled: '隐藏已禁用',
      showDisabled: '显示已禁用',
      noMatches: '没有匹配项',
      noToolsList: 'Hermes CLI 未返回工具/技能列表。',
      tryShorter: '试试更短的关键词、切换类型，或清除过滤。',
      titleToolsets: '工具集',
      titleSkills: '技能',
      titleMcp: 'MCP 服务器',
      titleCapabilities: '能力',
      trustPrefix: '信任 · ',
      authFailed: '认证失败',
      enabled: '已启用',
      disabled: '已禁用',
      viewSkill: '查看 / 编辑',
      noSkillPath: '未在磁盘上找到 SKILL.md',
    },
    en: {
      intro: 'Capability registry. Discovered live from the Hermes CLI — toolsets, skills, MCP servers, and plugins. Filter by task or status.',
      groupResearch: 'Research',
      groupCoding: 'Coding',
      groupBrowser: 'Browser',
      groupFiles: 'Files',
      groupMessaging: 'Messaging',
      groupDevops: 'DevOps',
      groupMedia: 'Media',
      groupAgents: 'Agents',
      groupMemory: 'Memory',
      groupPlanning: 'Planning',
      groupUnknown: 'Other',
      kickerTotal: 'TOTAL',
      kickerToolsets: 'TOOLSETS',
      kickerSkills: 'SKILLS',
      kickerMcp: 'MCP',
      subEnabledDisabled: (e: number, d: number) => `${e} enabled · ${d} disabled`,
      subToolsets: 'builtin Hermes capabilities',
      subSkills: 'builtin · hub · local',
      subMcp: 'external servers',
      hermesFailed: 'Hermes CLI failed: ',
      searchPlaceholder: 'Search tool, skill, MCP, category…',
      searchAria: 'Search tools',
      kindLabel: 'KIND',
      taskLabel: 'TASK',
      all: 'All',
      hideDisabled: 'Hide disabled',
      showDisabled: 'Show disabled',
      noMatches: 'No matches',
      noToolsList: 'Hermes CLI did not return a tools/skills list.',
      tryShorter: 'Try a shorter keyword, change kind, or clear filters.',
      titleToolsets: 'Toolsets',
      titleSkills: 'Skills',
      titleMcp: 'MCP servers',
      titleCapabilities: 'Capabilities',
      trustPrefix: 'trust · ',
      authFailed: 'auth failed',
      enabled: 'enabled',
      disabled: 'disabled',
      viewSkill: 'View / edit',
      noSkillPath: 'SKILL.md not found on disk',
    },
  });

  const groupLabel = (g: Group): string => {
    switch (g) {
      case 'research': return t.groupResearch;
      case 'coding': return t.groupCoding;
      case 'browser': return t.groupBrowser;
      case 'files': return t.groupFiles;
      case 'messaging': return t.groupMessaging;
      case 'devops': return t.groupDevops;
      case 'media': return t.groupMedia;
      case 'agents': return t.groupAgents;
      case 'memory': return t.groupMemory;
      case 'planning': return t.groupPlanning;
      case 'unknown': return t.groupUnknown;
      default: return g;
    }
  };

  useEffect(() => {
    const ac = new AbortController();
    deckApi.tools(ac.signal)
      .then((r) => { if (!ac.signal.aborted) setTools(r.tools); })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) return;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => { ac.abort(); };
  }, []);

  const counts = useMemo(() => {
    const total = tools.length;
    const enabled = tools.filter((t) => t.enabled !== false).length;
    const disabled = tools.filter((t) => t.enabled === false).length;
    const byKind: Record<string, number> = {};
    tools.forEach((t) => { byKind[t.kind] = (byKind[t.kind] || 0) + 1; });
    return { total, enabled, disabled, byKind };
  }, [tools]);

  const kinds = useMemo(() => Object.keys(counts.byKind), [counts.byKind]);

  const groupCounts = useMemo(() => {
    const map = new Map<string, number>();
    tools.forEach((t) => {
      const g = t.taskGroup || 'unknown';
      map.set(g, (map.get(g) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [tools]);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return tools.filter((t) => {
      if (kind !== 'all' && t.kind !== kind) return false;
      if (group !== 'all' && (t.taskGroup || 'unknown') !== group) return false;
      if (!showDisabled && t.enabled === false) return false;
      if (!needle) return true;
      const hay = ((t.name || '') + (t.description || '') + (t.category || '')).toLowerCase();
      return hay.includes(needle);
    });
  }, [tools, q, kind, group, showDisabled]);

  // Cluster the visible list by kind for the registry view.
  const clustered = useMemo(() => {
    const order: Array<ToolSummary['kind']> = ['toolset', 'mcp', 'skill', 'unknown'];
    const buckets = new Map<ToolSummary['kind'], ToolSummary[]>();
    filtered.forEach((t) => {
      const k = (t.kind || 'unknown') as ToolSummary['kind'];
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(t);
    });
    return order
      .filter((k) => buckets.has(k))
      .map((k) => ({ kind: k, items: buckets.get(k)! }));
  }, [filtered]);

  const titleForKind = (k: ToolSummary['kind']): string => {
    if (k === 'toolset') return t.titleToolsets;
    if (k === 'skill') return t.titleSkills;
    if (k === 'mcp') return t.titleMcp;
    return t.titleCapabilities;
  };

  return (
    <Page intro={t.intro}>
      {/* Header metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <SmallStat kicker={t.kickerTotal} value={loading ? '—' : counts.total} sub={t.subEnabledDisabled(counts.enabled, counts.disabled)} />
        <SmallStat kicker={t.kickerToolsets} value={counts.byKind.toolset || 0} sub={t.subToolsets} />
        <SmallStat kicker={t.kickerSkills} value={counts.byKind.skill || 0} sub={t.subSkills} />
        <SmallStat kicker={t.kickerMcp} value={counts.byKind.mcp || 0} sub={t.subMcp} />
      </div>

      {err && (
        <Card style={{ borderColor: 'rgba(239,68,68,.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--red)' }}>
            <AlertCircle size={15} /> {t.hermesFailed}{err}
          </div>
        </Card>
      )}

      {/* Search + filters */}
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
          placeholder={t.searchPlaceholder}
          aria-label={t.searchAria}
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
        <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>{filtered.length} / {counts.total}</span>
      </div>

      <div>
        <Kicker style={{ marginBottom: 6 }}>{t.kindLabel}</Kicker>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip active={kind === 'all'} onClick={() => setKind('all')}>{t.all} ({counts.total})</Chip>
          {kinds.map((k) => (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)} icon={CHIP_ICON[k] || CHIP_ICON.unknown}>
              {k} ({counts.byKind[k] || 0})
            </Chip>
          ))}
          <span style={{ flex: 1 }} />
          <Chip active={!showDisabled} onClick={() => setShowDisabled((v) => !v)}>
            {showDisabled ? t.hideDisabled : t.showDisabled}
          </Chip>
        </div>
      </div>

      <div>
        <Kicker style={{ marginBottom: 6 }}>{t.taskLabel}</Kicker>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip active={group === 'all'} onClick={() => setGroup('all')}>{t.all}</Chip>
          {groupCounts.map(([g, n]) => {
            const gKey = g as Group;
            return (
              <Chip key={g} active={group === g} onClick={() => setGroup(g)} icon={GROUP_ICON[gKey]}>
                {groupLabel(gKey)} ({n})
              </Chip>
            );
          })}
        </div>
      </div>

      {/* Clustered registry */}
      {loading ? (
        <Card padding={6}>
          {Array.from({ length: 6 }).map((_, i) => (
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
          ))}
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: 32 }}>
          <Wrench size={20} style={{ color: 'var(--muted)' }} />
          <div style={{ fontSize: 13, marginTop: 8 }}>{t.noMatches}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 2 }}>
            {tools.length === 0
              ? t.noToolsList
              : t.tryShorter}
          </div>
        </Card>
      ) : (
        clustered.map(({ kind: k, items }) => (
          <Card key={k} padding={0}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--hairline)' }}>
              <SectionHead
                kicker={k.toUpperCase()}
                title={
                  <>
                    {KIND_ICON[k]}
                    <span>{titleForKind(k)}</span>
                    <Kbd>{items.length}</Kbd>
                  </>
                }
              />
            </div>
            <div>
              {items.map((tool, i) => (
                <ToolRow
                  key={`${tool.kind}-${tool.name}-${i}`}
                  tool={tool}
                  first={i === 0}
                  enabledLabel={t.enabled}
                  disabledLabel={t.disabled}
                  trustPrefix={t.trustPrefix}
                  authFailed={t.authFailed}
                  viewSkillLabel={t.viewSkill}
                  noSkillPathLabel={t.noSkillPath}
                  onOpenSkill={(s) => setOpenSkill(s)}
                />
              ))}
            </div>
          </Card>
        ))
      )}

      {openSkill && (
        <SkillEditor
          relPath={openSkill.relPath}
          name={openSkill.name}
          category={openSkill.category}
          onClose={() => setOpenSkill(null)}
        />
      )}
    </Page>
  );
}

function ToolRow({
  tool,
  first,
  enabledLabel,
  disabledLabel,
  trustPrefix,
  authFailed,
  viewSkillLabel,
  noSkillPathLabel,
  onOpenSkill,
}: {
  tool: ToolSummary;
  first?: boolean;
  enabledLabel: string;
  disabledLabel: string;
  trustPrefix: string;
  authFailed: string;
  viewSkillLabel: string;
  noSkillPathLabel: string;
  onOpenSkill: (s: { relPath: string; name: string; category?: string }) => void;
}) {
  const enabled = tool.enabled !== false;
  const isSkill = tool.kind === 'skill';
  const canOpen = isSkill && Boolean(tool.relPath);
  const handleOpen = () => {
    if (canOpen && tool.relPath) onOpenSkill({ relPath: tool.relPath, name: tool.name, category: tool.category });
  };
  return (
    <div
      onClick={canOpen ? handleOpen : undefined}
      onKeyDown={canOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(); } } : undefined}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : -1}
      title={isSkill ? (canOpen ? viewSkillLabel : noSkillPathLabel) : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        borderTop: first ? 'none' : '1px solid var(--hairline)',
        opacity: enabled ? 1 : 0.62,
        cursor: canOpen ? 'pointer' : 'default',
        transition: 'background 120ms',
      }}
      onMouseEnter={canOpen ? (e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-soft)'; } : undefined}
      onMouseLeave={canOpen ? (e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; } : undefined}
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
          color: enabled ? 'var(--accent)' : 'var(--muted)',
          flexShrink: 0,
        }}
      >
        {KIND_ICON[tool.kind] || KIND_ICON.unknown}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--strong-text)', fontFamily: 'var(--font-mono)' }}>
            {tool.name}
          </span>
          {tool.category && <Tag>{tool.category}</Tag>}
          {tool.source && <Tag variant="default" icon={<Database size={10} />}>{tool.source}</Tag>}
          {tool.trust && <Tag variant="default">{trustPrefix}{tool.trust}</Tag>}
          {tool.authFailed && <Tag variant="red" icon={<AlertCircle size={10} />}>{authFailed}</Tag>}
        </div>
        {tool.description && (
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--muted)',
              marginTop: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {tool.description}
          </div>
        )}
      </div>
      <Tag variant={enabled ? 'green' : 'default'}>{enabled ? enabledLabel : disabledLabel}</Tag>
      {isSkill && canOpen && (
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 11,
            color: 'var(--muted)',
            paddingLeft: 4,
          }}
        >
          <FileText size={11} />
        </span>
      )}
    </div>
  );
}

function SmallStat({ kicker, value, sub }: { kicker: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card padding={14}>
      <Kicker>{kicker}</Kicker>
      <div style={{ fontSize: 22, fontWeight: 650, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}
