'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type SlashCommand,
  applyPromptTemplate,
  extractSlashQuery,
  filterVisibleSlashCommands,
  resolveSlashSubmit,
  useLocalizedSlashCommands,
} from '@/lib/slash-commands';
import type { ReasoningEffort } from './useChatModels';

interface SlashRange { start: number; end: number; query: string }

interface SlashParams {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  taRef: React.RefObject<HTMLTextAreaElement | null>;
  abortRef: React.MutableRefObject<AbortController | null>;
  newChat: () => void;
  clearCurrentMessages: () => void;
  regenerate: () => void;
  modelOptions: Array<{ id: string; provider: string; isDefault?: boolean }>;
  setSelectedModel: (v: string) => void;
  reasoningLevels: ReasoningEffort[];
  defaultReasoning: ReasoningEffort;
  reasoningTouchedRef: React.MutableRefObject<boolean>;
  setReasoningEffort: (v: ReasoningEffort) => void;
  setError: (message: string) => void;
}

function focusPicker(className: string) {
  requestAnimationFrame(() => {
    const button = document.querySelector<HTMLButtonElement>(`.${className} .composer-picker-button`);
    button?.focus();
    button?.click();
  });
}

export function useSlashCommand({
  input, setInput, taRef, abortRef,
  newChat, clearCurrentMessages, regenerate,
  modelOptions, setSelectedModel,
  reasoningLevels, defaultReasoning, reasoningTouchedRef, setReasoningEffort,
  setError,
}: SlashParams) {
  const [slashRange, setSlashRange] = useState<SlashRange | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  const localizedCommands = useLocalizedSlashCommands();
  const slashCommands = useMemo(
    () => slashRange ? filterVisibleSlashCommands(localizedCommands, slashRange.query) : [],
    [slashRange, localizedCommands],
  );
  useEffect(() => {
    if (slashIdx >= slashCommands.length) setSlashIdx(0);
  }, [slashCommands.length, slashIdx]);

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
    setSlashRange(extractSlashQuery(value, caret));
  }, [setInput]);

  const replaceInputAndCaret = useCallback((text: string, caret: number) => {
    setInput(text);
    setSlashRange(null);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      if (document.activeElement !== ta) ta.focus();
      try { ta.setSelectionRange(caret, caret); } catch {}
    });
  }, [setInput, taRef]);

  const applySlashCommand = useCallback((cmd: SlashCommand) => {
    if (!slashRange) {
      if (cmd.kind === 'local') runSlashAction(cmd.action);
      return;
    }
    if (cmd.kind === 'local') {
      const next = (input.slice(0, slashRange.start) + input.slice(slashRange.end)).replace(/^\s+/, '');
      setInput(next);
      setSlashRange(null);
      runSlashAction(cmd.action);
      return;
    }
    if (cmd.kind === 'control' || cmd.kind === 'unsupported') {
      const inserted = `/${cmd.key}${cmd.kind === 'control' ? ' ' : ''}`;
      const before = input.slice(0, slashRange.start);
      const after = input.slice(slashRange.end);
      replaceInputAndCaret(before + inserted + after, (before + inserted).length);
      if (cmd.kind === 'control') focusPicker(cmd.key === 'model' ? 'composer-model-picker' : 'composer-reasoning-picker');
      return;
    }
    const { text: nextText, caret } = applyPromptTemplate(
      input, slashRange.start, slashRange.end, cmd.template, cmd.cursorMarker,
    );
    replaceInputAndCaret(nextText, caret);
  }, [input, replaceInputAndCaret, runSlashAction, setInput, slashRange]);

  const dispatchSlashSubmit = useCallback((): boolean => {
    const result = resolveSlashSubmit(input, localizedCommands, {
      modelIds: modelOptions.map((m) => m.id),
      reasoningLevels,
      defaultReasoning,
    });
    if (!result.handled) return false;
    setSlashRange(null);
    switch (result.type) {
      case 'local':
        setInput('');
        runSlashAction(result.action);
        return true;
      case 'model':
        if (result.value) {
          setSelectedModel(result.value);
          setError(`Model set to ${result.value}`);
          setInput('');
        } else {
          setError(result.error || 'Usage: /model <model-id>');
          setInput('/model ');
          focusPicker('composer-model-picker');
        }
        return true;
      case 'reasoning':
        if (result.value !== undefined) {
          reasoningTouchedRef.current = true;
          setReasoningEffort(result.value);
          setError(result.mode === 'reset' ? 'Reasoning reset to Agent default' : `Reasoning set to ${result.value || 'Agent default'}`);
          setInput('');
        } else {
          setError(result.error || 'This reasoning view command is recognized but not supported in HermesDeck yet.');
          setInput(result.mode === 'view-toggle' ? '' : '/reasoning ');
          if (result.mode !== 'view-toggle') focusPicker('composer-reasoning-picker');
        }
        return true;
      case 'unsupported':
        setError(result.message);
        setInput('');
        return true;
      case 'snippet':
        replaceInputAndCaret(result.text, result.caret);
        return true;
    }
  }, [defaultReasoning, input, localizedCommands, modelOptions, reasoningLevels, reasoningTouchedRef, replaceInputAndCaret, runSlashAction, setError, setInput, setReasoningEffort, setSelectedModel]);

  return {
    slashRange, setSlashRange,
    slashIdx, setSlashIdx,
    slashCommands,
    handleInputChange, applySlashCommand, dispatchSlashSubmit,
  };
}
