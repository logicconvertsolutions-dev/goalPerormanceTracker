'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { loadDraft, saveDraft, type ToolKey } from './session-draft';

const SYNC_DELAY_MS = 400;

/**
 * Keeps a calculator's inputs in the URL (bookmarkable) and in this tab's
 * sessionStorage (survives leaving and coming back via the bare sidebar
 * link). `query` is the calculator's serialized, defaults-omitted query
 * string; `onRestore` applies a saved one.
 *
 * Restore runs once on mount and only when the URL carries no params of its
 * own — an explicit link wins over the draft. Saving is held back until
 * that has happened, otherwise the blank first render would overwrite the
 * draft before it could be read.
 */
export function useSessionDraft(tool: ToolKey, query: string, onRestore: (query: string) => void) {
  const pathname = usePathname();
  const [restored, setRestored] = useState(false);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  useEffect(() => {
    if (!window.location.search) {
      const saved = loadDraft(tool);
      if (saved) onRestoreRef.current(saved);
    }
    setRestored(true);
  }, [tool]);

  // replaceState rather than router.replace: no server round trip and no
  // history entry per keystroke — the URL just tracks the current scenario.
  useEffect(() => {
    if (!restored) return;
    const handle = window.setTimeout(() => {
      window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
      saveDraft(tool, query);
    }, SYNC_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [tool, query, pathname, restored]);
}
