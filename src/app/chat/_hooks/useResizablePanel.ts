'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// Resizing only makes sense at the desktop breakpoint where the side panels are
// visible. Below this width the layout collapses to fixed/single-column rules
// in globals.css and an inline width override would fight the media query.
const DESKTOP_QUERY = '(min-width: 1421px)';

export interface ResizablePanelOptions {
  /** Which edge the drag handle sits on — flips the drag/key direction. */
  side: 'left' | 'right';
  storageKey: string;
  defaultW: number;
  minW: number;
  maxW: number;
}

/**
 * Drives a user-resizable side panel. The chat layout reads panel widths from
 * CSS custom properties, so the caller applies the returned `width` as an
 * inline `--sessions-w` / `--right-w` override. Used once per resizable panel.
 */
export function useResizablePanel({ side, storageKey, defaultW, minW, maxW }: ResizablePanelOptions) {
  const [width, setWidth] = useState<number>(defaultW);
  const [isDesktop, setIsDesktop] = useState<boolean>(false);
  const [dragging, setDragging] = useState<boolean>(false);
  // widthRef mirrors state so the drag handlers (closed over once at
  // pointerdown) always read the freshest width on mouseup persist.
  const widthRef = useRef<number>(defaultW);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  // A left panel widens as the pointer moves right (+1); a right panel widens
  // as the pointer moves left (-1).
  const dirSign = side === 'left' ? 1 : -1;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n >= minW && n <= maxW) {
          widthRef.current = n;
          setWidth(n);
        }
      }
    } catch {
      /* localStorage unavailable — fall back to default */
    }

    const mq = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [storageKey, minW, maxW]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragCleanupRef.current?.();
    const startX = e.clientX;
    const startW = widthRef.current;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    setDragging(true);

    const onMove = (ev: MouseEvent) => {
      const next = Math.max(minW, Math.min(maxW, startW + dirSign * (ev.clientX - startX)));
      if (next === widthRef.current) return;
      widthRef.current = next;
      setWidth(next);
    };
    const cleanupDrag = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      setDragging(false);
      dragCleanupRef.current = null;
    };
    const onUp = () => {
      cleanupDrag();
      try { localStorage.setItem(storageKey, String(widthRef.current)); } catch { /* quota / disabled */ }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    // Suppress text selection and pin the cursor while dragging — without this
    // the browser highlights message text under the pointer mid-drag.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    dragCleanupRef.current = cleanupDrag;
  }, [dirSign, minW, maxW, storageKey]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const onResizerKeyDown = useCallback((e: React.KeyboardEvent) => {
    let delta = 0;
    if (e.key === 'ArrowLeft') delta = -16 * dirSign;
    else if (e.key === 'ArrowRight') delta = 16 * dirSign;
    else if (e.key === 'Home') delta = minW - widthRef.current;
    else if (e.key === 'End') delta = maxW - widthRef.current;
    else return;
    e.preventDefault();
    const next = Math.max(minW, Math.min(maxW, widthRef.current + delta));
    widthRef.current = next;
    setWidth(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* quota / disabled */ }
  }, [dirSign, minW, maxW, storageKey]);

  return { width, startResize, onResizerKeyDown, isDesktop, dragging, minW, maxW };
}
