'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type SlashCommand,
  applyPromptTemplate,
  extractSlashQuery,
  filterCommands,
  useLocalizedCommands,
} from '@/lib/prompts';

interface SlashRange { start: number; end: number; query: string }

interface SlashParams {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  taRef: React.RefObject<HTMLTextAreaElement | null>;
  abortRef: React.MutableRefObject<AbortController | null>;
  newChat: () => void;
  clearCurrentMessages: () => void;
  regenerate: () => void;
}

/**
 * Slash command palette state + dispatch. Owns the slash range, highlighted
 * index, filtered command list, and the apply/run helpers the composer wires
 * into its textarea handlers.
 */
export function useSlashCommand({
  input, setInput, taRef, abortRef,
  newChat, clearCurrentMessages, regenerate,
}: SlashParams) {
  const [slashRange, setSlashRange] = useState<SlashRange | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  const localizedCommands = useLocalizedCommands();
  const slashCommands = useMemo(
    () => slashRange ? filterCommands(localizedCommands, slashRange.query) : [],
    [slashRange, localizedCommands],
  );
  // Reset highlight when the filtered list shrinks past it.
  useEffect(() => {
    if (slashIdx >= slashCommands.length) setSlashIdx(0);
  }, [slashCommands.length, slashIdx]);

  // Route every action through always-current refs so a stale applySlashCommand
  // closure can't fire last-render's `regenerate` (which captured a stale
  // `messages` snapshot and would no-op).
  const newChatRef = useRef(newChat);
  const clearCurrentMessagesRef = useRef(clearCurrentMessages);
  const regenerateRef = useRef(regenerate);
  useEffect(() => { newChatRef.current = newChat; }, [newChat]);
  useEffect(() => { clearCurrentMessagesRef.current = clearCurrentMessages; }, [clearCurrentMessages]);
  useEffect(() => { regenerateRef.current = regenerate; }, [regenerate]);

  const runSlashAction = useCallback((action: 'new' | 'clear' | 'regen' | 'stop') => {
    switch (action) {
      case 'new': newChatRef.current(); break;
      case 'clear': clearCurrentMessagesRef.current(); break;
      case 'regen': regenerateRef.current(); break;
      case 'stop': abortRef.current?.abort(); break;
    }
  }, [abortRef]);

  const handleInputChange = useCallback((value: string, caret: number) => {
    setInput(value);
    const range = extractSlashQuery(value, caret);
    setSlashRange(range);
  }, [setInput]);

  const applySlashCommand = useCallback((cmd: SlashCommand) => {
    if (!slashRange) {
      // Action commands fired without an open palette — also valid path.
      if (cmd.kind === 'action') runSlashAction(cmd.action);
      setSlashRange(null);
      return;
    }
    if (cmd.kind === 'action') {
      // Strip the slash token and fire the action.
      const before = input.slice(0, slashRange.start);
      const after = input.slice(slashRange.end);
      const next = (before + after).replace(/^\s+/, '');
      setInput(next);
      setSlashRange(null);
      runSlashAction(cmd.action);
      return;
    }
    const { text: nextText, caret } = applyPromptTemplate(
      input, slashRange.start, slashRange.end, cmd.template, cmd.cursorMarker,
    );
    setInput(nextText);
    setSlashRange(null);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      // Defensive: if focus was stolen during the template apply (mobile
      // keyboard dismissal etc.), refocus before adjusting the selection so
      // the caret actually lands where we expect.
      if (document.activeElement !== ta) ta.focus();
      try { ta.setSelectionRange(caret, caret); } catch {}
    });
  }, [input, runSlashAction, setInput, slashRange, taRef]);

  return {
    slashRange, setSlashRange,
    slashIdx, setSlashIdx,
    slashCommands,
    handleInputChange, applySlashCommand,
  };
}
