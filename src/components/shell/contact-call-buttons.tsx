'use client';

import { Phone } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { telHref, whatsAppHref } from '@/lib/phone';
import { recordPendingCall, type CallChannel } from '@/lib/pending-call';

export type { CallChannel };

const NO_NUMBER = 'Add phone number to enable calling';

/** WhatsApp's speech-bubble mark, drawn inline (no icon dependency). */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 4.54 0 8.23 3.7 8.23 8.24 0 4.54-3.7 8.24-8.24 8.24Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48a.92.92 0 0 0-.67.31c-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}

/**
 * Tap-to-call and WhatsApp (P33) for one contact. With no number both stay
 * visible but greyed out, and a tap says why (a tooltip alone never shows on
 * a touch screen).
 *
 * Phone opens the device dialer (tel:). WhatsApp opens a chat (wa.me) --
 * there is no link that starts a WhatsApp voice call to a personal number,
 * so the agent taps call inside WhatsApp.
 *
 * Before either leaves the app, the tap is recorded (P34, lib/pending-call)
 * so CallLogPrompt can ask how the call went when the agent comes back.
 * `onDial`, when passed, replaces that (tests, or a caller with its own
 * tracking).
 */
export function ContactCallButtons({
  contactId,
  phoneNumber,
  contactName,
  size = 'md',
  className,
  onDial,
}: {
  contactId: string;
  phoneNumber: string | null;
  contactName: string;
  size?: 'sm' | 'md';
  className?: string;
  onDial?: (channel: CallChannel) => void;
}) {
  const dial = (channel: CallChannel) =>
    onDial ? onDial(channel) : recordPendingCall({ contactId, contactName, channel });
  const box = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10';
  const icon = size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]';
  const base = cn('flex shrink-0 items-center justify-center rounded-full border transition-smooth', box);

  if (!phoneNumber) {
    const disabled = cn(base, 'cursor-not-allowed border-line text-fg-4');
    const explain = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      toast(NO_NUMBER);
    };
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <button type="button" aria-disabled="true" title={NO_NUMBER} aria-label={`Call ${contactName}. ${NO_NUMBER}`} onClick={explain} className={disabled}>
          <Phone className={icon} aria-hidden="true" />
        </button>
        <button type="button" aria-disabled="true" title={NO_NUMBER} aria-label={`WhatsApp ${contactName}. ${NO_NUMBER}`} onClick={explain} className={disabled}>
          <WhatsAppIcon className={icon} />
        </button>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <a
        href={telHref(phoneNumber)}
        aria-label={`Call ${contactName}`}
        title={`Call ${contactName}`}
        onClick={(e) => {
          e.stopPropagation();
          dial('phone');
        }}
        className={cn(base, 'border-acc-line bg-acc-dim text-acc hover:bg-acc hover:text-on-acc')}
      >
        <Phone className={icon} aria-hidden="true" />
      </a>
      <a
        href={whatsAppHref(phoneNumber)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`WhatsApp ${contactName}`}
        title={`WhatsApp ${contactName}`}
        onClick={(e) => {
          e.stopPropagation();
          dial('whatsapp');
        }}
        className={cn(base, 'border-whatsapp/40 bg-whatsapp/10 text-whatsapp-text hover:bg-whatsapp hover:text-white')}
      >
        <WhatsAppIcon className={icon} />
      </a>
    </div>
  );
}
