// @vitest-environment jsdom
//
// Regression: ISSUE-002 — Contacts search box did nothing
// Found by /qa on 2026-08-27
// Report: .gstack/qa-reports/qa-report-localhost-2026-08-27.md
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContactsSearch } from './contacts-search';

const replace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/contacts',
  useSearchParams: () => mockSearchParams,
}));

describe('ContactsSearch', () => {
  beforeEach(() => {
    replace.mockClear();
    mockSearchParams = new URLSearchParams();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushes the typed query into the q search param after the debounce', () => {
    render(<ContactsSearch initialQuery="" />);

    fireEvent.change(screen.getByPlaceholderText('Search name or notes'), { target: { value: 'Deepak' } });
    vi.advanceTimersByTime(300);

    expect(replace).toHaveBeenCalledWith('/contacts?q=Deepak');
  });

  it('clears the q search param when the input is emptied', () => {
    mockSearchParams = new URLSearchParams('q=Deepak');
    render(<ContactsSearch initialQuery="Deepak" />);

    fireEvent.change(screen.getByPlaceholderText('Search name or notes'), { target: { value: '' } });
    vi.advanceTimersByTime(300);

    expect(replace).toHaveBeenCalledWith('/contacts?');
  });

  it('does not navigate before the debounce window elapses', () => {
    render(<ContactsSearch initialQuery="" />);

    fireEvent.change(screen.getByPlaceholderText('Search name or notes'), { target: { value: 'D' } });
    vi.advanceTimersByTime(100);

    expect(replace).not.toHaveBeenCalled();
  });
});
