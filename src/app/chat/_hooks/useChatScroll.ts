'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeckMessage } from '@/lib/types';

interface ScrollParams {
  active: string;
  activeMessages: DeckMessage[];
  input: string;
  taRef: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Manages auto-scroll, sticky-bottom behavior, scroll-direction header hiding,
 * jump-to-bottom button, and the textarea auto-resize. Returns refs and state
 * the page wires into its messages container.
 *
 * Core invariant: the user's manual scroll position always wins. Once they
 * scroll up far enough that we wouldn't be near the bottom anyway, ALL of our
 * automatic scroll triggers (streaming follow, session-switch resnap timers,
 * ResizeObserver) stand down until the user scrolls back near the bottom.
 */
export function useChatScroll({ active, activeMessages, input, taRef }: ScrollParams) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  // Set when the user manually scrolled up. Hard-blocks any further automatic
  // scroll until they reach the bottom again. Distinct from stickToBottomRef
  // because programmatic scrolls (smooth animation) briefly desync the two.
  const userScrolledAwayRef = useRef(false);
  // True right after a session switch, until the first message-length change
  // brings us to the bottom — this lets us snap (no smooth animation) once
  // the async-loaded messages arrive.
  const justSwitchedRef = useRef(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  // Tracks the deadline of an in-flight programmatic smooth scroll.
  const smoothScrollUntilRef = useRef(0);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = messagesRef.current;
    if (!el) return;
    if (smooth) smoothScrollUntilRef.current = Date.now() + 700;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Detect "user scrolled away from bottom" so we don't fight them while reading.
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    let lastTop = el.scrollTop;
    // px of movement before we commit lastTop — lets slow drags accumulate.
    const MIN_DELTA = 12;
    // Real-user upward scroll detection: a single flick of the wheel/trackpad
    // moves more than this. Below it, treat as overshoot/rubber-band noise.
    const USER_SCROLL_UP_DELTA = 24;
    const onScroll = () => {
      const top = el.scrollTop;
      const distance = el.scrollHeight - top - el.clientHeight;
      const near = distance < 80;
      // Always update the "are we near the bottom" cache from the actual
      // scroll position. The userScrolledAwayRef gate below keeps automatic
      // scrollers from re-engaging just because content grew.
      stickToBottomRef.current = near;
      setShowJumpToBottom(!near && el.scrollHeight - el.clientHeight > 200);

      // While a programmatic smooth scroll (or its momentum tail on iOS) is
      // active, don't let the mid-animation scroll events flip stickToBottom
      // off — we initiated this scroll TO the bottom, so by definition we
      // still want to stick once it lands.
      if (Date.now() < smoothScrollUntilRef.current) {
        stickToBottomRef.current = true;
        userScrolledAwayRef.current = false;
        setShowJumpToBottom(false);
        lastTop = top;
        return;
      }

      const delta = top - lastTop;

      // Detect an intentional upward scroll. Once flagged, we stop ALL
      // automatic scroll triggers — streaming-follow, session-switch resnap
      // timers, ResizeObserver — until the user scrolls back near the bottom.
      if (delta < -USER_SCROLL_UP_DELTA) {
        userScrolledAwayRef.current = true;
        justSwitchedRef.current = false;
      }
      // If they're back at the bottom, re-arm everything.
      if (near) userScrolledAwayRef.current = false;

      if (Math.abs(delta) > MIN_DELTA) lastTop = top;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // Wheel / touchmove fire BEFORE the resulting scroll event, so they're the
    // earliest signal that the user wants to take over. Catching them here
    // means we abort an in-flight smooth scroll the moment the user reaches
    // for the trackpad — instead of letting our animation finish first.
    const onUserIntent = (e: Event) => {
      // Only treat upward intent as override. Downward wheel near the bottom
      // is just the user trying to follow the stream.
      if (e instanceof WheelEvent && e.deltaY < 0) {
        smoothScrollUntilRef.current = 0;
        userScrolledAwayRef.current = true;
        justSwitchedRef.current = false;
      } else if (e.type === 'touchmove') {
        // Touch drags can go either direction; kill the lockout so the next
        // scroll event can decide based on actual delta.
        smoothScrollUntilRef.current = 0;
      }
    };
    el.addEventListener('wheel', onUserIntent, { passive: true });
    el.addEventListener('touchmove', onUserIntent, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onUserIntent);
      el.removeEventListener('touchmove', onUserIntent);
    };
  }, [active]);

  // Reset stick-to-bottom whenever switching sessions; jump to bottom instantly.
  // Mark "just switched" so the next async-load of messages snaps without
  // animation, AND fires multiple delayed passes — code highlighters, KaTeX,
  // mermaid and images all extend scrollHeight well after the initial RAF.
  // We additionally watch the messages container with a ResizeObserver for the
  // first ~2s so any async layout growth re-snaps to the new bottom.
  //
  // Critically: every scheduled snap re-checks userScrolledAwayRef before
  // firing. If the user starts scrolling up during the post-switch settle
  // period, the timers/RO become no-ops instead of yanking them back down.
  useEffect(() => {
    stickToBottomRef.current = true;
    userScrolledAwayRef.current = false;
    justSwitchedRef.current = true;
    setShowJumpToBottom(false);
    requestAnimationFrame(() => {
      if (userScrolledAwayRef.current) return;
      scrollToBottom(false);
    });
    const timers = [60, 200, 500, 900, 1500].map((d) =>
      setTimeout(() => {
        if (userScrolledAwayRef.current) return;
        if (justSwitchedRef.current || stickToBottomRef.current) scrollToBottom(false);
      }, d),
    );
    const el = messagesRef.current;
    let ro: ResizeObserver | null = null;
    let stopRo = 0;
    if (el && typeof ResizeObserver !== 'undefined') {
      const localRo = new ResizeObserver(() => {
        if (userScrolledAwayRef.current) return;
        if (!justSwitchedRef.current && !stickToBottomRef.current) return;
        scrollToBottom(false);
      });
      ro = localRo;
      localRo.observe(el);
      const child = el.firstElementChild as HTMLElement | null;
      if (child) localRo.observe(child);
      stopRo = window.setTimeout(() => {
        try { localRo.disconnect(); } catch {}
        if (ro === localRo) ro = null;
        // Settle period over — the streaming-follow effect below takes over
        // and respects userScrolledAwayRef on its own.
        justSwitchedRef.current = false;
      }, 2200);
    }
    return () => {
      timers.forEach(clearTimeout);
      if (stopRo) clearTimeout(stopRo);
      try { ro?.disconnect(); } catch {}
    };
  }, [active, scrollToBottom]);

  // Smooth-follow during streaming: any time messages change AND we should
  // stick to bottom, animate to bottom on the next frame. Right after a
  // session switch, the first arrival of async-loaded messages snaps (no
  // animation) so the user lands directly on the latest content.
  //
  // userScrolledAwayRef is the hard gate — if the user has scrolled up to
  // read history mid-stream, we stay out of their way regardless of how much
  // new content arrives.
  // Sum every message's content length rather than watching only the last
  // message: tool-call / tool-result rows can land *after* the assistant text
  // bubble that's actively streaming, so a last-message-only signal would stop
  // following the stream the moment a tool row becomes the tail element.
  const streamContentSig = activeMessages.reduce((n, m) => n + (m.content ? m.content.length : 0), 0);
  useEffect(() => {
    if (userScrolledAwayRef.current) return;
    if (!stickToBottomRef.current) return;
    const snap = justSwitchedRef.current;
    if (snap) justSwitchedRef.current = false;
    requestAnimationFrame(() => {
      // Re-check inside the RAF — the user may have flicked the wheel between
      // the React commit and the next paint.
      if (userScrolledAwayRef.current) return;
      scrollToBottom(!snap);
    });
  }, [streamContentSig, activeMessages.length, scrollToBottom]);

  // Auto-resize composer. Keep this in sync with .composer .textarea max-height
  // in globals.css — overshooting CSS max-height makes the box clip mid-line.
  useEffect(() => {
    const ta = taRef.current; if (!ta) return;
    // The mobile list view hides the thread (display:none); a textarea measured
    // while hidden reports scrollHeight 0 and would be pinned to a 0-height box,
    // clipping the placeholder once shown. Skip — it keeps its natural auto
    // height until the thread becomes visible.
    if (ta.offsetParent === null) return;
    ta.style.height = 'auto';
    const cap = window.matchMedia('(max-width:880px)').matches ? 140 : 160;
    ta.style.height = Math.min(ta.scrollHeight, cap) + 'px';
  }, [input, taRef]);

  // Wrap scrollToBottom so the explicit user-facing "jump to latest" button
  // also clears the away-flag and re-arms streaming follow.
  const userScrollToBottom = useCallback((smooth = true) => {
    userScrolledAwayRef.current = false;
    stickToBottomRef.current = true;
    scrollToBottom(smooth);
  }, [scrollToBottom]);

  return {
    messagesRef,
    stickToBottomRef,
    justSwitchedRef,
    showJumpToBottom,
    scrollToBottom: userScrollToBottom,
  };
}
