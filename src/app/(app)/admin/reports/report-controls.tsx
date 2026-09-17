'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import type { ReportColumn } from '@/lib/reports/report-types';

interface Org {
  id: string;
  name: string;
}

// Org filter + column picker, kept in URL search params like every other
// filter in this app (CLAUDE.md: "Filter state lives in URL search params,
// never client state"). Not folded into <FilterBar> itself since two of the
// four report types have no date range at all -- this renders standalone
// for those, and inside FilterBar's children slot for the other two.
export function ReportControls({
  orgs,
  currentOrgId,
  columns,
  selectedColumns,
}: {
  orgs: Org[];
  currentOrgId: string | null;
  columns: ReportColumn[];
  selectedColumns: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function pushParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggleColumn(key: string, checked: boolean) {
    const next = checked ? [...selectedColumns, key] : selectedColumns.filter((k) => k !== key);
    pushParams({ cols: next.join(',') });
  }

  return (
    <div className="flex flex-wrap items-start gap-4">
      <Select
        value={currentOrgId ?? 'all'}
        onValueChange={(v) => pushParams({ org: v === 'all' ? null : v })}
      >
        <SelectTrigger className="h-9 w-56">
          <SelectValue placeholder="All organizations" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All organizations</SelectItem>
          {orgs.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex flex-wrap gap-3">
        {columns.map((col) => (
          <label key={col.key} className="flex items-center gap-1.5 text-xs text-fg-2">
            <Checkbox
              checked={selectedColumns.includes(col.key)}
              onCheckedChange={(checked) => toggleColumn(col.key, checked === true)}
            />
            {col.label}
          </label>
        ))}
      </div>
    </div>
  );
}
