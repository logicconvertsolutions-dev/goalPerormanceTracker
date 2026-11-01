'use client';

import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/* Small inputs shared by the Client Snapshot sections. */

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-fg-3">{hint}</p>}
    </div>
  );
}

export function MoneyInput({
  value,
  onChange,
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative min-w-0">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-fg-3">$</span>
      <Input
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        className={cn('pl-6 text-right font-mono tabular-nums', className)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </div>
  );
}

export function MoneyField({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <MoneyInput id={id} value={value} onChange={onChange} placeholder={placeholder} />
    </Field>
  );
}

export function PercentField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field id={id} label={label}>
      <div className="relative min-w-0">
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          className="pr-7 text-right font-mono tabular-nums"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-fg-3">%</span>
      </div>
    </Field>
  );
}

export function NativeSelect({
  id,
  value,
  onChange,
  options,
  className,
  ...rest
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  className?: string;
  'aria-label'?: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('h-11 w-full min-w-0 rounded-sm border border-line-2 bg-sunken px-2 text-sm text-fg disabled:opacity-60', className)}
      {...rest}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={label}
      className="h-9 min-h-0 w-9 justify-self-end print:hidden"
      onClick={onClick}
    >
      <Trash2 className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

export function Num({ children }: { children: React.ReactNode }) {
  return <span className="font-mono tabular-nums text-fg">{children}</span>;
}

/** `minus` rows are deductions: shown as "−$X", but a zero stays "$0.00" (P40: never -$0). */
