'use client';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, Settings2, X } from 'lucide-react';
import { useActiveProfile } from '@/lib/profile-context';
import { useT } from '@/lib/i18n';
import type { DeckProfile } from '@/lib/types';

const POPOVER_GAP = 6;
const POPOVER_PAD = 8;

export function ProfileChip() {
  const { activeProfile, profiles, loading, setActiveProfile } = useActiveProfile();
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  const t = useT({
    zh: {
      label: 'Agent',
      switch: '切换 Agent Profile',
      activeSuffix: ' · 当前',
      sessions: (n: number) => `${n} 个会话`,
      manage: '管理 profiles…',
      empty: '暂无可用 Agent；请联系管理员分配。',
      loading: '加载中…',
      sheetTitle: '选择 Agent Profile',
      close: '关闭',
    },
    en: {
      label: 'Agent',
      switch: 'Switch agent profile',
      activeSuffix: ' · active',
      sessions: (n: number) => `${n} session${n === 1 ? '' : 's'}`,
      manage: 'Manage profiles…',
      empty: 'No assigned Agents. Contact an admin to request access.',
      loading: 'Loading…',
      sheetTitle: 'Select agent profile',
      close: 'Close',
    },
  });

  // Detect mobile via matchMedia, kept in sync with the ≤880px breakpoint used
  // throughout the shell. We render two different popup containers so each one
  // can use its native positioning model (popover vs bottom-sheet).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 880px)');
    const sync = () => setIsMobile(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, []);

  // Close on route navigation — body scroll-lock for the bottom sheet.
  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, isMobile]);

  const activeMeta = profiles.find((p) => p.id === activeProfile);
  const displayName = activeMeta?.name || activeProfile;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="profile-chip"
        aria-label={t.switch}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t.switch}
        onClick={() => setOpen((v) => !v)}
        suppressHydrationWarning
      >
        <Bot size={14} className="profile-chip-icon" />
        <span className="profile-chip-name">{displayName}</span>
        <ChevronDown size={13} className="profile-chip-caret" />
      </button>

      {open && !isMobile && (
        <ProfilePopover
          anchor={anchorRef.current}
          profiles={profiles}
          activeProfile={activeProfile}
          loading={loading}
          onSelect={(id) => { setActiveProfile(id); setOpen(false); }}
          onClose={() => setOpen(false)}
          t={t}
        />
      )}

      {open && isMobile && (
        <ProfileSheet
          profiles={profiles}
          activeProfile={activeProfile}
          loading={loading}
          onSelect={(id) => { setActiveProfile(id); setOpen(false); }}
          onClose={() => setOpen(false)}
          t={t}
        />
      )}
    </>
  );
}

type T = ReturnType<typeof useT<{
  label: string; switch: string; activeSuffix: string; sessions: (n: number) => string;
  manage: string; empty: string; loading: string; sheetTitle: string; close: string;
}>>;

function ProfilePopover({
  anchor, profiles, activeProfile, loading, onSelect, onClose, t,
}: {
  anchor: HTMLElement | null;
  profiles: DeckProfile[];
  activeProfile: string;
  loading: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  t: T;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const compute = () => {
      const a = anchor.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const menuW = ref.current?.offsetWidth || 240;
      const menuH = ref.current?.offsetHeight || 0;
      const spaceBelow = vh - a.bottom - POPOVER_PAD;
      const spaceAbove = a.top - POPOVER_PAD;
      const flipUp = menuH > 0 && spaceBelow < menuH && spaceAbove > spaceBelow;
      const top = flipUp
        ? Math.max(POPOVER_PAD, a.top - POPOVER_GAP - Math.min(menuH, spaceAbove))
        : a.bottom + POPOVER_GAP;
      const maxH = Math.max(180, flipUp ? spaceAbove : spaceBelow);
      // Anchor on the left edge of the chip; clamp to viewport.
      const left = Math.max(POPOVER_PAD, Math.min(a.left, vw - menuW - POPOVER_PAD));
      setPos({ top, left, maxH });
    };
    compute();
    const r = requestAnimationFrame(compute);
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      cancelAnimationFrame(r);
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return;
    const onPointer = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (ref.current && ref.current.contains(target)) return;
      if (anchor.contains(target)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    const tm = window.setTimeout(() => {
      document.addEventListener('pointerdown', onPointer);
    }, 0);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(tm);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor]);

  if (!anchor) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    top: pos?.top ?? -9999,
    left: pos?.left ?? 0,
    maxHeight: pos?.maxH,
    overflowY: 'auto',
    visibility: pos ? 'visible' : 'hidden',
    minWidth: 240,
    maxWidth: 320,
  };

  return (
    <div ref={ref} className="session-menu profile-popover" role="menu" style={style}>
      <ProfileList
        profiles={profiles}
        activeProfile={activeProfile}
        loading={loading}
        onSelect={onSelect}
        t={t}
        onAfterNavigate={onClose}
      />
    </div>
  );
}

