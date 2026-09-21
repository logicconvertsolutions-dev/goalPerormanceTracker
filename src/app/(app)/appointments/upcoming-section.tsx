import Link from 'next/link';
import { CalendarClock, AlertTriangle } from 'lucide-react';
import { formatDisplayDateTime, formatDisplayTime, formatDisplayDate } from '@/lib/dates';
import { apptTypeLabel } from '@/lib/appointment-types';

export interface UpcomingAppointment {
  id: string;
  apptDate: string;
  scheduledFor: string | null;
  apptType: string | null;
  contactName: string;
}

/**
 * Appointments that still need something, shown OUTSIDE the period filter
 * (P25 C2).
 *
 * The table below this section answers "what happened in this cycle". That
 * is the wrong question for an appointment that has not happened yet: with
 * the filter on the current cycle, an appointment booked for next week is
 * invisible on this page entirely, and My Day only surfaces it on the day
 * (F13). An agent had no screen anywhere that answered "what is coming
 * up".
 *
 * Two bands, because they are two different problems:
 *
 *   Needs an outcome  past its slot and still `scheduled`. This is the one
 *                     that quietly corrupts numbers — an appointment left
 *                     pending is missing from held/no-show entirely, so
 *                     every rate computed from outcomes is computed over a
 *                     smaller denominator than reality.
 *   Upcoming          still ahead. Just the list.
 */
export function UpcomingSection({
  overdue,
  upcoming,
  timeZone,
}: {
  overdue: UpcomingAppointment[];
  upcoming: UpcomingAppointment[];
  timeZone: string | null;
}) {
  if (overdue.length === 0 && upcoming.length === 0) return null;

  return (
    <div className="space-y-3">
      {overdue.length > 0 && (
        <div className="rounded-lg border border-line bg-bad-dim shadow-card">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <AlertTriangle className="h-4 w-4 text-bad" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-fg">Needs an outcome ({overdue.length})</h2>
          </div>
          <p className="px-4 pt-2.5 text-xs text-fg-3">
            These have been and gone but were never marked Held, No-show or Cancelled. Until they are, they
            count as neither — and your no-show rate is computed without them.
          </p>
          <ul className="divide-y divide-line px-4">
            {overdue.map((a) => (
              <Row key={a.id} appointment={a} timeZone={timeZone} />
            ))}
          </ul>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="rounded-lg border border-line bg-panel shadow-card">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <CalendarClock className="h-4 w-4 text-acc" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-fg">Upcoming ({upcoming.length})</h2>
            <span className="ml-auto text-xs text-fg-3">Not affected by the filters below</span>
          </div>
          <ul className="divide-y divide-line px-4">
            {upcoming.map((a) => (
              <Row key={a.id} appointment={a} timeZone={timeZone} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ appointment, timeZone }: { appointment: UpcomingAppointment; timeZone: string | null }) {
  const { id, scheduledFor, apptDate, apptType, contactName } = appointment;
  // A legacy or imported row has no slot, only a date — say the date
  // rather than inventing a time it was never given.
  const when = scheduledFor
    ? `${formatDisplayDateTime(scheduledFor, timeZone)} · ${formatDisplayTime(scheduledFor, timeZone)}`
    : formatDisplayDate(apptDate);

  return (
    <li className="py-2.5">
      <Link href={`/appointments/${id}/edit`} className="flex items-baseline justify-between gap-3 hover:underline">
        <span className="min-w-0 truncate text-sm font-medium text-fg">{contactName}</span>
        <span className="shrink-0 text-xs text-fg-3">
          {when}
          {apptType && ` · ${apptTypeLabel(apptType)}`}
        </span>
      </Link>
    </li>
  );
}
