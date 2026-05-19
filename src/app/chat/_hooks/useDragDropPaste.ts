'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type AttachmentItem, ingestFile } from '@/lib/attachments';

/**
 * Owns drag/drop overlay, paste-hint flash, file ingestion. The hook returns
 * the dragActive flag and the addFiles / removeAttachment / flashPasteHint
 * helpers — all stable references the composer + drop zone wire into.
 */
export function useDragDropPaste(setAttachments: React.Dispatch<React.SetStateAction<AttachmentItem[]>>) {
  const [dragActive, setDragActive] = useState(false);
  const [pasteHint, setPasteHint] = useState<string>('');
  const dragCounterRef = useRef(0);
  const pasteHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    // Push placeholders so the user sees "loading" chips immediately.
    const placeholders: AttachmentItem[] = files.map((f) => ({
      id: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: f.name || 'upload',
      mime: f.type || 'application/octet-stream',
      size: f.size,
      kind: f.type.startsWith('image/') ? 'image' : 'text',
      status: 'loading',
    }));
    setAttachments((cur) => [...cur, ...placeholders]);
    const results = await Promise.all(files.map((f) => ingestFile(f)));
    setAttachments((cur) => {
      const next = [...cur];
      placeholders.forEach((ph, i) => {
        const idx = next.findIndex((x) => x.id === ph.id);
        if (idx >= 0) next[idx] = results[i];
      });
      return next;
    });
  }, [setAttachments]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((cur) => cur.filter((x) => x.id !== id));
  }, [setAttachments]);

  const flashPasteHint = useCallback((msg: string) => {
    setPasteHint(msg);
    if (pasteHintTimer.current) clearTimeout(pasteHintTimer.current);
    pasteHintTimer.current = setTimeout(() => setPasteHint(''), 3000);
  }, []);

  // Global drag-and-drop. Use enter/leave with a counter so flickering stops
  // when the cursor crosses child boundaries inside the chat layout.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes('Files');
    // Hard reset — used whenever counter bookkeeping can't be trusted (drop,
    // drag cancelled with Esc, the cursor left the window, the window blurred).
    // Browsers routinely drop a matching `dragleave`, which would otherwise
    // leave the full-screen overlay stuck and blocking the UI.
    const reset = () => {
      dragCounterRef.current = 0;
      setDragActive(false);
    };
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounterRef.current += 1;
      setDragActive(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // relatedTarget === null means the cursor left the window entirely — the
      // counter can't be reconciled, so hard-reset instead of decrementing.
      if (e.relatedTarget === null) { reset(); return; }
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setDragActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      reset();
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) addFiles(files);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', reset);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', reset);
      window.removeEventListener('blur', reset);
    };
  }, [addFiles]);

  // Cleanup paste-hint timer on unmount.
  useEffect(() => () => {
    if (pasteHintTimer.current) clearTimeout(pasteHintTimer.current);
  }, []);

  return { dragActive, pasteHint, addFiles, removeAttachment, flashPasteHint };
}
