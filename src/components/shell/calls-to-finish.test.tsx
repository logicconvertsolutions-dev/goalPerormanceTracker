// @vitest-environment jsdom
//
// P35 "Calls to finish". Each waiting call is finished (Add outcome logs it
// on the day it was made and removes it) or removed ("Didn't call" / "I
// didn't make this call", no trace). Closing the outcome form leaves it
// waiting.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() });
  return { toast };
});

const mockDelete = vi.fn(async (_id: string) => ({ ok: true as const }));
vi.mock('@/app/(app)/log/actions', () => ({
  deletePendingCallAction: (id: string) => mockDelete(id),
  fetchLogPrefillAction: vi.fn(async () => ({ contact: { id: 'c1', full_name: 'Jane Doe' }, history: [], lastSource: 'cold' })),
  logCallAction: vi.fn(),
  updateCallAction: vi.fn(),
}));
const mockSubmit = vi.fn(async (_kind: string, _fd: FormData, _action: unknown) => ({ ok: true }));
vi.mock('@/lib/offline/submit-with-fallback', () => ({
  submitWithOfflineFallback: (kind: string, fd: FormData, action: unknown) => mockSubmit(kind, fd, action),
}));
vi.mock('@/components/shell/contact-picker', () => ({ ContactPicker: () => null }));

const { CallsToFinish } = await import('./calls-to-finish');

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const PENDING = '22222222-2222-4222-8222-222222222222';
const calls = [
  { id: PENDING, contact_id: 'c1', channel: 'whatsapp', call_date: '2026-10-01', contacts: { full_name: 'Jane Doe' } },
];

beforeEach(() => {
  mockDelete.mockClear();
  mockSubmit.mockClear();
});

describe('CallsToFinish', () => {
  it('shows nothing when there is nothing to finish', () => {
    const { container } = render(<CallsToFinish calls={[]} total={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each waiting call with who, when and how', () => {
    render(<CallsToFinish calls={calls} total={1} />);
    expect(screen.getByText('1 call to finish')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText(/WhatsApp/)).toBeInTheDocument();
  });

  it('"Didn\'t call" removes it', async () => {
    render(<CallsToFinish calls={calls} total={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'I didn’t make this call to Jane Doe' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(PENDING));
  });

  it('Add outcome logs it on the day it was made, as this waiting call', async () => {
    render(<CallsToFinish calls={calls} total={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add outcome' }));
    await screen.findByRole('button', { name: 'Fill in later' });

    fireEvent.click(screen.getByRole('combobox', { name: 'Outcome' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Connected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log call' }));

    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    const fd = mockSubmit.mock.calls[0][1];
    expect(fd.get('pendingCallId')).toBe(PENDING);
    expect(fd.get('callDate')).toBe('2026-10-01');
    expect(fd.get('channel')).toBe('whatsapp');
    expect(fd.get('contactId')).toBe('c1');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('closing the form leaves it waiting', async () => {
    render(<CallsToFinish calls={calls} total={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add outcome' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Fill in later' }));
    await waitFor(() => expect(screen.queryByText('How did the call go?')).toBeNull());
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('"I didn\'t make this call" inside the form removes it', async () => {
    render(<CallsToFinish calls={calls} total={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add outcome' }));
    fireEvent.click(await screen.findByRole('button', { name: 'I didn’t make this call' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(PENDING));
  });
});
