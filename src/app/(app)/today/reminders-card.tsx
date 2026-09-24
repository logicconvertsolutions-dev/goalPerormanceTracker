import Link from 'next/link';
import { Bell, ChevronRight } from 'lucide-react';
import { NewReminderButton, ReminderList, type ReminderItem } from './reminder-list';

export type { ReminderItem };

/** How many upcoming reminders the card lists (P31): 5 on a phone, 10 from lg up. */
export const REMINDERS_CARD_MOBILE = 5;
export const REMINDERS_CARD_DESKTOP = 10;

/** My Day Reminders (P30): upcoming reminders, soonest first, each with its
 * alert setting. "+ New" opens a small sheet; the delivery job turns a due
 * reminder into a bell notification (and a push, if on). "View all" opens
 * /today/reminders with completed ones too. */
export function RemindersCard({
  reminders,
  upcomingCount,
  today,
  timeZone,
}: {
  reminders: ReminderItem[];
  upcomingCount: number;
  today: string;
  timeZone: string | null;
}) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4 shadow-card" aria-labelledby="reminders-heading">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="reminders-heading" className="flex items-center gap-2 text-[17px] font-bold text-fg">
          <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
          Reminders
        </h2>
        <div className="flex items-center gap-3">
          <NewReminderButton today={today} timeZone={timeZone} />
          <Link
            href="/today/reminders"
            className="flex items-center gap-0.5 text-sm font-bold text-acc hover:underline"
          >
            View all
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {reminders.length === 0 ? (
        <p className="text-sm text-fg-3">No upcoming reminders. Tap “New” to add one.</p>
      ) : (
        <>
          <ReminderList reminders={reminders} today={today} timeZone={timeZone} mobileLimit={REMINDERS_CARD_MOBILE} />
          {upcomingCount > REMINDERS_CARD_MOBILE && (
            <Link
              href="/today/reminders"
              className="block pt-2 text-center text-xs font-bold text-acc hover:underline lg:hidden"
            >
              +{upcomingCount - REMINDERS_CARD_MOBILE} more upcoming
            </Link>
          )}
          {upcomingCount > REMINDERS_CARD_DESKTOP && (
            <Link
              href="/today/reminders"
              className="hidden pt-2 text-center text-xs font-bold text-acc hover:underline lg:block"
            >
              +{upcomingCount - REMINDERS_CARD_DESKTOP} more upcoming
            </Link>
          )}
        </>
      )}
    </section>
  );
}
