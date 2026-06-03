'use client';
import { useState } from 'react';
import { ListPlus, Paperclip, Pause, Pencil, Play, Send, Target, X } from 'lucide-react';
import { Btn, Tag } from '@/components/Brand';
import { AttachmentChip } from '@/components/AttachmentChip';
import { SlashCommandMenu } from '@/components/SlashCommandMenu';
import {
  type AttachmentItem,
  ingestPastedText,
  SMART_PASTE_THRESHOLD,
} from '@/lib/attachments';
import { type SlashCommand, extractSlashQuery } from '@/lib/prompts';
import type { ChatT } from '../_lib/i18n';
import type { UseGoalAndQueueResult } from '../_hooks/useGoalAndQueue';
import { ComposerPicker, iconBtnStyle } from './InlineParts';

type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export function ChatComposer({
  t, busy, input, attachments, taRef, fileInputRef,
  slashRange, slashCommands, slashIdx, pasteHint,
  modelOptions, selectedModel, reasoningEffort, defaultReasoning, reasoningLevels,
  reasoningTouchedRef,
  setSlashIdx, setSlashRange, setAttachments, setSelectedModel, setReasoningEffort,
  removeAttachment, addFiles, flashPasteHint, applySlashCommand,
  handleInputChange, send, goalAndQueue,
}: {
  t: ChatT;
  busy: boolean;
  input: string;
  attachments: AttachmentItem[];
  taRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  slashRange: { start: number; end: number; query: string } | null;
  slashCommands: SlashCommand[];
  slashIdx: number;
  pasteHint: string;
  modelOptions: Array<{ id: string; provider: string; isDefault?: boolean }>;
  selectedModel: string;
  reasoningEffort: ReasoningEffort;
  defaultReasoning: ReasoningEffort;
  reasoningLevels: ReasoningEffort[];
  reasoningTouchedRef: React.MutableRefObject<boolean>;
  setSlashIdx: React.Dispatch<React.SetStateAction<number>>;
  setSlashRange: (r: { start: number; end: number; query: string } | null) => void;
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentItem[]>>;
  setSelectedModel: (v: string) => void;
  setReasoningEffort: (v: ReasoningEffort) => void;
  removeAttachment: (id: string) => void;
  addFiles: (files: File[]) => Promise<void>;
  flashPasteHint: (msg: string) => void;
  applySlashCommand: (cmd: SlashCommand) => void;
  handleInputChange: (value: string, caret: number) => void;
  send: (override?: string) => void | Promise<void>;
  goalAndQueue: UseGoalAndQueueResult;
}) {
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');
  const { goal, goalActive, queue, enqueue, removeQueued, clearQueue, setGoal, pauseGoal, resumeGoal, clearGoal } = goalAndQueue;
  return (
    <div
      className="composer composer-flat"
      style={{
        borderTop: '1px solid var(--hairline)',
        padding: '8px 12px 10px',
        background: 'var(--panel)',
        flexShrink: 0,
      }}
    >
      {(goal || queue.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
          {goal && !goalEditing && (
            <div
              className="composer-goal-chip"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px',
                borderRadius: 8,
                background: goalActive ? 'rgba(56,189,248,.08)' : 'var(--bg-soft)',
                border: `1px solid ${goalActive ? 'var(--accent-border)' : 'var(--hairline)'}`,
                fontSize: 12,
                color: 'var(--text)',
              }}
            >
              <Target size={12} style={{ color: goalActive ? 'var(--accent)' : 'var(--muted)', flexShrink: 0 }} />
              <span style={{
                color: goalActive ? 'var(--strong-text)' : 'var(--muted)',
                fontFamily: 'var(--font-sans)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0,
              }}>{goal.text}</span>
              {!goalActive && <Tag variant="default">{t.goalPaused}</Tag>}
              <button
                type="button"
                onClick={() => { setGoalDraft(goal.text); setGoalEditing(true); }}
                title={t.goalEdit}
                aria-label={t.goalEdit}
                style={{ ...iconBtnStyle, height: 22, width: 22 }}
              >
                <Pencil size={11} />
              </button>
              <button
                type="button"
                onClick={() => (goalActive ? pauseGoal() : resumeGoal())}
                title={goalActive ? t.goalPause : t.goalResume}
                aria-label={goalActive ? t.goalPause : t.goalResume}
                style={{ ...iconBtnStyle, height: 22, width: 22 }}
              >
                {goalActive ? <Pause size={11} /> : <Play size={11} />}
              </button>
              <button
                type="button"
                onClick={clearGoal}
                title={t.goalClear}
                aria-label={t.goalClear}
                style={{ ...iconBtnStyle, height: 22, width: 22 }}
              >
                <X size={11} />
              </button>
            </div>
          )}
          {goalEditing && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: 6,
              borderRadius: 8,
              background: 'var(--bg-soft)',
              border: '1px solid var(--accent-border)',
            }}>
              <Target size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <input
                autoFocus
                type="text"
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
                placeholder={t.goalPlaceholder}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (goalDraft.trim()) {
                      setGoal(goalDraft);
                      setGoalEditing(false);
                    }
                  } else if (e.key === 'Escape') {
                    setGoalEditing(false);
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 24,
                  padding: '0 8px',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                  background: 'var(--panel)',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
              <Btn
                size="sm"
                variant="primary"
                disabled={!goalDraft.trim()}
                onClick={() => { if (goalDraft.trim()) { setGoal(goalDraft); setGoalEditing(false); } }}
              >{t.goalSave}</Btn>
              <Btn size="sm" variant="ghost" onClick={() => setGoalEditing(false)}>{t.goalCancel}</Btn>
            </div>
          )}
          {queue.length > 0 && (
            <div
              role="list"
              aria-label={t.queueLabel}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}
            >
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--muted-2)',
                textTransform: 'uppercase',
                letterSpacing: '.1em',
                marginRight: 4,
              }}>{t.queueHint(queue.length)}</span>
              {queue.map((q, idx) => (
                <span
                  key={q.id}
                  role="listitem"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 6px 2px 8px',
                    borderRadius: 6,
                    background: 'var(--panel)',
                    border: '1px solid var(--hairline)',
                    fontSize: 11,
                    color: 'var(--muted)',
                    maxWidth: 220,
                  }}
                  title={q.text}
                >
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9.5,
                    color: 'var(--muted-2)',
                    flexShrink: 0,
                  }}>#{idx + 1}</span>
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>{q.text}</span>
                  <button
                    type="button"
                    onClick={() => removeQueued(q.id)}
                    aria-label={t.queueRemove}
                    style={{
                      background: 'transparent',
                      border: 0,
                      color: 'var(--muted-2)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'inline-flex',
                    }}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              {queue.length > 1 && (
                <button
                  type="button"
                  onClick={clearQueue}
                  style={{
                    background: 'transparent',
                    border: 0,
                    color: 'var(--muted-2)',
                    cursor: 'pointer',
                    fontSize: 10.5,
                    fontFamily: 'var(--font-mono)',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >{t.queueClear}</button>
              )}
            </div>
          )}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="composer-atts" role="list" aria-label={t.pendingAttachments} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {attachments.map((a) => (
            <AttachmentChip key={a.id} item={a} onRemove={() => removeAttachment(a.id)} />
          ))}
        </div>
      )}
      <div
        className="composer-row composer-row-stack"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 4,
          padding: '6px 8px',
          background: 'var(--bg-soft)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          width: '100%',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          accept="image/*,.pdf,.docx,.txt,.md,.markdown,.mdx,.json,.jsonc,.yaml,.yml,.toml,.ini,.env,.csv,.tsv,.log,.html,.htm,.xml,.svg,.css,.scss,.sass,.less,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.swift,.cpp,.c,.h,.hpp,.cs,.php,.sh,.bash,.zsh,.sql,.graphql,.proto,.vue,.svelte,.astro"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) addFiles(files);
            e.target.value = '';
          }}
        />
        <div className="composer-textarea-wrap" style={{ position: 'relative', minWidth: 0 }}>
          {slashRange && (
            <SlashCommandMenu
              commands={slashCommands}
              query={slashRange.query}
              selectedIndex={slashIdx}
              onHover={setSlashIdx}
              onPick={(cmd) => applySlashCommand(cmd)}
              onClose={() => setSlashRange(null)}
            />
          )}
          <textarea
            ref={taRef}
            className="textarea"
            placeholder={t.composerPlaceholder}
            style={{
              width: '100%',
              resize: 'none',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text)',
              fontFamily: 'var(--font-sans)',
              fontSize: 14,
              lineHeight: 1.55,
              minHeight: 22,
            }}
            value={input}
            onChange={(e) => handleInputChange(e.target.value, e.target.selectionStart ?? 0)}
            onSelect={(e) => {
              const ta = e.target as HTMLTextAreaElement;
              setSlashRange(extractSlashQuery(ta.value, ta.selectionStart ?? 0));
            }}
            onFocus={() => {
              // On mobile, the OS keyboard takes a big chunk of the screen.
              // Tag <html> so the bottom nav can slide out of the way until blur.
              if (typeof document !== 'undefined') {
                document.documentElement.dataset.composerFocus = '1';
              }
            }}
            onBlur={() => {
              // Close on blur after the click handler has had a chance to fire
              setTimeout(() => setSlashRange(null), 120);
              if (typeof document !== 'undefined') {
                delete document.documentElement.dataset.composerFocus;
              }
            }}
            onPaste={(e) => {
              const cd = e.clipboardData;
              if (!cd) return;
              const files = Array.from(cd.files || []);
              if (files.length) {
                e.preventDefault();
                addFiles(files);
                flashPasteHint(t.pasteAddedFiles(files.length));
                return;
              }
              const text = cd.getData('text/plain');
              if (text && text.length >= SMART_PASTE_THRESHOLD) {
                e.preventDefault();
                const att = ingestPastedText(text);
                setAttachments((cur) => [...cur, att]);
                flashPasteHint(t.pasteLong(text.length));
              }
            }}
            onKeyDown={(e) => {
              // Slash menu navigation takes priority while open.
              if (slashRange) {
                if (slashCommands.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSlashIdx((i) => (i + 1) % slashCommands.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlashIdx((i) => (i - 1 + slashCommands.length) % slashCommands.length);
                    return;
                  }
                  if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    const cmd = slashCommands[slashIdx];
                    if (cmd) applySlashCommand(cmd);
                    return;
                  }
                }
                // Escape always closes the menu, even with no matches.
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setSlashRange(null);
                  return;
                }
                // Tab with no matches falls through — close the menu and let
                // the browser move focus naturally so the user isn't trapped.
                if (e.key === 'Tab' && !slashCommands.length) {
                  setSlashRange(null);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                // Always dismiss the slash menu on Send — otherwise it lingers
                // briefly while the textarea clears, which looks broken.
                if (slashRange) setSlashRange(null);
                send();
              }
            }}
            rows={1}
            aria-label={t.messageComposer}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label={t.addAttachment}
            title={t.addAttachmentTitle}
            disabled={busy}
            style={iconBtnStyle}
          >
            <Paperclip size={13} />
          </button>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <ComposerPicker
              label={t.modelLabel}
              title={t.modelTitle}
              value={selectedModel}
              disabled={modelOptions.length === 0}
              placeholder={t.profileDefault}
              options={modelOptions.map((m) => ({ value: m.id, label: m.id, isDefault: m.isDefault }))}
              onChange={(v) => setSelectedModel(v)}
              defaultTagLabel={t.defaultTag}
            />
            <ComposerPicker
              label={t.reasoningLabel}
              title={t.reasoningTitle}
              value={reasoningEffort}
              options={reasoningLevels.map((level) => ({
                value: level,
                label: level,
                isDefault: level === defaultReasoning,
              }))}
              onChange={(v) => {
                reasoningTouchedRef.current = true;
                setReasoningEffort(v as ReasoningEffort);
              }}
              defaultTagLabel={t.defaultTag}
            />
          </div>
          <Btn
            variant="ghost"
            size="sm"
            icon={<ListPlus size={12} />}
            onClick={() => {
              if (slashRange) setSlashRange(null);
              enqueue();
            }}
            disabled={!input.trim()}
            // Always enabled when there's input — queueing during a busy turn
            // is the whole point. Disabling on busy would defeat the feature.
          >
            {t.queueLabel}
          </Btn>
          <Btn
            variant="primary"
            size="sm"
            icon={<Send size={12} />}
            onClick={() => {
              if (slashRange) setSlashRange(null);
              send();
            }}
            disabled={busy || !input.trim()}
          >
            {t.send}
          </Btn>
        </div>
      </div>
      {pasteHint && (
        <div
          className="composer-hint"
          role="status"
          aria-live="polite"
          style={{ marginTop: 6, fontSize: 11, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}
        >
          {pasteHint}
        </div>
      )}
    </div>
  );
}
