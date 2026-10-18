'use client';

import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { DonutChart } from '@/components/charts/donut-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { calculateTax } from '@/lib/tax/calculate';
import { formatMoney, formatPercent } from '@/lib/tax/format';
import { parseTaxParams, serializeTaxParams } from '@/lib/tax/params';
import { PROVINCE_NAMES, TAX_YEAR, type ProvinceCode } from '@/lib/tax/rates-2026';
import { PAY_PERIODS, type PayPeriod, type TaxInput, type TaxResult } from '@/lib/tax/types';
import { useSessionDraft } from '@/lib/tools/use-session-draft';
import { cn } from '@/lib/utils';

const PERIOD_LABELS: Record<PayPeriod, string> = {
  annual: 'Annual',
  monthly: 'Monthly',
  biweekly: 'Biweekly',
  weekly: 'Weekly',
  daily: 'Daily',
  hourly: 'Hourly',
};

const PERIOD_UNIT: Record<PayPeriod, string> = {
  annual: 'per year',
  monthly: 'per month',
  biweekly: 'every two weeks',
  weekly: 'per week',
  daily: 'per day',
  hourly: 'per hour',
};

const PROVINCE_OPTIONS = (Object.entries(PROVINCE_NAMES) as [ProvinceCode, string][]).sort(
  ([, a], [, b]) => a.localeCompare(b)
);

type MoneyField = Exclude<keyof TaxInput, 'province' | 'payPeriod' | 'hoursPerWeek'>;

/** Amount fields are edited as text so "1,200." mid-typing isn't clobbered. */
type Draft = Record<MoneyField | 'hoursPerWeek', string>;

function toDraft(input: TaxInput): Draft {
  const show = (n: number) => (n === 0 ? '' : String(n));
  return {
    employmentIncome: show(input.employmentIncome),
    hoursPerWeek: String(input.hoursPerWeek),
    selfEmploymentIncome: show(input.selfEmploymentIncome),
    otherIncome: show(input.otherIncome),
    capitalGains: show(input.capitalGains),
    eligibleDividends: show(input.eligibleDividends),
    nonEligibleDividends: show(input.nonEligibleDividends),
    rrspFhsaContributions: show(input.rrspFhsaContributions),
    incomeTaxesPaid: show(input.incomeTaxesPaid),
  };
}

