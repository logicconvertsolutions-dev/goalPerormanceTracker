'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface OrgOption {
  id: string;
  name: string;
}

interface SmdOption {
  id: string;
  fullName: string;
  orgName: string;
}

/** Debounced name/email search plus org/SMD filters for the admin agents table, all via URL search params (`q`, `org`, `smd`) so results are shareable/bookmarkable and survive a refresh. */
export function AgentsFilterBar({
  initialQuery,
  orgs,
  smds,
}: {
  initialQuery: string;
  orgs: OrgOption[];
  smds: SmdOption[];
}) {
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
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
      router.replace(`${pathname}?${params.toString()}`);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value === '__all__') params.delete(key);
    else params.set(key, value);
    router.replace(`${pathname}?${params.toString()}`);
  }

  const currentOrg = searchParams.get('org') ?? '__all__';
  const currentSmd = searchParams.get('smd') ?? '__all__';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name or email"
        className="max-w-xs"
      />
      <Select value={currentOrg} onValueChange={(v) => setParam('org', v)}>
        <SelectTrigger className="h-9 w-44 text-sm">
          <SelectValue placeholder="Organisation" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All organisations</SelectItem>
          {orgs.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={currentSmd} onValueChange={(v) => setParam('smd', v)}>
        <SelectTrigger className="h-9 w-44 text-sm">
          <SelectValue placeholder="SMD" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All SMDs</SelectItem>
          {smds.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.fullName} ({s.orgName})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
