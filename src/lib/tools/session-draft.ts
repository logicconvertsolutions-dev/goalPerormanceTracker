// Calculator inputs remembered for this browser tab (P39), so leaving a
// Tools page and coming back through the sidebar's bare URL doesn't lose
// what was typed.
//
// sessionStorage, not localStorage: these are often a client's income and
// savings figures, so they must not outlive the tab on a shared computer —
// and the login form wipes them on every arrival at /login (sign-out,
// sign-out-everywhere, expired session). Nothing here is ever sent to the
// server. For the calculators, what's stored is their own serialized query
// string, so the URL stays the single source of truth and the same Zod
// parser reads both. The Client Snapshot (P43) is the exception: it holds
// names and dates of birth, so it stores JSON here and never touches the
// URL (lib/snapshot/form.ts). Every read and write is guarded: storage can throw in a private
// window or when blocked, and the calculator then simply starts blank.

export type ToolKey = 'tax' | 'investment' | 'snapshot';

const PREFIX = 'kautis.tools.';
const TOOLS: ToolKey[] = ['tax', 'investment', 'snapshot'];

export function loadDraft(tool: ToolKey): string | null {
  try {
    return sessionStorage.getItem(PREFIX + tool);
  } catch {
    return null;
  }
}

/** An empty query (all defaults) removes the draft rather than storing "". */
export function saveDraft(tool: ToolKey, query: string): void {
  try {
    if (query) sessionStorage.setItem(PREFIX + tool, query);
    else sessionStorage.removeItem(PREFIX + tool);
  } catch {
    // Storage unavailable: inputs just won't survive navigation this time.
  }
}

export function clearDraft(tool: ToolKey): void {
  saveDraft(tool, '');
}

export function clearAllToolDrafts(): void {
  for (const tool of TOOLS) clearDraft(tool);
}
