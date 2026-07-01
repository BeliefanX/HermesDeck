'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { deckApi } from '@/lib/api';

export type ReasoningEffort = string;
export const REASONING_LEVELS: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

interface ModelOption { id: string; provider: string; isDefault?: boolean }

/**
 * Loads the model catalog + default reasoning effort for the active profile.
 * Owns the composer's per-turn overrides — selectedModel, reasoningEffort.
 * On profile change resets selectedModel and re-derives the profile's effective pick.
 */
export function useChatModels(profile: string) {
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModelState] = useState<string>('');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('');
  const [defaultReasoning, setDefaultReasoning] = useState<ReasoningEffort>('');
  const [reasoningLevels, setReasoningLevels] = useState<ReasoningEffort[]>(REASONING_LEVELS);
  const reasoningTouchedRef = useRef(false);
  const optionsRef = useRef<ModelOption[]>([]);

  const setSelectedModel = useCallback((nextModel: string) => {
    setSelectedModelState(nextModel);
    if (!profile) return;
    const match = optionsRef.current.find((option) => option.id === nextModel);
    deckApi.saveModelPreference(profile, {
      modelId: nextModel || undefined,
      modelProvider: match?.provider,
    }).catch(() => { /* keep local UI responsive; stream route can still use current selection */ });
  }, [profile]);

  const setObservedModel = useCallback((modelId: string, provider = 'observed') => {
    const id = modelId.trim();
    if (!id) return;
    setModelOptions((cur) => {
      if (cur.some((option) => option.id === id)) return cur;
      const next = [...cur, { id, provider }];
      optionsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    // Profile changed — discard any per-turn override the user had set on the
    // previous profile. Each profile may have a different recommended floor
    // (e.g. "high" for a research profile, "minimal" for a quick-chat one),
    // so leaking the last value across profiles confuses users.
    reasoningTouchedRef.current = false;
    // Reset selectedModel whenever profile changes so the new profile's
    // effective config gets a fresh pick instead of carrying over a stale id.
    setSelectedModelState('');
    setModelOptions([]);
    setReasoningEffort('');
    setDefaultReasoning('');
    setReasoningLevels(REASONING_LEVELS);
    optionsRef.current = [];
    if (!profile) return;
    Promise.all([
      deckApi.models(profile, ac.signal),
      deckApi.modelPreference(profile, ac.signal).catch(() => null),
    ])
      .then(([r, pref]) => {
        if (!alive) return;
        const seen = new Map<string, ModelOption>();
        for (const p of r.providers) {
          for (const mm of p.models) {
            if (!mm.available && !mm.used) continue;
            const existing = seen.get(mm.id);
            if (!existing || (mm.isDefault && !existing.isDefault)) {
              seen.set(mm.id, { id: mm.id, provider: p.id, isDefault: mm.isDefault });
            }
          }
        }
        const flat = Array.from(seen.values());
        optionsRef.current = flat;
        setModelOptions(flat);
        const saved = pref?.preference?.modelId
          ? flat.find((m) => m.id === pref.preference?.modelId)
          : undefined;
        const def = saved
          || (r.default?.model ? flat.find((m) => m.id === r.default?.model) : undefined)
          || flat.find((m) => m.isDefault)
          || flat[0];
        if (def) setSelectedModelState(def.id);

        const cfg = (r.reasoningEffort || '').trim().toLowerCase();
        const levels = Array.from(new Set([...(r.reasoningLevels || []), ...REASONING_LEVELS, cfg]
          .map((level) => level.trim().toLowerCase())
          .filter((level) => Boolean(level) && level !== 'auto')));
        // Missing/"auto" is not a resolved runtime value. Show an unknown
        // baseline instead of inventing a hard-coded Hermes default.
        const resolved: ReasoningEffort = cfg && cfg !== 'auto' ? cfg : '';
        const nextLevels = resolved && !levels.includes(resolved) ? [...levels, resolved] : levels;
        setReasoningLevels(nextLevels);
        setDefaultReasoning(resolved);
        // Always snap reasoning to the new profile's effective config. We just
        // cleared reasoningTouchedRef above, so this is unconditional — keeps
        // the dropdown in lockstep with the selected profile.
        setReasoningEffort(resolved);
      })
      .catch(() => {
        if (!alive) return;
        // Hermes Agent can legitimately hide provider/model metadata from Deck.
        // Keep the composer explicit and compact without inventing a model
        // override that would be sent upstream.
        setModelOptions([]);
        optionsRef.current = [];
        setSelectedModelState('');
        setReasoningLevels(REASONING_LEVELS);
        setDefaultReasoning('');
        setReasoningEffort('');
      });
    return () => { alive = false; ac.abort(); };
  }, [profile]);

  return {
    modelOptions, selectedModel, setSelectedModel, setObservedModel,
    reasoningEffort, setReasoningEffort,
    defaultReasoning, reasoningLevels, reasoningTouchedRef,
  };
}
