'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';

/** Debounced live filter for the contacts table, via the `q` search param. */
export function ContactsSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    const trimmed = query.trim();
    const current = searchParams.get('q') ?? '';
    if (trimmed === current) return;

    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (trimmed) {
        params.set('q', trimmed);
      } else {
        params.delete('q');
      }
      router.replace(`${pathname}?${params.toString()}`);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <Input
      name="q"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Search name or notes"
      className="max-w-sm"
    />
  );
}
