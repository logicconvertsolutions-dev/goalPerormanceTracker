import Link from 'next/link';
import { requireVerifiedAgent } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shell/page-header';
import { formatDisplayDate } from '@/lib/dates';
import { AddContactDialog } from './add-contact-dialog';
import { ImportFromPhoneButton } from './import-from-phone-button';
import { ImportVCardButton } from './import-vcard-button';
import { ContactsSearch } from './contacts-search';
import { ContactCallButtons } from '@/components/shell/contact-call-buttons';
import { outcomeLabel } from '@/lib/call-outcomes';
import { CONTACTS_PAGE_SIZE, contactsHref, pageCount, parsePage } from './paging';

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireVerifiedAgent();
  const supabase = await createClient();
  const { q: qRaw, page: pageRaw } = await searchParams;
  const q = qRaw?.trim();
  const page = parsePage(pageRaw);

  // P42: one page, summarised in the database. Reading every contact with
  // its call_logs here stopped silently at PostgREST's 1,000-row cap.
  const { data } = await supabase.rpc('my_contacts', {
    p_q: q || undefined,
    p_limit: CONTACTS_PAGE_SIZE,
    p_offset: (page - 1) * CONTACTS_PAGE_SIZE,
  });
  const rows = data ?? [];
  const total = rows[0]?.total_count ?? 0;
  const pages = pageCount(total);

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="Contacts"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ImportFromPhoneButton />
            <ImportVCardButton />
            <Button asChild variant="ghost" size="sm">
              <Link href="/import/template?type=contacts">Download template</Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/import">Import from Excel</Link>
            </Button>
            <AddContactDialog />
          </div>
        }
      />

      <ContactsSearch initialQuery={q ?? ''} />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-fg-2">
              {page > 1 ? (
                <>
                  There are no contacts on this page.{' '}
                  <Link href={contactsHref(1, q)} className="text-fg underline">
                    Back to the first page
                  </Link>
                </>
              ) : q ? (
                `No contacts matching "${q}".`
              ) : (
                'No contacts yet. They appear automatically when you log a call.'
              )}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: a divided list, same visual language as My Day's Recent
              Activity — a table's horizontal scroll doesn't work well on a
              small screen. */}
          <div className="divide-y divide-line rounded-lg border border-line bg-panel px-4 shadow-card md:hidden">
            {rows.map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-3">
                <Link href={`/contacts/${c.id}`} className="block min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[15px] font-semibold text-fg">{c.full_name}</p>
                    <span className="shrink-0 text-xs text-fg-3">{c.times_called} calls</span>
                  </div>
                  {c.notes && <p className="mt-0.5 truncate text-sm text-fg-2">{c.notes}</p>}
                  <p className="mt-0.5 truncate text-sm text-fg-3">
                    {c.last_call_date && c.last_outcome
                      ? `${formatDisplayDate(c.last_call_date)} · ${outcomeLabel(c.last_outcome)}`
                      : 'No calls yet'}
                    {c.next_follow_up && ` · Follow-up ${formatDisplayDate(c.next_follow_up)}`}
                  </p>
                </Link>
                <ContactCallButtons contactId={c.id} phoneNumber={c.phone_number} contactName={c.full_name} size="sm" />
              </div>
            ))}
          </div>

          {/* Desktop / tablet: full table. */}
          <div className="hidden overflow-x-auto rounded-lg border border-line shadow-card md:block">
            <table className="w-full text-sm">
              <thead className="bg-bg-2 text-fg-3 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Contact</th>
                  <th className="text-left font-medium px-4 py-2.5">Notes</th>
                  <th className="text-left font-medium px-4 py-2.5">Times called</th>
                  <th className="text-left font-medium px-4 py-2.5">Last called</th>
                  <th className="text-left font-medium px-4 py-2.5">Last outcome</th>
                  <th className="text-left font-medium px-4 py-2.5">Next follow-up</th>
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Call</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-t border-line hover:bg-hover">
                    <td className="px-4 py-2.5">
                      <Link href={`/contacts/${c.id}`} className="text-fg font-medium hover:underline">
                        {c.full_name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-fg-2 max-w-xs truncate">{c.notes ?? '—'}</td>
                    <td className="px-4 py-2.5 text-fg-2">{c.times_called}</td>
                    <td className="px-4 py-2.5 text-fg-2">
                      {c.last_call_date ? formatDisplayDate(c.last_call_date) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-fg-2">
                      {c.last_outcome ? outcomeLabel(c.last_outcome) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-fg-2">
                      {c.next_follow_up ? formatDisplayDate(c.next_follow_up) : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <ContactCallButtons
                        contactId={c.id}
                        phoneNumber={c.phone_number}
                        contactName={c.full_name}
                        size="sm"
                        className="justify-end"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ContactsPager page={page} pages={pages} total={total} q={q} />
        </>
      )}
    </div>
  );
}

function ContactsPager({ page, pages, total, q }: { page: number; pages: number; total: number; q?: string }) {
  const first = (page - 1) * CONTACTS_PAGE_SIZE + 1;
  const last = Math.min(page * CONTACTS_PAGE_SIZE, total);
  return (
    <nav aria-label="Contacts pages" className="flex items-center justify-between gap-3 text-sm text-fg-2">
      <p>
        {first}–{last} of {total}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={contactsHref(page - 1, q)}>Previous</Link>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              Previous
            </Button>
          )}
          <span className="text-fg-3">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={contactsHref(page + 1, q)}>Next</Link>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              Next
            </Button>
          )}
        </div>
      )}
    </nav>
  );
}
