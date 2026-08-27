'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Target {
  calls_per_week: number;
  appts_held_per_week: number;
  premium_cents_per_week: number;
  min_calls_per_day: number;
}

const STEPS = ['Your goals', 'What your SMD sees', 'Your spreadsheet'] as const;

export function OnboardingSteps({ target }: { target: Target | null }) {
  const router = useRouter();
  const [step, setStep] = useState(0);

  function finish() {
    router.push('/log');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-8 rounded-full ${i <= step ? 'bg-acc' : 'bg-line-2'}`}
            />
          ))}
        </div>
        <button onClick={finish} className="text-sm text-fg-3 hover:text-fg-2">
          Skip
        </button>
      </div>

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Your goals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-fg-2">
              Your SMD sets these. You&apos;ll see your progress against them.
            </p>
            {target ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-fg-3">Calls / week</dt>
                  <dd className="font-mono tabular-nums text-fg">{target.calls_per_week}</dd>
                </div>
                <div>
                  <dt className="text-fg-3">Appts held / week</dt>
                  <dd className="font-mono tabular-nums text-fg">
                    {target.appts_held_per_week}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-3">Premium / week</dt>
                  <dd className="font-mono tabular-nums text-fg">
                    ${(target.premium_cents_per_week / 100).toFixed(0)}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-3">Min calls / day</dt>
                  <dd className="font-mono tabular-nums text-fg">
                    {target.min_calls_per_day}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-fg-3">Goals aren&apos;t set yet.</p>
            )}
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>What your SMD can see</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-fg-2">
              Your SMD sees your numbers — calls, appointments, premium, streak. They
              never see who you called or what you talked about.
            </p>
            <div className="rounded-sm border border-line-2 bg-panel-2 p-3 text-sm space-y-1">
              <p className="text-fg">✓ Calls made this week: 37</p>
              <p className="text-fg">✓ Appointments held: 4</p>
              <p className="text-fg-4 line-through">✗ Contact names</p>
              <p className="text-fg-4 line-through">✗ Call notes</p>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Bring your spreadsheet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-fg-2">
              Import your existing tracker once, or start fresh.
            </p>
            <div className="flex flex-col gap-2">
              <Button variant="secondary" asChild>
                <Link href="/import">Import spreadsheet</Link>
              </Button>
              <Button variant="ghost" onClick={finish}>
                Start fresh
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
            Continue
          </Button>
        ) : (
          <Button variant="primary" onClick={finish}>
            Get started
          </Button>
        )}
      </div>
    </div>
  );
}
