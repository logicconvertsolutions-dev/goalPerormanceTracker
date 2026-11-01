import { describe, expect, it } from 'vitest';
import { summarize } from './calculate';
import {
  buildSnapshotFile,
  FILE_KIND,
  hasUnsavedChanges,
  hashForm,
  isBlank,
  MAX_FILE_BYTES,
  parseSnapshotFile,
  snapshotFilename,
} from './file';
import { defaultForm, EMPTY_META, toHousehold, type SnapshotForm } from './form';

const NOW = new Date('2026-11-01T14:05:00.000Z');

function filled(): SnapshotForm {
  const form = defaultForm();
  form.client.name = 'Asha Patel';
  form.client.dob = '1990-04-12';
  form.client.net = '5000';
  form.expenses[0].amount = '2000';
  form.recommendationNotes = { emergency: 'Wants 6 months by spring' };
  form.customRecommendations = [{ id: 'c-1', text: 'Review group cover at job change' }];
  form.advisorNotes = 'Follow up in January.';
  return form;
}

const save = (form: SnapshotForm, meta = EMPTY_META) =>
  buildSnapshotFile(form, meta, summarize(toHousehold(form), NOW), NOW, '2026-11-01');

describe('snapshotFilename', () => {
  it('is client name + date + version', () => {
    expect(snapshotFilename('Asha Patel', '2026-11-01', 3)).toBe('Asha-Patel_2026-11-01_v3.json');
  });

  it('strips accents and anything unsafe in a filename', () => {
    expect(snapshotFilename('  Zoë  O\'Brien / Smith ', '2026-11-01', 1)).toBe(
      'Zoe-O-Brien-Smith_2026-11-01_v1.json'
    );
  });

  it('falls back to "Client" and caps the length', () => {
    expect(snapshotFilename('', '2026-11-01', 1)).toBe('Client_2026-11-01_v1.json');
    expect(snapshotFilename('***', '2026-11-01', 1)).toBe('Client_2026-11-01_v1.json');
    const long = snapshotFilename('A'.repeat(100), '2026-11-01', 1);
    expect(long).toBe(`${'A'.repeat(60)}_2026-11-01_v1.json`);
  });
});

describe('versioning', () => {
  it('first download is v1', () => {
    const out = save(filled());
    expect(out.filename).toBe('Asha-Patel_2026-11-01_v1.json');
    expect(out.meta).toEqual({ version: 1, savedAt: NOW.toISOString(), savedHash: hashForm(filled()) });
  });

  it('saving again with no changes keeps the same version', () => {
    const first = save(filled());
    const later = buildSnapshotFile(
      filled(),
      first.meta,
      summarize(toHousehold(filled())),
      new Date('2026-11-02T09:00:00Z'),
      '2026-11-02'
    );
    expect(later.meta).toEqual(first.meta);
  });

  it('a change bumps the version', () => {
    const first = save(filled());
    const edited = filled();
    edited.advisorNotes = 'Changed';
    expect(save(edited, first.meta).meta.version).toBe(2);
  });

  it('tracks unsaved changes, but never for an untouched form', () => {
    expect(hasUnsavedChanges(defaultForm(), EMPTY_META)).toBe(false);
    expect(hasUnsavedChanges(filled(), EMPTY_META)).toBe(true);
    const { meta } = save(filled());
    expect(hasUnsavedChanges(filled(), meta)).toBe(false);
    const edited = filled();
    edited.recommendationNotes = { emergency: 'changed' };
    expect(hasUnsavedChanges(edited, meta)).toBe(true);
  });

  it('isBlank', () => {
    expect(isBlank(defaultForm())).toBe(true);
    expect(isBlank(filled())).toBe(false);
  });
});

describe('parseSnapshotFile', () => {
  it('round-trips a saved file, notes included, with no unsaved changes', () => {
    const out = save(filled());
    const parsed = parseSnapshotFile(out.json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.form).toEqual(filled());
    expect(parsed.meta).toEqual(out.meta);
    expect(hasUnsavedChanges(parsed.form, parsed.meta)).toBe(false);
  });

  it('carries a readable summary and the client name', () => {
    const file = JSON.parse(save(filled()).json);
    expect(file).toMatchObject({ kind: FILE_KIND, schema: 1, version: 1, client: 'Asha Patel' });
    expect(file.summary.totalNetIncome).toBe(5000);
  });

  it('opens a file saved before notes existed', () => {
    const file = JSON.parse(save(filled()).json);
    delete file.form.recommendationNotes;
    delete file.form.customRecommendations;
    delete file.form.advisorNotes;
    const parsed = parseSnapshotFile(JSON.stringify(file));
    expect(parsed.ok && parsed.form.recommendationNotes).toEqual({});
    expect(parsed.ok && parsed.form.customRecommendations).toEqual([]);
  });

  it('rejects anything that is not a snapshot', () => {
    expect(parseSnapshotFile('not json')).toMatchObject({ ok: false });
    expect(parseSnapshotFile('[]')).toMatchObject({ ok: false });
    expect(parseSnapshotFile('{"kind":"something-else"}')).toMatchObject({ ok: false });
    expect(parseSnapshotFile('x'.repeat(MAX_FILE_BYTES + 1))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/too large/),
    });
  });

  it('rejects a newer file format and a damaged form', () => {
    const file = JSON.parse(save(filled()).json);
    expect(parseSnapshotFile(JSON.stringify({ ...file, schema: 2 }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/newer version/),
    });
    expect(parseSnapshotFile(JSON.stringify({ ...file, form: { v: 9 } }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/damaged/),
    });
  });

  it('repairs a bad version number and date instead of failing', () => {
    const file = JSON.parse(save(filled()).json);
    const parsed = parseSnapshotFile(JSON.stringify({ ...file, version: -4, savedAt: 'yesterday' }));
    expect(parsed.ok && parsed.meta.version).toBe(1);
    expect(parsed.ok && parsed.meta.savedAt).toBe('');
  });
});
