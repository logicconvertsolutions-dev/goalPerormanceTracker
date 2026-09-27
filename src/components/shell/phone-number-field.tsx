'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatPhone, parsePhone, phoneError } from '@/lib/phone';

/**
 * Optional contact phone number (P33), submitted as `phoneNumber`. The server
 * action re-validates (lib/phone.ts optionalPhoneSchema); this only catches a
 * missing country code while the person is still looking at the field, and
 * offers the +1 fix in one tap instead of just saying no.
 */
export function PhoneNumberField({ defaultValue }: { defaultValue?: string | null }) {
  const [value, setValue] = useState(defaultValue ? formatPhone(defaultValue) : '');
  const [touched, setTouched] = useState(false);

  const parsed = value.trim() ? parsePhone(value) : null;
  const problem = touched && parsed && !parsed.ok ? parsed : null;
  const suggestion = problem?.reason === 'missing_country_code' ? problem.suggestion : null;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="phoneNumber">Phone (optional)</Label>
      <Input
        id="phoneNumber"
        name="phoneNumber"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        placeholder="+1 416 555 0123"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={problem ? true : undefined}
        aria-describedby="phoneNumber-help"
        maxLength={32}
      />
      <p id="phoneNumber-help" className={problem ? 'text-xs text-bad' : 'text-xs text-fg-3'} aria-live="polite">
        {problem ? phoneError(problem) : 'Include the country code (+1 for Canada and the US). Only you can see it.'}
        {suggestion && (
          <>
            {' '}
            <button
              type="button"
              onClick={() => setValue(formatPhone(suggestion))}
              className="font-bold text-acc hover:underline"
            >
              Use {formatPhone(suggestion)}
            </button>
          </>
        )}
      </p>
    </div>
  );
}
