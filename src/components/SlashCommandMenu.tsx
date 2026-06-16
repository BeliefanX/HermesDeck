'use client';
import { useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, Bot, Command, SlidersHorizontal, Sparkles, Zap } from 'lucide-react';
import type { SlashCommand } from '@/lib/slash-commands';
import { useT } from '@/lib/i18n';

interface Props {
  commands: SlashCommand[];
  query: string;
  selectedIndex: number;
  onHover: (index: number) => void;
  onPick: (cmd: SlashCommand) => void;
  onClose: () => void;
}

function iconFor(kind: SlashCommand['kind']) {
  if (kind === 'local') return Zap;
  if (kind === 'control') return SlidersHorizontal;
  if (kind === 'unsupported') return AlertTriangle;
  if (kind === 'snippet') return Sparkles;
  return Command;
}

export function SlashCommandMenu({ commands, query, selectedIndex, onHover, onPick, onClose }: Props) {
  const t = useT({
    zh: {
      ariaList: '斜杠命令', ariaClose: '关闭命令面板', empty: '没有匹配的命令',
      header: 'Telegram-like slash commands · ↑↓ 选择 · Enter 插入/执行 · Esc 取消',
      count: (n: number) => `共 ${n} 条`, close: '关闭',
      local: '本地', control: '控制', unsupported: 'Telegram', snippet: 'Prompt snippet', alias: '别名',
    },
    en: {
      ariaList: 'Slash commands', ariaClose: 'Close command palette', empty: 'No matching command',
      header: 'Telegram-like slash commands · ↑↓ select · Enter insert/run · Esc cancel',
      count: (n: number) => `${n} items`, close: 'Close',
      local: 'local', control: 'control', unsupported: 'Telegram', snippet: 'Prompt snippet', alias: 'aliases',
    },
  });
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const visible = useMemo(() => commands, [commands]);
  const pill = (cmd: SlashCommand) => cmd.kind === 'local' ? t.local : cmd.kind === 'control' ? t.control : cmd.kind === 'unsupported' ? t.unsupported : t.snippet;

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
          const Icon = iconFor(cmd.kind);
          return (
            <button
              key={`${cmd.kind}-${cmd.key}`}
              type="button"
              role="option"
              aria-selected={i === selectedIndex}
              data-index={i}
              className={`slash-item ${cmd.kind} ${i === selectedIndex ? 'active' : ''}`}
              onClick={(e) => { e.preventDefault(); onPick(cmd); }}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => e.preventDefault()}
            >
              <span className={`slash-icon ${cmd.kind}`}>
                <Icon size={13} />
              </span>
              <div className="slash-meta">
                <div className="slash-title">
                  <span className="slash-key">/{cmd.key}</span>
                  {cmd.argHint && <span className="slash-arg">{cmd.argHint}</span>}
                  <span className="slash-label">{cmd.label}</span>
                </div>
                <div className="slash-desc">
                  <Bot size={11} aria-hidden="true" />
                  <span>{cmd.description}</span>
                  {cmd.aliases?.length ? <span className="slash-alias"> · {t.alias}: {cmd.aliases.map((a) => `/${a}`).join(', ')}</span> : null}
                </div>
              </div>
              <span className={`pill slash-pill slash-pill-${cmd.kind}`}>{pill(cmd)}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="slash-close" onClick={onClose} onMouseDown={(e) => e.preventDefault()} aria-label={t.ariaClose}>
        {t.close}
      </button>
    </div>
  );
}
