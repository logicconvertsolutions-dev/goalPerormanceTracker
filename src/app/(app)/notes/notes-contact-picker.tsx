'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { searchContactsAction, type ContactSearchResult } from '@/lib/contact-search-action';

/** Type-ahead that navigates to /notes?contact=<id> on selection, rather than filling a form field. */
export function NotesContactPicker({ currentName }: { currentName?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(currentName ?? '');
  const [options, setOptions] = useState<ContactSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchContactsAction(trimmed).then((results) => {
        if (!cancelled) setOptions(results);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="space-y-1.5 relative max-w-sm" ref={containerRef}>
      <Input
        autoComplete="off"
        value={query}
        placeholder="Search a contact by name…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && options.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-sm border border-line-2 bg-panel shadow-lift">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-fg hover:bg-hover min-h-[44px]"
                onClick={() => {
                  setOpen(false);
                  router.push(`/notes?contact=${o.id}`);
                }}
              >
                {o.full_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim().length >= 2 && options.length === 0 && (
        <p className="text-xs text-fg-3">No contacts match “{query.trim()}”.</p>
      )}
    </div>
  );
}
