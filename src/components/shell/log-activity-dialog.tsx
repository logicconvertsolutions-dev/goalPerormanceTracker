'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDisplayDate } from '@/lib/dates';
import { LogTypeSwitcher } from '@/app/(app)/log/log-type-switcher';
import { fetchLogPrefillAction } from '@/app/(app)/log/actions';

interface OpenOptions {
  contactId?: string;
  contactName?: string;
  date?: string;
}

interface LogActivityDialogContextValue {
  open: (opts?: OpenOptions) => void;
}

const LogActivityDialogContext = createContext<LogActivityDialogContextValue | null>(null);

/**
 * The single "Log Activity" experience, reachable from anywhere in the app
 * (nav, My Day, Activity Logs, a contact's page) without a full-page hop to
 * a dedicated /log route — replaces every `<Link href="/log">` with a call
 * to this dialog's `open()`.
 */
export function LogActivityDialogProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState<OpenOptions>({});
  const [history, setHistory] = useState<{ call_date: string; outcome: string; notes: string | null }[]>([]);

  const open = useCallback((opts: OpenOptions = {}) => {
    setPrefill(opts);
    setHistory([]);
    setIsOpen(true);
    if (opts.contactId) {
      fetchLogPrefillAction(opts.contactId).then((result) => {
        if (!result) return;
        setPrefill((prev) => ({ ...prev, contactName: result.contact.full_name }));
        setHistory(result.history);
      });
    }
  }, []);

  const handleDone = useCallback(() => {
    setIsOpen(false);
    router.refresh();
  }, [router]);

  return (
    <LogActivityDialogContext.Provider value={{ open }}>
      {children}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {prefill.contactName ? `Log a call — ${prefill.contactName}` : 'Log activity'}
            </DialogTitle>
          </DialogHeader>
          <LogTypeSwitcher
            defaultContactName={prefill.contactName ?? ''}
            defaultContactId={prefill.contactId ?? ''}
            defaultDate={prefill.date}
            onSuccess={handleDone}
            onCancel={() => setIsOpen(false)}
          />
          {history.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-line pt-4">
              <p className="text-sm font-semibold text-fg">Recent history</p>
              {history.map((h, i) => (
                <div key={i} className="text-sm border-b border-line pb-2 last:border-0 last:pb-0">
                  <p className="text-fg-2">
                    {formatDisplayDate(h.call_date)} · {h.outcome.replace('_', ' ')}
                  </p>
                  {h.notes && <p className="text-fg-3 text-xs mt-0.5">{h.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </LogActivityDialogContext.Provider>
  );
}

export function useLogActivityDialog(): LogActivityDialogContextValue {
  const ctx = useContext(LogActivityDialogContext);
  if (!ctx) throw new Error('useLogActivityDialog must be used within LogActivityDialogProvider');
  return ctx;
}
