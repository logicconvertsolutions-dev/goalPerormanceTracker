'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export interface AgentOption {
  id: string;
  full_name: string;
}

/**
 * Downline agent multi-select for /team. Writes a comma-joined `agents`
 * search param; empty/absent means "all agents" (08-screen-specs.md).
 * A DropdownMenu + DropdownMenuCheckboxItem instead of a Command palette —
 * the roster is small at pilot scale and this avoids a new dependency.
 */
export function AgentMultiSelect({ agents }: { agents: AgentOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // DropdownMenuContent doesn't expose onOpenAutoFocus in this Radix
  // version, and it auto-focuses the first checkbox item on open by
  // default — steal focus back to the search box right after so typing
  // works immediately without an extra click.
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const selected = new Set((searchParams.get('agents') ?? '').split(',').filter(Boolean));
  const allSelected = selected.size === 0;

  function commit(next: Set<string>) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.size === 0 || next.size === agents.length) params.delete('agents');
    else params.set('agents', [...next].join(','));
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggle(id: string) {
    const next = new Set(allSelected ? agents.map((a) => a.id) : selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    commit(next);
  }

  const filtered = agents.filter((a) => a.full_name.toLowerCase().includes(filter.toLowerCase()));
  const label = allSelected
    ? 'All agents'
    : selected.size === 1
      ? agents.find((a) => selected.has(a.id))?.full_name ?? '1 agent'
      : `${selected.size} agents`;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="gap-1.5">
          {label}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="start" onCloseAutoFocus={() => setFilter('')}>
        <div className="px-1 pb-1">
          <Input
            ref={searchRef}
            placeholder="Search agents..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 text-xs"
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={allSelected}
          onSelect={(e) => {
            e.preventDefault();
            commit(new Set());
          }}
        >
          All agents
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-2 py-2 text-xs text-fg-3">No matches</p>
          ) : (
            filtered.map((a) => (
              <DropdownMenuCheckboxItem
                key={a.id}
                checked={allSelected || selected.has(a.id)}
                onSelect={(e) => {
                  e.preventDefault();
                  toggle(a.id);
                }}
              >
                {a.full_name}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
