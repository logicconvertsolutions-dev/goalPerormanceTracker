'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PeriodPreset } from '@/lib/dates';

const PERIOD_LABELS: Record<PeriodPreset, string> = {
  this_week: 'This Week',
  last_week: 'Last Week',
  this_month: 'This Month',
  last_30_days: 'Last 30 Days',
  custom: 'Custom',
};

export interface FilterChip {
  key: string;
  label: string;
}

interface FilterBarProps {
  preset: PeriodPreset;
  customFrom?: string;
  customTo?: string;
  /** Extra active filters (status, source, search, ...) rendered as removable chips. */
  chips?: FilterChip[];
  /** Extra controls specific to a page (status select, search input, ...). */
  children?: React.ReactNode;
}

export function FilterBar({ preset, customFrom, customTo, chips = [], children }: FilterBarProps) {
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

  function setPreset(p: PeriodPreset) {
    pushParams({ period: p, from: p === 'custom' ? customFrom ?? null : null, to: p === 'custom' ? customTo ?? null : null });
  }

  function removeChip(key: string) {
    pushParams({ [key]: null });
  }

  function clearAll() {
    router.push(pathname);
  }

  const hasActiveFilters = chips.length > 0 || preset !== 'this_week';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-sm border border-line-2 bg-sunken p-1">
          {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={
                p === preset
                  ? 'rounded-sm bg-acc px-3 py-1.5 text-xs font-medium text-bg min-h-[32px]'
                  : 'rounded-sm px-3 py-1.5 text-xs font-medium text-fg-2 hover:bg-hover hover:text-fg min-h-[32px]'
              }
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={customFrom ?? ''}
              onChange={(e) => pushParams({ from: e.target.value })}
              className="h-9 w-auto"
              aria-label="From date"
            />
            <span className="text-fg-3 text-sm">to</span>
            <Input
              type="date"
              value={customTo ?? ''}
              onChange={(e) => pushParams({ to: e.target.value })}
              className="h-9 w-auto"
              aria-label="To date"
            />
          </div>
        )}

        {children}
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => removeChip(chip.key)}
              className="inline-flex items-center gap-1 rounded-full border border-line-2 bg-panel-2 px-2.5 py-1 text-xs text-fg-2 hover:text-fg"
            >
              {chip.label}
              <X className="h-3 w-3" />
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={clearAll} className="text-fg-3">
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}
