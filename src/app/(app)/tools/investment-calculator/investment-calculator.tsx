'use client';

import { useMemo, useState } from 'react';
import { Printer, RotateCcw } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CATEGORICAL_ORDER } from '@/lib/chart-colors';
import { clampYears, projectInvestment } from '@/lib/invest/calculate';
import { parseInvestParams, serializeInvestParams } from '@/lib/invest/params';
import {
  MAX_YEARS,
  MIN_YEARS,
  type ContributionTiming,
  type InvestInput,
  type InvestResult,
  type RateProjection,
} from '@/lib/invest/types';
import { formatMoney, formatPercent } from '@/lib/tax/format';
import { useSessionDraft } from '@/lib/tools/use-session-draft';
import { cn } from '@/lib/utils';

const CONTRIBUTED_COLOR = '#94A0B8';
const GRID = 'rgba(11,30,61,.08)';
const AXIS_TICK = { fill: '#94A0B8', fontSize: 11 };

const compactMoney = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  currencyDisplay: 'narrowSymbol',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const whole = (n: number) => formatMoney(n, { whole: true });

/** Rates are displayed as typed percentages ("6", "7.5"). */
function pctText(fraction: number): string {
  return String(Math.round(fraction * 1e8) / 1e6);
}

/** Text drafts so "7." or "1,000" mid-typing isn't clobbered. */
interface Draft {
  lumpSum: string;
  monthly: string;
  years: string;
  increase: string;
  inflation: string;
  goal: string;
  rates: string[];
  on: boolean[];
  timing: ContributionTiming;
  showReal: boolean;
}

function toDraft(input: InvestInput): Draft {
  const money = (n: number) => (n === 0 ? '' : String(n));
  return {
    lumpSum: money(input.lumpSum),
    monthly: money(input.monthly),
    years: String(input.years),
    increase: input.contributionIncrease === 0 ? '' : pctText(input.contributionIncrease),
    inflation: pctText(input.inflation),
    goal: money(input.goal),
    rates: input.rates.map((r) => pctText(r.rate)),
    on: input.rates.map((r) => r.on),
    timing: input.timing,
    showReal: input.showReal,
  };
}