function ProfileSheet({
  profiles, activeProfile, loading, onSelect, onClose, t,
}: {
  profiles: DeckProfile[];
  activeProfile: string;
  loading: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  t: T;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="sheet-backdrop open" onClick={onClose} aria-hidden />
      <div className="sheet open profile-sheet" role="dialog" aria-label={t.sheetTitle}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>{t.sheetTitle}</h2>
          <button className="btn icon" onClick={onClose} aria-label={t.close}>
            <X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          <ProfileList
            profiles={profiles}
            activeProfile={activeProfile}
            loading={loading}
            onSelect={onSelect}
            t={t}
            onAfterNavigate={onClose}
            mobile
          />
        </div>
      </div>
    </>
  );
}

function ProfileList({
  profiles, activeProfile, loading, onSelect, t, onAfterNavigate, mobile,
}: {
  profiles: DeckProfile[];
  activeProfile: string;
  loading: boolean;
  onSelect: (id: string) => void;
  t: T;
  onAfterNavigate: () => void;
  mobile?: boolean;
}) {
  if (loading && profiles.length === 0) {
    return (
      <div style={{ padding: '14px 12px', color: 'var(--muted)', fontSize: 12.5 }}>
        {t.loading}
      </div>
    );
  }
  if (profiles.length === 0) {
    return (
      <div style={{ padding: '14px 12px', color: 'var(--muted)', fontSize: 12.5 }}>
        {t.empty}
      </div>
    );
  }
  return (
    <>
      {profiles.map((p) => {
        const active = p.id === activeProfile;
        return (
          <button
            key={p.id}
            type="button"
            className={`session-menu-item ${active ? 'active' : ''}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onSelect(p.id); }}
            style={mobile ? { minHeight: 44, padding: '10px 12px' } : undefined}
          >
            <span className="session-menu-icon">
              {active ? <Check size={13} /> : <Bot size={13} />}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
              <span style={{
                fontWeight: active ? 600 : 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {p.name}
                {p.active && <span style={{ color: 'var(--muted-2)', fontWeight: 400 }}>{t.activeSuffix}</span>}
              </span>
              <span style={{
                fontSize: 10.5,
                color: 'var(--muted-2)',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {p.model || '—'}
                {typeof p.sessionCount === 'number' && p.sessionCount > 0
                  ? ` · ${t.sessions(p.sessionCount)}`
                  : ''}
              </span>
            </span>
          </button>
        );
      })}
      <div className="session-menu-sep" />
      <Link
        href="/profiles"
        className="session-menu-item"
        onClick={(e) => { e.stopPropagation(); onAfterNavigate(); }}
        style={mobile
          ? { minHeight: 44, padding: '10px 12px', textDecoration: 'none' }
          : { textDecoration: 'none' }}
      >
        <span className="session-menu-icon"><Settings2 size={13} /></span>
        <span>{t.manage}</span>
      </Link>
    </>
  );
}
