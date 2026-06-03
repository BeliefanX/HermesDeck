'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { deckApi } from '@/lib/api';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export const REASONING_LEVELS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

interface ModelOption { id: string; provider: string; isDefault?: boolean }

/**
 * Loads the model catalog + default reasoning effort for the active profile.
 * Owns the composer's per-turn overrides — selectedModel, reasoningEffort.
 * On profile change resets selectedModel and re-derives the default pick.
 */
export function useChatModels(profile: string) {
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModelState] = useState<string>('');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium');
  const [defaultReasoning, setDefaultReasoning] = useState<ReasoningEffort>('medium');
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

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    // Profile changed — discard any per-turn override the user had set on the
    // previous profile. Each profile may have a different recommended floor
    // (e.g. "high" for a research profile, "minimal" for a quick-chat one),
    // so leaking the last value across profiles confuses users.
    reasoningTouchedRef.current = false;
    // Reset selectedModel whenever profile changes so the new profile's
    // catalog gets a fresh "first available" pick, instead of carrying
    // over a stale id that the new profile may not advertise.
    setSelectedModelState('');
    setModelOptions([]);
    optionsRef.current = [];
    if (!profile) return;
    Promise.allSettled([
      deckApi.models(profile, ac.signal),
      deckApi.modelPreference(profile, ac.signal),
    ])
      .then(([modelsResult, preferenceResult]) => {
        if (!alive) return;
        if (modelsResult.status !== 'fulfilled') return;
        const r = modelsResult.value;
        const seen = new Map<string, ModelOption>();
        for (const p of r.providers) {
          for (const mm of p.models) {
            if (!mm.available && !mm.used) continue;
            const existing = seen.get(mm.id);
            if (!existing || (mm.isDefault && !existing.isDefault)) {
              seen.set(mm.id, { id: mm.id, provider: p.name || p.id, isDefault: mm.isDefault });
            }
          }
        }
        const flat = Array.from(seen.values());
        optionsRef.current = flat;
        setModelOptions(flat);
        const def = flat.find((m) => m.isDefault) || flat[0];
        const storedModel = preferenceResult.status === 'fulfilled'
          ? preferenceResult.value.preference?.modelId
          : undefined;
        const stored = storedModel ? flat.find((m) => m.id === storedModel) : undefined;
        if (stored || def) setSelectedModelState((stored || def)!.id);
        const cfg = (r.reasoningEffort || '').toLowerCase();
        const resolved: ReasoningEffort = (REASONING_LEVELS as string[]).includes(cfg)
          ? (cfg as ReasoningEffort)
          : 'medium';
        setDefaultReasoning(resolved);
        // Always snap reasoning to the new profile's default. We just cleared
        // reasoningTouchedRef above, so this is unconditional — keeps the
        // dropdown in lockstep with the profile.
        setReasoningEffort(resolved);
      })
      .catch(() => { /* selector falls back to profile default */ });
    return () => { alive = false; ac.abort(); };
  }, [profile]);

  return {
    modelOptions, selectedModel, setSelectedModel,
    reasoningEffort, setReasoningEffort,
    defaultReasoning, reasoningTouchedRef,
  };
}
