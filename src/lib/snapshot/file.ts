import { defaultForm, parseFormValue, type SnapshotForm, type SnapshotMeta } from './form';
import type { Summary } from './types';

/*
 * A Client Snapshot saved as a file (P43b), so the agent can keep it in the
 * client's folder and open it again later to update. The file goes from the
 * browser straight to the agent's own device and back — never the server.
 * The printed PDF is the human-readable copy; this file is for reopening.
 */

export const FILE_KIND = 'kautis.client-snapshot';
export const FILE_SCHEMA = 1;
export const MAX_FILE_BYTES = 1_000_000;

export interface SnapshotFile {
  kind: typeof FILE_KIND;
  schema: typeof FILE_SCHEMA;
  version: number;
  savedAt: string;
  client: string;
  form: SnapshotForm;
  /** Informational only — reopening always recomputes from `form`. */
  summary: Pick<Summary, 'totalNetIncome' | 'netAfterSavings' | 'totalExpenses' | 'balance' | 'netWorth'>;
}

/** FNV-1a over the form's JSON: cheap change detection, not security. */
export function hashForm(form: SnapshotForm): string {
  const json = JSON.stringify(form);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function isBlank(form: SnapshotForm): boolean {
  return JSON.stringify(form) === JSON.stringify(defaultForm());
}

/** Changes the agent hasn't put in a file yet (an untouched form never counts). */
export function hasUnsavedChanges(form: SnapshotForm, meta: SnapshotMeta): boolean {
  if (meta.version === 0) return !isBlank(form);
  return hashForm(form) !== meta.savedHash;
}

/** "Asha Patel", "2026-11-01", 3 -> "Asha-Patel_2026-11-01_v3.json" */
export function snapshotFilename(clientName: string, isoDate: string, version: number): string {
  const name =
    clientName
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'Client';
  return `${name}_${isoDate}_v${version}.json`;
}

/**
 * Builds the file for a download. The version only goes up when something
 * changed since the last download/open — saving twice gives the same vN.
 */
export function buildSnapshotFile(
  form: SnapshotForm,
  meta: SnapshotMeta,
  summary: Summary,
  now: Date,
  localIsoDate: string
): { filename: string; json: string; meta: SnapshotMeta } {
  const hash = hashForm(form);
  const unchanged = meta.version > 0 && hash === meta.savedHash;
  const version = unchanged ? meta.version : meta.version + 1;
  const savedAt = unchanged ? meta.savedAt : now.toISOString();
  const file: SnapshotFile = {
    kind: FILE_KIND,
    schema: FILE_SCHEMA,
    version,
    savedAt,
    client: form.client.name.trim(),
    form,
    summary: {
      totalNetIncome: summary.totalNetIncome,
      netAfterSavings: summary.netAfterSavings,
      totalExpenses: summary.totalExpenses,
      balance: summary.balance,
      netWorth: summary.netWorth,
    },
  };
  return {
    filename: snapshotFilename(form.client.name, localIsoDate, version),
    json: JSON.stringify(file, null, 2),
    meta: { version, savedAt, savedHash: hash },
  };
}

export type ParsedSnapshot =
  | { ok: true; form: SnapshotForm; meta: SnapshotMeta }
  | { ok: false; error: string };

const NOT_A_SNAPSHOT = "This isn't a Kautis client snapshot file.";

/** Reads an uploaded file's text back into a form, or explains why it can't. */
export function parseSnapshotFile(text: string): ParsedSnapshot {
  if (text.length > MAX_FILE_BYTES) {
    return { ok: false, error: 'This file is too large to be a client snapshot.' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: NOT_A_SNAPSHOT };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: NOT_A_SNAPSHOT };
  const file = raw as Partial<Record<keyof SnapshotFile, unknown>>;
  if (file.kind !== FILE_KIND) return { ok: false, error: NOT_A_SNAPSHOT };
  if (typeof file.schema !== 'number' || file.schema > FILE_SCHEMA) {
    return {
      ok: false,
      error: 'This snapshot was saved by a newer version of Kautis. Refresh the page and try again.',
    };
  }
  const form = parseFormValue(file.form);
  if (!form) return { ok: false, error: 'This snapshot file is damaged and could not be opened.' };
  const version =
    typeof file.version === 'number' && Number.isInteger(file.version) && file.version > 0
      ? Math.min(file.version, 100_000)
      : 1;
  const savedAt =
    typeof file.savedAt === 'string' && !Number.isNaN(Date.parse(file.savedAt)) ? file.savedAt : '';
  // The hash is taken from the form as repaired by the schema, so opening a
  // file and changing nothing never reads as an unsaved change.
  return { ok: true, form, meta: { version, savedAt, savedHash: hashForm(form) } };
}
