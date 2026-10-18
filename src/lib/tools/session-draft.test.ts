import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllToolDrafts, clearDraft, loadDraft, saveDraft } from './session-draft';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('tool session drafts', () => {
  it('round-trips a query per tool', () => {
    saveDraft('tax', 'prov=QC&emp=50000');
    saveDraft('investment', 'ls=1000');
    expect(loadDraft('tax')).toBe('prov=QC&emp=50000');
    expect(loadDraft('investment')).toBe('ls=1000');
  });

  it('removes the draft when the query is empty (all defaults)', () => {
    saveDraft('tax', 'emp=1');
    saveDraft('tax', '');
    expect(loadDraft('tax')).toBeNull();
  });

  it('clears one tool or all of them', () => {
    saveDraft('tax', 'emp=1');
    saveDraft('investment', 'ls=1');
    clearDraft('tax');
    expect(loadDraft('tax')).toBeNull();
    expect(loadDraft('investment')).toBe('ls=1');
    clearAllToolDrafts();
    expect(loadDraft('investment')).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadDraft('tax')).toBeNull();
    expect(() => saveDraft('tax', 'emp=1')).not.toThrow();
  });
});
