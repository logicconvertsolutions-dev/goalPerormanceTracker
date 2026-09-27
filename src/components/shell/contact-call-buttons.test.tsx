// @vitest-environment jsdom
//
// P33: tap-to-call and WhatsApp. With a number: a tel: link and a wa.me chat
// link (digits only). Without one: both still shown but disabled, and a tap
// explains why instead of doing nothing.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const toast = vi.fn();
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => toast(...args) }));

const { ContactCallButtons } = await import('./contact-call-buttons');

// jsdom can't follow tel:/https links; stop it trying (capture phase, since
// the buttons stop propagation).
window.addEventListener('click', (e) => e.preventDefault(), true);

describe('ContactCallButtons', () => {
  it('dials the number and opens WhatsApp chat in a new tab', () => {
    const onDial = vi.fn();
    render(<ContactCallButtons phoneNumber="+14165550123" contactName="Jane Doe" onDial={onDial} />);

    const call = screen.getByRole('link', { name: 'Call Jane Doe' });
    const wa = screen.getByRole('link', { name: 'WhatsApp Jane Doe' });
    expect(call).toHaveAttribute('href', 'tel:+14165550123');
    expect(wa).toHaveAttribute('href', 'https://wa.me/14165550123');
    expect(wa).toHaveAttribute('target', '_blank');
    expect(wa).toHaveAttribute('rel', 'noopener noreferrer');

    fireEvent.click(call);
    fireEvent.click(wa);
    expect(onDial.mock.calls).toEqual([['phone'], ['whatsapp']]);
  });

  it('greys both out without a number and says why on tap', () => {
    const onDial = vi.fn();
    render(<ContactCallButtons phoneNumber={null} contactName="Jane Doe" onDial={onDial} />);

    expect(screen.queryByRole('link')).toBeNull();
    const call = screen.getByRole('button', { name: /Call Jane Doe/ });
    expect(call).toHaveAttribute('aria-disabled', 'true');
    expect(call).toHaveAttribute('title', 'Add phone number to enable calling');

    fireEvent.click(screen.getByRole('button', { name: /WhatsApp Jane Doe/ }));
    expect(toast).toHaveBeenCalledWith('Add phone number to enable calling');
    expect(onDial).not.toHaveBeenCalled();
  });
});
