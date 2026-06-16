'use client';
import { useEffect, useMemo, useRef } from 'react';
import { Sparkles, Zap } from 'lucide-react';
import type { SlashCommand } from '@/lib/prompts';
import { useT } from '@/lib/i18n';

interface Props {
  commands: SlashCommand[];
  query: string;
  selectedIndex: number;
  onHover: (index: number) => void;
  onPick: (cmd: SlashCommand) => void;
  onClose: () => void;
}

export function SlashCommandMenu({ commands, query, selectedIndex, onHover, onPick, onClose }: Props) {
  const t = useT({
    zh: {
      ariaList: '斜杠命令',
      ariaClose: '关闭命令面板',
      empty: '没有匹配的命令',
      header: '斜杠命令 · ↑↓ 选择 · Enter 确认 · Esc 取消',
      count: (n: number) => `共 ${n} 条命令`,
      actionPill: '动作',
      close: '关闭',
    },
    en: {
      ariaList: 'Slash commands',
      ariaClose: 'Close command palette',
      empty: 'No matching command',
      header: 'Slash commands · ↑↓ select · Enter confirm · Esc cancel',
      count: (n: number) => `${n} commands`,
      actionPill: 'action',
      close: 'Close',
    },
  });
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll the highlighted item into view when navigating with arrow keys.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const visible = useMemo(() => commands, [commands]);

  if (!visible.length) {
    return (
      <div className="slash-menu" role="listbox" aria-label={t.ariaList}>
        <div className="slash-empty">
          {t.empty}
          {query && <span className="muted small"> · /{query}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="slash-menu" role="listbox" aria-label={t.ariaList} ref={listRef}>
      <div className="slash-header">
        <span className="muted tiny">{t.header}</span>
        <span className="slash-count">{t.count(visible.length)}</span>
      </div>
      <div className="slash-list">
        {visible.map((cmd, i) => {
          const Icon = cmd.kind === 'action' ? Zap : Sparkles;
          return (
            <button
              key={cmd.key}
              type="button"
              role="option"
              aria-selected={i === selectedIndex}
              data-index={i}
              className={`slash-item ${i === selectedIndex ? 'active' : ''}`}
              onClick={(e) => { e.preventDefault(); onPick(cmd); }}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => e.preventDefault() /* keep textarea focus */}
            >
              <span className={`slash-icon ${cmd.kind}`}>
                <Icon size={13} />
              </span>
              <div className="slash-meta">
                <div className="slash-title">
                  <span className="slash-key">/{cmd.key}</span>
                  <span className="slash-label">{cmd.label}</span>
                </div>
                <div className="slash-desc">{cmd.description}</div>
              </div>
              {cmd.kind === 'action' && <span className="pill ok slash-pill">{t.actionPill}</span>}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="slash-close"
        onClick={onClose}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={t.ariaClose}
      >
        {t.close}
      </button>
    </div>
  );
}
