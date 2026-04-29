'use client';
import { useEffect, useMemo, useRef } from 'react';
import { Sparkles, Zap } from 'lucide-react';
import type { SlashCommand } from '@/lib/prompts';

interface Props {
  commands: SlashCommand[];
  query: string;
  selectedIndex: number;
  onHover: (index: number) => void;
  onPick: (cmd: SlashCommand) => void;
  onClose: () => void;
}

export function SlashCommandMenu({ commands, query, selectedIndex, onHover, onPick, onClose }: Props) {
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
      <div className="slash-menu" role="listbox" aria-label="斜杠命令">
        <div className="slash-empty">
          没有匹配的命令
          {query && <span className="muted small"> · /{query}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="slash-menu" role="listbox" aria-label="斜杠命令" ref={listRef}>
      <div className="slash-header">
        <span className="muted tiny">斜杠命令 · ↑↓ 选择 · Enter 确认 · Esc 取消</span>
      </div>
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
            {cmd.kind === 'action' && <span className="pill ok slash-pill">动作</span>}
          </button>
        );
      })}
      <button
        type="button"
        className="slash-close"
        onClick={onClose}
        onMouseDown={(e) => e.preventDefault()}
        aria-label="关闭命令面板"
      >
        关闭
      </button>
    </div>
  );
}
