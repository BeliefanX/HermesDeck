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
      <div className="slash-menu" role="listbox" aria-label="Slash commands">
        <div className="slash-empty">
          No matching command
          {query && <span className="muted small"> · /{query}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="slash-menu" role="listbox" aria-label="Slash commands" ref={listRef}>
      <div className="slash-header">
        <span className="muted tiny">Slash commands · ↑↓ select · Enter confirm · Esc cancel</span>
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
            {cmd.kind === 'action' && <span className="pill ok slash-pill">action</span>}
          </button>
        );
      })}
      <button
        type="button"
        className="slash-close"
        onClick={onClose}
        onMouseDown={(e) => e.preventDefault()}
        aria-label="Close command palette"
      >
        Close
      </button>
    </div>
  );
}