function parseAmount(text: string): number {
  const n = Number(text.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function TaxCalculator({ initial }: { initial: TaxInput }) {
  const [province, setProvince] = useState<ProvinceCode>(initial.province);
  const [payPeriod, setPayPeriod] = useState<PayPeriod>(initial.payPeriod);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));

  const input: TaxInput = useMemo(
    () => ({
      province,
      payPeriod,
      hoursPerWeek: parseAmount(draft.hoursPerWeek) || 40,
      employmentIncome: parseAmount(draft.employmentIncome),
      selfEmploymentIncome: parseAmount(draft.selfEmploymentIncome),
      otherIncome: parseAmount(draft.otherIncome),
      capitalGains: parseAmount(draft.capitalGains),
      eligibleDividends: parseAmount(draft.eligibleDividends),
      nonEligibleDividends: parseAmount(draft.nonEligibleDividends),
      rrspFhsaContributions: parseAmount(draft.rrspFhsaContributions),
      incomeTaxesPaid: parseAmount(draft.incomeTaxesPaid),
    }),
    [province, payPeriod, draft]
  );

  const result = useMemo(() => calculateTax(input), [input]);

  const apply = (next: TaxInput) => {
    setProvince(next.province);
    setPayPeriod(next.payPeriod);
    setDraft(toDraft(next));
  };

  useSessionDraft('tax', serializeTaxParams(input).toString(), (query) =>
    apply(parseTaxParams(Object.fromEntries(new URLSearchParams(query))))
  );

  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((d) => ({ ...d, [key]: e.target.value })),
  });

  const usesHours = payPeriod === 'hourly';

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Your details</CardTitle>
              <CardDescription>
                Enter what applies — leave the rest blank. Results update as you type.
              </CardDescription>
            </div>
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              onClick={() => apply(parseTaxParams({}))}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            <fieldset className="space-y-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">
                Where and how you&apos;re paid
              </legend>
              <div className="space-y-1.5">
                <Label htmlFor="tax-province">Province or territory</Label>
                <Select value={province} onValueChange={(v) => setProvince(v as ProvinceCode)}>
                  <SelectTrigger id="tax-province">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVINCE_OPTIONS.map(([code, name]) => (
                      <SelectItem key={code} value={code}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
                <AmountInput
                  id="tax-employment"
                  label="Employment income"
                  hint={PERIOD_UNIT[payPeriod]}
                  {...field('employmentIncome')}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="tax-period">Pay period</Label>
                  <Select value={payPeriod} onValueChange={(v) => setPayPeriod(v as PayPeriod)}>
                    <SelectTrigger id="tax-period">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAY_PERIODS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PERIOD_LABELS[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {usesHours && (
                <div className="space-y-1.5">
                  <Label htmlFor="tax-hours">Hours per week</Label>
                  <Input
                    id="tax-hours"
                    inputMode="decimal"
                    autoComplete="off"
                    className="text-right font-mono tabular-nums"
                    {...field('hoursPerWeek')}
                  />
                  <p className="text-xs text-fg-3">52 weeks a year, 5 days a week.</p>
                </div>
              )}
              {result.annualEmploymentIncome > 0 && payPeriod !== 'annual' && (
                <p className="text-xs text-fg-3">
                  = {formatMoney(result.annualEmploymentIncome, { whole: true })} a year
                </p>
              )}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">
                Other income (per year)
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <AmountInput id="tax-se" label="Self-employment income" hint="net of expenses" {...field('selfEmploymentIncome')} />
                <AmountInput id="tax-other" label="Other income" hint="e.g. interest, rental" {...field('otherIncome')} />
                <AmountInput id="tax-cg" label="Capital gains" hint="50% is taxable" {...field('capitalGains')} />
                <AmountInput id="tax-ed" label="Eligible dividends" hint="actual amount received" {...field('eligibleDividends')} />
                <AmountInput id="tax-nd" label="Non-eligible dividends" hint="actual amount received" {...field('nonEligibleDividends')} />
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">
                Deductions and payments (per year)
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <AmountInput id="tax-rrsp" label="RRSP and FHSA contributions" {...field('rrspFhsaContributions')} />
                <AmountInput
                  id="tax-paid"
                  label="Income taxes paid"
                  hint="Income tax withheld only (T4 box 22), not CPP or EI"
                  {...field('incomeTaxesPaid')}
                />
              </div>
            </fieldset>
          </CardContent>
        </Card>

        <div className="space-y-4 lg:sticky lg:top-4">
          <SummaryCard
            result={result}
            // An employee's tax is withheld at source, so a balance computed
            // against $0 paid would read as a scary (and wrong) amount owing.
            showBalance={
              input.incomeTaxesPaid > 0 ||
              (result.annualEmploymentIncome === 0 && result.totalIncome > 0)
            }
          />
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Where your income goes</CardTitle>
              </CardHeader>
              <CardContent>
                <DonutChart
                  title="Net income versus taxes and contributions"
                  slices={[
                    { label: 'Net income', value: result.afterTaxIncome },
                    { label: 'Taxes and contributions', value: result.totalTax },
                  ]}
                  formatValue={(n) => formatMoney(n, { whole: true })}
                  centerValue={formatPercent(result.totalDeductionRate)}
                  centerLabel="to tax"
                  valueHeader="Amount"
                />
              </CardContent>
            </Card>
            <EmployerCard result={result} />
          </div>
        </div>
      </div>

      <BreakdownCard result={result} hoursPerWeek={input.hoursPerWeek} />

      <p className="text-xs leading-relaxed text-fg-3">
        Estimate for the {TAX_YEAR} tax year only — not tax advice. Assumes a single filer
        resident in the selected province on December 31 with no credits beyond the basic
        personal amount, CPP/QPP, EI, QPIP, the Canada employment amount and dividend tax
        credits. Not included: age, pension, spouse, dependant, tuition, medical and donation
        credits; OAS clawback; alternative minimum tax; refundable benefits; Ontario LIFT and
        other provincial low-income credits; Quebec health services fund contribution;
        employer payroll taxes. Employee CPP/QPP, EI and QPIP are assumed withheld by your
        employer. Nothing you enter is saved — it stays in this page&apos;s address only.
      </p>
    </div>
  );
}

function AmountInput({
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
  const hintId = hint ? `${id}-hint` : undefined;
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
          aria-describedby={hintId}
          className="pl-6 text-right font-mono tabular-nums"
          value={value}
          onChange={onChange}
        />
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-fg-3">
          {hint}
        </p>
      )}
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-1.5',
        strong && 'border-t border-line pt-2.5 font-semibold text-fg',
        muted ? 'pl-3 text-xs text-fg-3' : 'text-sm text-fg-2'
      )}
    >
      <dt>{label}</dt>
      <dd className="font-mono tabular-nums text-fg">{value}</dd>
    </div>
  );
}

