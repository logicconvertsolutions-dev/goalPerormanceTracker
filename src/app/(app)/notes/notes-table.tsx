'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDisplayDate } from '@/lib/dates';

export interface TimelineEntry {
  date: string;
  type: 'Call' | 'Appointment' | 'Sale';
  summary: string;
  notes: string | null;
  /** Appointment's `appt_type` (e.g. "Solutions Presented", "Login Shown") --
   * what actually happened, shown in the Actions column. Null for calls/sales. */
  actionType: string | null;
  followUpOn: string | null;
  followUpDoneAt: string | null;
}

export function NotesTable({
  contactName,
  entries,
}: {
  contactName: string;
  entries: TimelineEntry[];
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(entries.map((_, i) => i)));

  const allSelected = selected.size === entries.length;
  const noneSelected = selected.size === 0;

  function toggleRow(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(entries.map((_, i) => i)));
  }

  return (
    <Card className="print:border-0 print:shadow-none print:bg-white">
      <CardHeader className="print:hidden">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{contactName}</CardTitle>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={noneSelected}
            onClick={() => window.print()}
          >
            Print{selected.size > 0 && !allSelected ? ` (${selected.size})` : ''}
          </Button>
        </div>
      </CardHeader>
      <p className="hidden print:block px-4 pt-4 text-lg font-semibold text-black">
        Meeting Notes — {contactName}
      </p>
      <CardContent>
        <div className="overflow-x-auto -mx-6 px-6 print:mx-0 print:px-0 print:overflow-visible">
          <table className="w-full min-w-[640px] border-collapse text-sm print:min-w-0 print:text-black">
            <thead>
              <tr className="bg-sunken print:bg-gray-200">
                <th className="border border-line-2 px-3 py-2 text-left font-semibold text-fg print:hidden">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all rows" />
                </th>
                <th className="border border-line-2 px-3 py-2 text-left font-semibold text-fg print:border-black print:text-black">
                  Date
                </th>
                <th className="border border-line-2 px-3 py-2 text-left font-semibold text-fg print:border-black print:text-black">
                  Call / Meeting?
                </th>
                <th className="border border-line-2 px-3 py-2 text-left font-semibold text-fg print:border-black print:text-black">
                  Details of Discussions
                </th>
                <th className="border border-line-2 px-3 py-2 text-left font-semibold text-fg print:border-black print:text-black">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr
                  key={i}
                  className={
                    selected.has(i) ? 'print:break-inside-avoid' : 'print:hidden'
                  }
                >
                  <td className="border border-line-2 px-3 py-2 align-top print:hidden">
                    <Checkbox
                      checked={selected.has(i)}
                      onCheckedChange={() => toggleRow(i)}
                      aria-label={`Select row ${i + 1}`}
                    />
                  </td>
                  <td className="border border-line-2 px-3 py-2 align-top text-fg whitespace-nowrap print:border-black print:text-black">
                    {formatDisplayDate(e.date)}
                  </td>
                  <td className="border border-line-2 px-3 py-2 align-top text-fg print:border-black print:text-black">
                    <Badge variant="neutral" className="print:border-black print:text-black">
                      {e.type}
                    </Badge>
                  </td>
                  <td className="border border-line-2 px-3 py-2 align-top text-fg-2 print:border-black print:text-black">
                    <span className="font-medium text-fg print:text-black">{e.summary}</span>
                    {e.notes && <p className="mt-1">{e.notes}</p>}
                  </td>
                  <td className="border border-line-2 px-3 py-2 align-top text-fg-2 print:border-black print:text-black">
                    {e.actionType && <p className="font-medium text-fg print:text-black">{e.actionType}</p>}
                    <p>
                      {e.followUpOn
                        ? `Follow up ${formatDisplayDate(e.followUpOn)}${e.followUpDoneAt ? ' (done)' : ''}`
                        : e.actionType
                          ? null
                          : '—'}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
