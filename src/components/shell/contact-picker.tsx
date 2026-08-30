'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { searchContactsAction, type ContactSearchResult } from '@/lib/contact-search-action';

/**
 * Type-ahead over existing contacts. Selecting a suggestion sets a hidden
 * `${idFieldName}` so the server action can resolve the exact contact by id
 * instead of re-matching on name — that's what actually stops near-duplicate
 * contacts (a typo'd/varied name no longer silently creates a new one).
 * Typing a name with no match still submits as free text; the server's
 * case-insensitive unique match is the remaining safety net for that case.
 */
export function ContactPicker({
  label = 'Contact name',
  placeholder = 'Contact name',
  fieldName = 'contactName',
  idFieldName = 'contactId',
  phoneFieldName = 'contactPhone',
  defaultName = '',
  defaultId = '',
  onSelect,
}: {
  label?: string;
  placeholder?: string;
  fieldName?: string;
  idFieldName?: string;
  phoneFieldName?: string;
  defaultName?: string;
  defaultId?: string;
  /** Fired with the picked contact, or null once the selection is cleared
   * (e.g. the caller wants to react to which existing contact was chosen). */
  onSelect?: (contact: ContactSearchResult | null) => void;
}) {
  const [query, setQuery] = useState(defaultName);
  const [selectedId, setSelectedId] = useState(defaultId);
  const [phone, setPhone] = useState('');
  const [options, setOptions] = useState<ContactSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputId = `${fieldName}-picker`;

  useEffect(() => {
    const trimmed = query.trim();
    if (selectedId || trimmed.length < 2) {
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
  }, [query, selectedId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="space-y-1.5 relative" ref={containerRef}>
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        required
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedId('');
          onSelect?.(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      <input type="hidden" name={fieldName} value={query} />
      <input type="hidden" name={idFieldName} value={selectedId} />
      {!selectedId && query.trim().length >= 2 && (
        <Input
          type="tel"
          name={phoneFieldName}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone number"
          required
          className="mt-1.5"
        />
      )}
      {open && options.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-auto rounded-sm border border-line-2 bg-panel shadow-lift">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-fg hover:bg-hover min-h-[44px]"
                onClick={() => {
                  setQuery(o.full_name);
                  setSelectedId(o.id);
                  setOpen(false);
                  onSelect?.(o);
                }}
              >
                {o.full_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !selectedId && query.trim().length >= 2 && options.length === 0 && (
        <p className="text-xs text-fg-3">No match — this will create a new contact.</p>
      )}
    </div>
  );
}
