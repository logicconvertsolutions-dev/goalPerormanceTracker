'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

const SOURCES = [
  { value: 'warm_market', label: 'Warm market' },
  { value: 'referral', label: 'Referral' },
  { value: 'cold', label: 'Cold' },
  { value: 'social_media', label: 'Social media' },
  { value: 'friend', label: 'Friend' },
  { value: 'other', label: 'Other' },
];

/** Source filter for the Calls tab of /logs — updates the `source` search
 * param on change so the server component re-filters the query. */
export function CallsSourceFilter({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    if (e.target.value) params.set('source', e.target.value);
    else params.delete('source');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      value={value}
      onChange={handleChange}
      aria-label="Filter by source"
      className="h-9 rounded-sm border border-line-2 bg-sunken px-2 text-xs text-fg"
    >
      <option value="">All sources</option>
      {SOURCES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