function SummaryCard({ result: r, showBalance }: { result: TaxResult; showBalance: boolean }) {
  const refund = r.balance >= 0;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Your {TAX_YEAR} estimate</CardTitle>
          <CardDescription>{PROVINCE_NAMES[r.province]}</CardDescription>
        </div>
        {showBalance && (
          <Badge variant={refund ? 'ok' : 'warn'} className="shrink-0 text-sm">
            {refund ? 'Refund' : 'Owing'} {formatMoney(Math.abs(r.balance))}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <dl>
          <Line label="Total income" value={formatMoney(r.totalIncome)} strong />
          <Line label="Federal tax" value={formatMoney(r.federalTax)} />
          <Line label="Provincial tax" value={formatMoney(r.provincialTax)} />
          {r.ontarioHealthPremium > 0 && (
            <Line label="incl. Ontario Health Premium" value={formatMoney(r.ontarioHealthPremium)} muted />
          )}
          <Line
            label="Income tax (federal + provincial)"
            value={formatMoney(r.incomeTax)}
            strong
          />
          {r.rrspFhsaTaxSaving > 0 && (
            <Line
              label="incl. tax saved by RRSP/FHSA"
              value={`−${formatMoney(r.rrspFhsaTaxSaving)}`}
              muted
            />
          )}
          <Line label={`${r.pensionPlanLabel} contributions`} value={formatMoney(r.pensionPlan)} />
          <Line label="EI premiums" value={formatMoney(r.ei)} />
          {r.province === 'QC' && <Line label="QPIP premiums" value={formatMoney(r.qpip)} />}
          <Line label="Total tax and contributions" value={formatMoney(r.totalTax)} strong />
          <Line label="After-tax income" value={formatMoney(r.afterTaxIncome)} strong />
        </dl>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label="Average tax rate" value={formatPercent(r.averageTaxRate)} />
          <Stat label="Marginal tax rate" value={formatPercent(r.marginalTaxRate)} />
          {showBalance ? (
            <Stat
              label={refund ? 'Estimated refund' : 'Estimated owing'}
              value={formatMoney(Math.abs(r.balance), { whole: true })}
              tone={refund ? 'ok' : 'bad'}
            />
          ) : (
            <Stat label="Refund or owing" value="—" hint="Enter income taxes paid" />
          )}
        </div>
        <p className="mt-3 text-xs text-fg-3">
          Average and marginal rates are income tax only. Marginal is the tax on your next
          dollar of ordinary income. Refund/owing = income taxes paid − income tax (federal +
          provincial){r.pensionPlanLabel && ` + any self-employed ${r.pensionPlanLabel}`}. Employee{' '}
          {r.pensionPlanLabel} and EI are left out: your employer withholds exactly the right amount.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'bad';
  hint?: string;
}) {
  return (
    <div className="rounded-sm border border-line bg-sunken px-3 py-2">
      <div className="text-xs text-fg-3">{label}</div>
      <div
        className={cn(
          'mt-0.5 font-mono text-lg tabular-nums tracking-tight text-fg',
          tone === 'ok' && 'text-ok',
          tone === 'bad' && 'text-bad'
        )}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-fg-3">{hint}</div>}
    </div>
  );
}

function EmployerCard({ result: r }: { result: TaxResult }) {
  const employeeTax = r.totalTax;
  const total = r.afterTaxIncome + employeeTax + r.employer.total;
  const segments = [
    { label: 'Net income', value: r.afterTaxIncome, color: CATEGORICAL_ORDER[0] },
    { label: 'Tax you pay', value: employeeTax, color: CATEGORICAL_ORDER[1] },
    { label: 'Tax your employer pays', value: r.employer.total, color: CATEGORICAL_ORDER[2] },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Employer cost</CardTitle>
        <CardDescription>What your employer pays on top of your salary.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {r.annualEmploymentIncome === 0 ? (
          <p className="text-sm text-fg-3">Enter employment income to see your employer&apos;s share.</p>
        ) : (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
              {segments.map((s) =>
                s.value > 0 ? (
                  <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
                ) : null
              )}
            </div>
            <dl className="text-xs">
              {segments.map((s) => (
                <div key={s.label} className="flex items-center justify-between gap-2 py-0.5">
                  <dt className="flex items-center gap-1.5 text-fg-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </dt>
                  <dd className="font-mono tabular-nums text-fg">{formatMoney(s.value, { whole: true })}</dd>
                </div>
              ))}
              <div className="mt-1 border-t border-line pt-1 text-fg-3">
                <div className="flex justify-between gap-2 py-0.5">
                  <dt>Employer {r.pensionPlanLabel}</dt>
                  <dd className="font-mono tabular-nums">{formatMoney(r.employer.pensionPlan)}</dd>
                </div>
                <div className="flex justify-between gap-2 py-0.5">
                  <dt>Employer EI (1.4x)</dt>
                  <dd className="font-mono tabular-nums">{formatMoney(r.employer.ei)}</dd>
                </div>
                {r.province === 'QC' && (
                  <div className="flex justify-between gap-2 py-0.5">
                    <dt>Employer QPIP</dt>
                    <dd className="font-mono tabular-nums">{formatMoney(r.employer.qpip)}</dd>
                  </div>
                )}
              </div>
            </dl>
            <div className="flex items-baseline justify-between gap-2 border-t border-line pt-2">
              <span className="text-sm text-fg-2">Real tax rate</span>
              <span className="font-mono text-lg tabular-nums text-fg">
                {formatPercent(r.employer.realTaxRate)}
              </span>
            </div>
            <p className="text-xs text-fg-3">
              Your tax plus your employer&apos;s contributions, as a share of everything paid out
              for your work ({formatPercent(r.totalDeductionRate)} without the employer share).
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BreakdownCard({ result: r, hoursPerWeek }: { result: TaxResult; hoursPerWeek: number }) {
  const rows: { label: string; value: number; strong?: boolean }[] = [
    { label: 'Total income', value: r.totalIncome, strong: true },
    { label: 'Federal tax', value: r.federalTax },
    { label: 'Provincial tax', value: r.provincialTax },
    { label: r.pensionPlanLabel, value: r.pensionPlan },
    { label: 'EI', value: r.ei },
    ...(r.province === 'QC' ? [{ label: 'QPIP', value: r.qpip }] : []),
    { label: 'Total tax and contributions', value: r.totalTax, strong: true },
    { label: 'After-tax income', value: r.afterTaxIncome, strong: true },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">By pay period</CardTitle>
        <CardDescription>
          Annual totals spread evenly — 52 weeks, 5 days and {hoursPerWeek} hours a week.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Income, taxes and after-tax income by pay period</caption>
          <thead>
            <tr className="border-b border-line text-xs text-fg-3">
              <th scope="col" className="py-2 pr-3 text-left font-medium" />
              {r.periods.map((p) => (
                <th key={p.period} scope="col" className="px-2 py-2 text-right font-medium">
                  {PERIOD_LABELS[p.period]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.label}
                className={cn('border-b border-line last:border-0', row.strong ? 'font-semibold text-fg' : 'text-fg-2')}
              >
                <th scope="row" className="py-2 pr-3 text-left font-[inherit]">
                  {row.label}
                </th>
                {r.periods.map((p) => (
                  <td key={p.period} className="px-2 py-2 text-right font-mono tabular-nums">
                    {formatMoney(row.value / p.divisor)}
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