function num(text: string): number {
  const n = Number(text.replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Percent text -> fraction, capped like the URL schema. */
function fraction(text: string, maxPct: number): number {
  return Math.round(Math.min(num(text), maxPct) * 1e6) / 1e8;
}

function slotColor(slot: number): string {
  return CATEGORICAL_ORDER[slot % CATEGORICAL_ORDER.length];
}

export function InvestmentCalculator({ initial }: { initial: InvestInput }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));

  const input: InvestInput = useMemo(
    () => ({
      lumpSum: num(draft.lumpSum),
      monthly: num(draft.monthly),
      years: clampYears(num(draft.years) || MIN_YEARS),
      rates: draft.rates.map((r, i) => ({ rate: fraction(r, 30), on: draft.on[i] })),
      contributionIncrease: fraction(draft.increase, 50),
      timing: draft.timing,
      inflation: fraction(draft.inflation, 20),
      showReal: draft.showReal,
      goal: num(draft.goal),
    }),
    [draft]
  );

  const result = useMemo(() => projectInvestment(input), [input]);

  useSessionDraft('investment', serializeInvestParams(input).toString(), (query) =>
    setDraft(toDraft(parseInvestParams(Object.fromEntries(new URLSearchParams(query)))))
  );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const text = (key: 'lumpSum' | 'monthly' | 'increase' | 'inflation' | 'goal') => ({
    value: draft[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value),
  });

  const hasMoney = input.lumpSum > 0 || input.monthly > 0;
  const dollars = input.showReal ? "today's dollars" : 'future dollars';

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2 print:hidden">
        <Button type="button" size="sm" onClick={() => window.print()} disabled={!hasMoney}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          Print / save as PDF
        </Button>
        <Button type="button" size="sm" onClick={() => setDraft(toDraft(parseInvestParams({})))}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reset
        </Button>
      </div>

      <p className="hidden text-sm text-fg-2 print:block">
        {whole(input.lumpSum)} to start, {whole(input.monthly)} a month
        {input.contributionIncrease > 0 && ` rising ${formatPercent(input.contributionIncrease)} a year`},
        contributed at the {input.timing === 'start' ? 'start' : 'end'} of each month, over{' '}
        {input.years} years. Monthly compounding. Values in {dollars}
        {input.showReal && ` (${formatPercent(input.inflation)} inflation)`}.
      </p>

      {/* Printing drops the input card, so the results take the full width. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start print:block">
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle>Your plan</CardTitle>
            <CardDescription>Results update as you type.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <MoneyInput id="inv-lump" label="Lump-sum investment" {...text('lumpSum')} />
              <MoneyInput id="inv-monthly" label="Monthly contribution" {...text('monthly')} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inv-years">Years</Label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={MIN_YEARS}
                  max={MAX_YEARS}
                  value={input.years}
                  onChange={(e) => set('years', e.target.value)}
                  aria-label="Years"
                  className="h-2 flex-1 cursor-pointer accent-[#0B1E3D]"
                />
                <Input
                  id="inv-years"
                  inputMode="numeric"
                  autoComplete="off"
                  className="w-20 text-right font-mono tabular-nums"
                  value={draft.years}
                  onChange={(e) => set('years', e.target.value)}
                  onBlur={() => set('years', String(input.years))}
                />
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">
                Growth rates to compare (per year)
              </legend>
              {draft.rates.map((rate, slot) => (
                <div key={slot} className="flex items-center gap-3">
                  <Checkbox
                    id={`inv-rate-on-${slot}`}
                    checked={draft.on[slot]}
                    onCheckedChange={(v) =>
                      set('on', draft.on.map((o, i) => (i === slot ? v === true : o)))
                    }
                    aria-label={`Compare rate ${slot + 1}`}
                  />
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ background: slotColor(slot) }}
                    aria-hidden="true"
                  />
                  <Label htmlFor={`inv-rate-${slot}`} className="w-16 shrink-0 text-fg-2">
                    Rate {slot + 1}
                  </Label>
                  <div className="relative w-28">
                    <Input
                      id={`inv-rate-${slot}`}
                      inputMode="decimal"
                      autoComplete="off"
                      className="pr-7 text-right font-mono tabular-nums"
                      value={rate}
                      disabled={!draft.on[slot]}
                      onChange={(e) =>
                        set('rates', draft.rates.map((r, i) => (i === slot ? e.target.value : r)))
                      }
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-fg-3">
                      %
                    </span>
                  </div>
                </div>
              ))}
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="inv-timing">Contribution timing</Label>
                <Select value={draft.timing} onValueChange={(v) => set('timing', v as ContributionTiming)}>
                  <SelectTrigger id="inv-timing">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="end">End of month</SelectItem>
                    <SelectItem value="start">Start of month</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <PercentInput
                id="inv-increase"
                label="Raise contribution yearly"
                hint="e.g. 3 = +3% each year"
                {...text('increase')}
              />
              <MoneyInput id="inv-goal" label="Goal (optional)" hint="adds a target line" {...text('goal')} />
              <PercentInput id="inv-inflation" label="Inflation" {...text('inflation')} />
            </div>

            <label className="flex cursor-pointer items-center gap-3 text-sm text-fg-2">
              <Checkbox
                checked={draft.showReal}
                onCheckedChange={(v) => set('showReal', v === true)}
              />
              Show values in today&apos;s dollars (adjusted for inflation)
            </label>
          </CardContent>
        </Card>

        <div className="space-y-4 lg:sticky lg:top-4 print:static">
          <GrowthChart result={result} input={input} hasMoney={hasMoney} dollars={dollars} />
          {hasMoney && result.projections.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 print:grid-cols-4">
              {result.projections.map((p) => (
                <RateSummary key={p.slot} projection={p} goal={input.goal} />
              ))}
            </div>
          )}
        </div>
      </div>

      {hasMoney && result.projections.length > 0 && <YearTable result={result} dollars={dollars} />}

      <p className="text-xs leading-relaxed text-fg-3">
        Illustration only — not a forecast or financial advice. Assumes a constant annual return
        compounded monthly, with no fees, taxes, withdrawals or market ups and downs. Real returns
        vary year to year and are not guaranteed. Nothing you enter is saved to Kautis — it stays
        in this browser tab and clears when you close it or sign out.
      </p>
    </div>
  );
}

function MoneyInput({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-fg-3">
          $
        </span>
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="pl-6 text-right font-mono tabular-nums"
          value={value}
          onChange={onChange}
        />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-fg-3">
          {hint}
        </p>
      )}
    </div>
  );
}

function PercentInput({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="pr-7 text-right font-mono tabular-nums"
          value={value}
          onChange={onChange}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-fg-3">
          %
        </span>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-fg-3">
          {hint}
        </p>
      )}
    </div>
  );
}

function rateLabel(p: RateProjection): string {
  return `${formatPercent(p.rate).replace(/\.00%$/, '%')} a year`;
}

function GrowthChart({
  result,
  input,
  hasMoney,
  dollars,
}: {
  result: InvestResult;
  input: InvestInput;
  hasMoney: boolean;
  dollars: string;
}) {
  const data = result.contributed.map((c, i) => {
    const point: Record<string, number> = { year: c.year, contributed: c.contributed };
    for (const p of result.projections) point[`s${p.slot}`] = p.rows[i].balance;
    return point;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Growth over {input.years} years</CardTitle>
        <CardDescription>Balance at each year end, in {dollars}.</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasMoney ? (
          <p className="py-16 text-center text-sm text-fg-3">
            Enter a lump sum or a monthly contribution to see your growth.
          </p>
        ) : result.projections.length === 0 ? (
          <p className="py-16 text-center text-sm text-fg-3">Select at least one growth rate to compare.</p>
        ) : (
          <>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis
                    dataKey="year"
                    tick={AXIS_TICK}
                    axisLine={{ stroke: GRID }}
                    tickLine={false}
                    label={{ value: 'Year', position: 'insideBottomRight', offset: -2, fill: '#94A0B8', fontSize: 11 }}
                  />
                  <YAxis
                    tick={AXIS_TICK}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                    tickFormatter={(v: number) => compactMoney.format(v)}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [whole(value), name]}
                    labelFormatter={(year) => `Year ${year}`}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  {input.goal > 0 && (
                    <ReferenceLine
                      y={input.goal}
                      stroke="#B0392A"
                      strokeDasharray="4 4"
                      label={{ value: `Goal ${compactMoney.format(input.goal)}`, position: 'insideTopLeft', fill: '#B0392A', fontSize: 11 }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="contributed"
                    name="Total contributed"
                    stroke={CONTRIBUTED_COLOR}
                    strokeDasharray="5 4"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  {result.projections.map((p) => (
                    <Line
                      key={p.slot}
                      type="monotone"
                      dataKey={`s${p.slot}`}
                      name={rateLabel(p)}
                      stroke={slotColor(p.slot)}
                      strokeWidth={2.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
              {result.projections.map((p) => (
                <li key={p.slot} className="flex items-center gap-1.5">
                  <span className="h-2 w-4 rounded-full" style={{ background: slotColor(p.slot) }} />
                  {rateLabel(p)}
                </li>
              ))}
              <li className="flex items-center gap-1.5">
                <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: CONTRIBUTED_COLOR }} />
                Total contributed
              </li>
            </ul>
            {/* Screen-reader / no-JS fallback table (03-ui.md: every chart needs one). */}
            <table className="sr-only">
              <caption>Projected balance by year for each growth rate, in {dollars}</caption>
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Total contributed</th>
                  {result.projections.map((p) => (
                    <th key={p.slot}>{rateLabel(p)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.year}>
                    <td>{d.year}</td>
                    <td>{whole(d.contributed)}</td>
                    {result.projections.map((p) => (
                      <td key={p.slot}>{whole(d[`s${p.slot}`])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RateSummary({ projection: p, goal }: { projection: RateProjection; goal: number }) {
  const { balance, contributed, growth } = p.final;
  const contributedShare = balance > 0 ? Math.min(1, contributed / balance) : 1;
  return (
    <div className="rounded-lg border border-line bg-panel p-3 shadow-card">
      <div className="flex items-center gap-2 text-xs font-medium text-fg-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: slotColor(p.slot) }} />
        {rateLabel(p)}
      </div>
      <div className="mt-1 font-mono text-xl tabular-nums tracking-tight text-fg">{whole(balance)}</div>
      <div
        className="mt-2 flex h-2 overflow-hidden rounded-full bg-sunken"
        role="img"
        aria-label={`${formatPercent(contributedShare)} contributions, ${formatPercent(1 - contributedShare)} growth`}
      >
        <div style={{ width: `${contributedShare * 100}%`, background: CONTRIBUTED_COLOR }} />
        <div style={{ width: `${(1 - contributedShare) * 100}%`, background: slotColor(p.slot) }} />
      </div>
      <dl className="mt-2 space-y-0.5 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-fg-3">You put in</dt>
          <dd className="font-mono tabular-nums text-fg-2">{whole(contributed)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-fg-3">Growth earned</dt>
          <dd className="font-mono tabular-nums text-fg-2">{whole(growth)}</dd>
        </div>
        {goal > 0 && (
          <div className="flex justify-between gap-2">
            <dt className="text-fg-3">Goal</dt>
            <dd className={cn('font-medium', p.goalReached ? 'text-ok' : 'text-fg-3')}>
              {p.goalReached
                ? p.goalReached.year === 0
                  ? 'Already reached'
                  : `Reached in year ${p.goalReached.year}`
                : 'Not reached'}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function YearTable({ result, dollars }: { result: InvestResult; dollars: string }) {
  return (
    <Card className="print:break-before-page">
      <CardHeader>
        <CardTitle className="text-base">Year by year</CardTitle>
        <CardDescription>Balance at each year end, in {dollars}.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">Year-by-year balance for each growth rate</caption>
          <thead>
            <tr className="border-b border-line text-xs text-fg-3">
              <th scope="col" className="py-2 pr-3 text-left font-medium">
                Year
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Total contributed
              </th>
              {result.projections.map((p) => (
                <th key={p.slot} scope="col" className="px-2 py-2 text-right font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: slotColor(p.slot) }} />
                    {rateLabel(p)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.contributed.slice(1).map((c, i) => (
              <tr key={c.year} className="border-b border-line text-fg-2 last:border-0">
                <th scope="row" className="py-1.5 pr-3 text-left font-mono font-normal tabular-nums">
                  {c.year}
                </th>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{whole(c.contributed)}</td>
                {result.projections.map((p) => (
                  <td key={p.slot} className="px-2 py-1.5 text-right font-mono tabular-nums text-fg">
                    {whole(p.rows[i + 1].balance)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
