// @vitest-environment jsdom
//
// P34 post-call prompt. Opens only after the agent tapped call AND left the
// app; saving logs the call with its channel; closing any other way still
// saves the attempt with no outcome ("Outcome needed"); "I didn't make this
// call" saves nothing.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() });
  return { toast };
});

const mockAttempt = vi.fn(async (_input: unknown) => ({ ok: true as const }));
const mockPrefill = vi.fn(async (_id: string) => ({
  contact: { id: 'c1', full_name: 'Jane Doe' },
  history: [],
  lastSource: 'referral',
}));
vi.mock('@/app/(app)/log/actions', () => ({
  logCallAttemptAction: (input: unknown) => mockAttempt(input),
  fetchLogPrefillAction: (id: string) => mockPrefill(id),
  logCallAction: vi.fn(),
  updateCallAction: vi.fn(),
}));
const mockSubmit = vi.fn(async (_kind: string, _fd: FormData, _action: unknown) => ({ ok: true }));
vi.mock('@/lib/offline/submit-with-fallback', () => ({
  submitWithOfflineFallback: (kind: string, fd: FormData, action: unknown) => mockSubmit(kind, fd, action),
}));
vi.mock('@/components/shell/contact-picker', () => ({ ContactPicker: () => null }));

const { CallLogPrompt } = await import('./call-log-prompt');
const { recordPendingCall, markLeftApp, readPendingCall } = await import('@/lib/pending-call');

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  sessionStorage.clear();
  mockAttempt.mockClear();
  mockSubmit.mockClear();
  setVisibility('visible');
});

async function openAfterCall(channel: 'phone' | 'whatsapp' = 'phone') {
  render(<CallLogPrompt />);
  recordPendingCall({ contactId: 'c1', contactName: 'Jane Doe', channel });
  setVisibility('hidden');
  setVisibility('visible');
  await screen.findByText('How did the call go?');
  await screen.findByRole('button', { name: 'Fill in later' });
}

describe('CallLogPrompt', () => {
  it('stays closed until the agent has actually left the app', () => {
    render(<CallLogPrompt />);
    recordPendingCall({ contactId: 'c1', contactName: 'Jane Doe', channel: 'phone' });
    setVisibility('visible');
    expect(screen.queryByText('How did the call go?')).toBeNull();
  });

  it('opens on return with the contact and channel filled in, and prompts once', async () => {
    await openAfterCall('whatsapp');
    expect(screen.getByText('WhatsApp call with Jane Doe')).toBeInTheDocument();
    expect(readPendingCall()).toBeNull();
  });

  it('opens on a fresh page load when the browser reloaded the app mid-call', async () => {
    recordPendingCall({ contactId: 'c1', contactName: 'Jane Doe', channel: 'phone' });
    markLeftApp();
    render(<CallLogPrompt />);
    expect(await screen.findByText('How did the call go?')).toBeInTheDocument();
  });

  it('closing without an outcome still saves the attempt, once', async () => {
    await openAfterCall('phone');
    const { requestId } = { requestId: expect.any(String) };
    fireEvent.click(screen.getByRole('button', { name: 'Fill in later' }));
    await waitFor(() =>
      expect(mockAttempt).toHaveBeenCalledWith({ contactId: 'c1', channel: 'phone', clientRequestId: requestId })
    );
    expect(mockAttempt).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('How did the call go?')).toBeNull();
  });

  it('"I didn\'t make this call" saves nothing', async () => {
    await openAfterCall('phone');
    fireEvent.click(screen.getByRole('button', { name: 'I didn’t make this call' }));
    await waitFor(() => expect(screen.queryByText('How did the call go?')).toBeNull());
    expect(mockAttempt).not.toHaveBeenCalled();
  });

  it('saving logs the call with its channel and the contact\'s last source', async () => {
    await openAfterCall('whatsapp');
    // Radix Select: open the outcome list and pick No answer.
    fireEvent.click(screen.getByRole('combobox', { name: 'Outcome' }));
    fireEvent.click(await screen.findByRole('option', { name: 'No answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log call' }));

    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    const fd = mockSubmit.mock.calls[0][1];
    expect(fd.get('contactId')).toBe('c1');
    expect(fd.get('channel')).toBe('whatsapp');
    expect(fd.get('source')).toBe('referral');
    expect(fd.get('outcome')).toBe('no_answer');
    // No answer suggests calling back tomorrow.
    expect(fd.get('followUpOn')).toBeTruthy();
    expect(mockAttempt).not.toHaveBeenCalled();
  });
});
