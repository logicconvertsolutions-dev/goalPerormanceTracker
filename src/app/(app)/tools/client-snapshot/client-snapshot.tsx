'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, FolderOpen, Lock, Plus, Printer, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DonutChart, type DonutSlice } from '@/components/charts/donut-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MAX_YEARS, MIN_YEARS } from '@/lib/invest/types';
import {
  ageOn,
  estimateDeposit,
  reconcileDeposit,
  goalMonthly,
  suggestions,
  summarize,
  toMonthly,
} from '@/lib/snapshot/calculate';
import { browserTimeZone, formatLongDate, isoToDateInZone, todayIso } from '@/lib/dates';
import { buildSnapshotFile, hasUnsavedChanges, parseSnapshotFile } from '@/lib/snapshot/file';
import {
  defaultForm,
  EMPTY_META,
  newChild,
  newDebt,
  newExpense,
  parseAmount,
  parseDraft,
  serializeDraft,
  toHousehold,
  type PersonForm,
  type SnapshotForm,
  type SnapshotMeta,
} from '@/lib/snapshot/form';
import {
  DEBT_KINDS,
  DEBT_KIND_LABELS,
  FREQUENCIES,
  FREQUENCY_LABELS,
  type DebtResult,
  type Frequency,
} from '@/lib/snapshot/types';
import { formatMoney, formatPercent } from '@/lib/tax/format';
import { PROVINCE_NAMES, type ProvinceCode } from '@/lib/tax/rates-2026';
import { loadDraft, saveDraft } from '@/lib/tools/session-draft';
import { cn } from '@/lib/utils';
import { Field, MoneyField, MoneyInput, NativeSelect, Num, PercentField, RemoveButton } from './fields';
import { PayrollDeductions } from './payroll-deductions';
import { Recommendations } from './recommendations';

const SAVE_DELAY_MS = 400;
const whole = (n: number) => formatMoney(n, { whole: true });
const money = (n: number) => formatMoney(n);

type Who = 'client' | 'spouse';
/** PersonForm fields that hold text (everything but the payroll rows). */
type PersonText = { [K in keyof PersonForm]: PersonForm[K] extends string ? K : never }[keyof PersonForm];
type ListKey = 'children' | 'debts' | 'expenses' | 'goals';
type Row<K extends ListKey> = SnapshotForm[K][number];

const PROVINCES = (Object.entries(PROVINCE_NAMES) as [ProvinceCode, string][]).sort((a, b) =>
  a[1].localeCompare(b[1])
);

function payoffText(r: DebtResult): string {
  if (r.payoffMonths === null) return 'Payment only covers interest — never paid off';
  if (r.payoffMonths === 0) return '';
  const y = Math.floor(r.payoffMonths / 12);
  const m = r.payoffMonths % 12;
  const span = [y && `${y} yr`, m && `${m} mo`].filter(Boolean).join(' ');
  return `Paid off in ${span} · ${whole(r.totalInterest ?? 0)} interest`;
}

/** "November 1, 2026" for a snapshot's ISO savedAt, in the agent's own zone. */
function savedOn(savedAt: string): string {
  return savedAt ? formatLongDate(isoToDateInZone(savedAt, browserTimeZone())) : '';
}

type PendingAction = 'reset' | 'open';

export function ClientSnapshot() {
  const [form, setForm] = useState<SnapshotForm>(defaultForm);
  const [meta, setMeta] = useState<SnapshotMeta>(EMPTY_META);
  const [restored, setRestored] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const today = useMemo(() => new Date(), []);

  // Restore this tab's draft once, then save (debounced). Saving waits for
  // the restore so the blank first render can't overwrite the draft. The
  // draft carries the snapshot's version too, so leaving and coming back
  // keeps "v3 · unsaved changes" accurate.
  useEffect(() => {
    const draft = parseDraft(loadDraft('snapshot'));
    setForm(draft.form);
    setMeta(draft.meta);
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    const handle = window.setTimeout(() => saveDraft('snapshot', serializeDraft(form, meta)), SAVE_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [form, meta, restored]);

  const dirty = useMemo(() => hasUnsavedChanges(form, meta), [form, meta]);

  // Closing or reloading the tab loses the draft; navigating inside Kautis doesn't.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const household = useMemo(() => toHousehold(form), [form]);
  const summary = useMemo(() => summarize(household, today), [household, today]);

  // Calculated deposit, marginal rate and refund split per person (P43c),
  // plus a prompt when a typed deposit doesn't match the calculation.
  const pay = useMemo(() => {
    const of = (p: typeof household.client | null) =>
      p ? { est: estimateDeposit(p, household.province), gap: reconcileDeposit(p, household.province) } : null;
    return { client: of(household.client), spouse: of(household.spouse) };
  }, [household]);

  const names = { client: form.client.name.trim(), spouse: form.spouse.name.trim() };
  const label = (who: Who) => names[who] || (who === 'client' ? 'Client' : 'Spouse');
  const people: Who[] = form.hasSpouse ? ['client', 'spouse'] : ['client'];

  const tips = useMemo(
    () =>
      suggestions(household, summary, {
        names: { client: form.client.name.trim(), spouse: form.spouse.name.trim() },
        marginalRate: pay.client?.est?.marginalRate ?? null,
        debtLabels: form.debts.map((d) => d.label.trim()),
        debtIds: form.debts.map((d) => d.id),
      }),
    [household, summary, form.client.name, form.spouse.name, form.debts, pay.client]
  );

  /* ---------- updaters ---------- */

  const set = <K extends keyof SnapshotForm>(key: K, value: SnapshotForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setPerson = (who: Who, key: PersonText, value: string) =>
    setForm((f) => ({ ...f, [who]: { ...f[who], [key]: value } }));

  const patchRow = <K extends ListKey>(key: K, id: string, patch: Partial<Row<K>>) =>
    setForm((f) => ({
      ...f,
      [key]: (f[key] as Row<K>[]).map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));

  const removeRow = (key: ListKey, id: string) =>
    setForm((f) => ({ ...f, [key]: (f[key] as { id: string }[]).filter((r) => r.id !== id) }));

  const addRow = <K extends ListKey>(key: K, row: Row<K>) =>
    setForm((f) => ({ ...f, [key]: [...(f[key] as Row<K>[]), row] }));

  const personField = (who: Who, key: PersonText) => ({
    value: form[who][key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPerson(who, key, e.target.value),
  });

  const personMoney = (who: Who, key: PersonText) => ({
    value: form[who][key] as string,
    onChange: (v: string) => setPerson(who, key, v),
  });

  /* ---------- derived display ---------- */

  const expenseSlices: DonutSlice[] = useMemo(() => {
    const lines = form.expenses
      .map((e, i) => ({
        label: e.label.trim() || 'Unnamed',
        value: toMonthly(household.expenses[i].amount, e.frequency),
      }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
    const top = lines.slice(0, 3);
    const rest = lines.slice(3).reduce((s, l) => s + l.value, 0);
    return [
      ...(summary.debtPayments > 0 ? [{ label: 'Debt payments', value: summary.debtPayments }] : []),
      ...top,
      ...(rest > 0 ? [{ label: 'Everything else', value: rest }] : []),
    ].map((s) => ({ ...s, value: Math.round(s.value * 100) / 100 }));
  }, [form.expenses, household.expenses, summary.debtPayments]);

  const hasData = summary.totalNetIncome > 0 || summary.totalExpenses > 0 || summary.assets > 0;
  const balanceTone = summary.balance < 0 ? 'text-bad' : summary.balance > 0 ? 'text-ok' : 'text-fg';

  /* ---------- snapshot files ---------- */

  /** Saves the snapshot to the agent's device; the version only goes up when something changed. */
  const downloadSnapshot = () => {
    const out = buildSnapshotFile(form, meta, summary, new Date(), todayIso(browserTimeZone()));
    const url = URL.createObjectURL(new Blob([out.json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = out.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMeta(out.meta);
    toast.success(`Saved ${out.filename}`);
  };

  const resetSnapshot = () => {
    setForm(defaultForm());
    setMeta(EMPTY_META);
  };

  const chooseFile = () => fileInput.current?.click();

  const runAction = (action: PendingAction) => (action === 'reset' ? resetSnapshot() : chooseFile());

  /** Reset/Open replace what's on screen, so ask first when it isn't in a file yet. */
  const requestAction = (action: PendingAction) => (dirty ? setPending(action) : runAction(action));

  const openFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so choosing the same file again still fires
    if (!file) return;
    const parsed = parseSnapshotFile(await file.text());
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    setForm(parsed.form);
    setMeta(parsed.meta);
    const who = parsed.form.client.name.trim() || 'Client';
    const when = parsed.meta.savedAt ? ` (${savedOn(parsed.meta.savedAt)})` : '';
    toast.success(`Opened ${who}, snapshot v${parsed.meta.version}${when}`);
  };

  const status =
    meta.version === 0
      ? hasData
        ? 'Not saved to a file yet'
        : null
      : dirty
        ? `Unsaved changes since v${meta.version}`
        : `Snapshot v${meta.version} · saved ${savedOn(meta.savedAt)}`;

  return (
    <div className="space-y-4">
      <div className="space-y-2 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {status && (
              <span
                role="status"
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium',
                  dirty ? 'bg-warn-dim text-warn' : 'bg-ok-dim text-ok'
                )}
              >
                {status}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="primary" onClick={downloadSnapshot} disabled={!hasData && meta.version === 0}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Download snapshot
            </Button>
            <Button type="button" size="sm" onClick={() => requestAction('open')}>
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              Open snapshot
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={openFile}
            />
            <Button type="button" size="sm" onClick={() => window.print()} disabled={!hasData}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print / save as PDF
            </Button>
            <Button type="button" size="sm" onClick={() => requestAction('reset')}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset
            </Button>
          </div>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-fg-3">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Nothing is saved to Kautis. This tab keeps your work until you sign out; use Download snapshot to keep it.
          The file contains the client&apos;s personal details, so save it in the client&apos;s folder.
        </p>
      </div>

      {meta.version > 0 && (
        <p className="hidden text-sm text-fg-2 print:block">
          Snapshot v{meta.version}
          {meta.savedAt && ` · ${savedOn(meta.savedAt)}`}
          {dirty && ' (with changes since)'}
        </p>
      )}

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this snapshot first?</DialogTitle>
            <DialogDescription>
              {meta.version > 0
                ? `You've changed this snapshot since v${meta.version} was saved.`
                : "This snapshot hasn't been saved to a file yet."}{' '}
              {pending === 'open' ? 'Opening another snapshot' : 'Resetting'} will clear it from this page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-wrap">
            <Button type="button" size="sm" variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => {
                const action = pending!;
                setPending(null);
                runAction(action);
              }}
            >
              Discard changes
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={() => {
                const action = pending!;
                setPending(null);
                downloadSnapshot();
                runAction(action);
              }}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download snapshot first
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start print:flex print:flex-col print:gap-4">
        <div className="space-y-4">
          {/* ---------- Household ---------- */}
          <Section title="Household" description="Names and dates of birth stay on this device.">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Field id="snap-province" label="Province of residence">
                <NativeSelect
                  id="snap-province"
                  value={form.province}
                  onChange={(v) => set('province', v as ProvinceCode)}
                  options={PROVINCES.map(([code, name]) => [code, name])}
                />
              </Field>
            </div>

            {people.map((who) => (
              <div key={who} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
                <Field id={`snap-${who}-name`} label={who === 'client' ? 'Client name' : 'Spouse / partner name'}>
                  <Input id={`snap-${who}-name`} autoComplete="off" maxLength={200} {...personField(who, 'name')} />
                </Field>
                <Field id={`snap-${who}-dob`} label="Date of birth">
                  <Input id={`snap-${who}-dob`} type="date" {...personField(who, 'dob')} />
                </Field>
                <AgeTag dob={form[who].dob} today={today} />
              </div>
            ))}

            <div className="print:hidden">
              <Button type="button" size="sm" variant="ghost" onClick={() => set('hasSpouse', !form.hasSpouse)}>
                {form.hasSpouse ? (
                  <>
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove spouse / partner
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" aria-hidden="true" /> Add spouse / partner
                  </>
                )}
              </Button>
            </div>

            {form.children.length > 0 && (
              <div className="space-y-2">
                <SubHeading>Children</SubHeading>
                {form.children.map((c, i) => (
                  <div
                    key={c.id}
                    className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_auto_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
                  >
                    <Field id={`${c.id}-name`} label={`Child ${i + 1}`}>
                      <Input
                        id={`${c.id}-name`}
                        autoComplete="off"
                        maxLength={200}
                        value={c.name}
                        onChange={(e) => patchRow('children', c.id, { name: e.target.value })}
                      />
                    </Field>
                    <Field id={`${c.id}-dob`} label="Date of birth">
                      <Input
                        id={`${c.id}-dob`}
                        type="date"
                        value={c.dob}
                        onChange={(e) => patchRow('children', c.id, { dob: e.target.value })}
                      />
                    </Field>
                    <AgeTag dob={c.dob} today={today} />
                    <MoneyField
                      id={`${c.id}-resp`}
                      label="RESP balance"
                      value={c.respBalance}
                      onChange={(v) => patchRow('children', c.id, { respBalance: v })}
                    />
                    <MoneyField
                      id={`${c.id}-respmo`}
                      label="RESP / month"
                      value={c.respMonthly}
                      onChange={(v) => patchRow('children', c.id, { respMonthly: v })}
                    />
                    <RemoveButton label={`Remove child ${i + 1}`} onClick={() => removeRow('children', c.id)} />
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <Button type="button" size="sm" variant="ghost" className="print:hidden" onClick={() => addRow('children', newChild())}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Add child
              </Button>
              {form.children.length > 0 && (
                <div className="w-48">
                  <MoneyField
                    id="snap-ccb"
                    label="Canada Child Benefit / month"
                    value={form.ccbMonthly}
                    onChange={(v) => set('ccbMonthly', v)}
                  />
                </div>
              )}
            </div>
          </Section>

          {/* ---------- Income ---------- */}
          <Section title="Income" description="Take-home pay is what lands in the bank, after tax and payroll deductions.">
            <PersonColumns people={people} label={label}>
              {(who) => (
                <div className="space-y-3">
                  <MoneyField id={`snap-${who}-gross`} label="Gross annual income" {...personMoney(who, 'grossAnnual')} />
                  <NetIncomeField
                    who={who}
                    form={form[who]}
                    estimate={pay[who]?.est ?? null}
                    onTyped={(v) =>
                      setForm((f) =>
                        f[who].netMode === 'auto'
                          ? // First keystroke in a calculated field: switch to the agent's own figure.
                            { ...f, [who]: { ...f[who], netMode: 'manual', net: v, netFrequency: 'monthly' } }
                          : { ...f, [who]: { ...f[who], net: v } }
                      )
                    }
                    onFrequency={(fr) => setPerson(who, 'netFrequency', fr)}
                    onRecalculate={() => setPerson(who, 'netMode', 'auto')}
                  />
                  <PayrollDeductions
                    rows={form[who].payroll}
                    payFrequency={form[who].payFrequency}
                    person={who === 'client' ? household.client : (household.spouse ?? household.client)}
                    onRows={(rows) => setForm((f) => ({ ...f, [who]: { ...f[who], payroll: rows } }))}
                    onPayFrequency={(fr) => setPerson(who, 'payFrequency', fr)}
                  />
                  {pay[who]?.est && (
                    <div className="space-y-1 rounded-sm bg-sunken px-3 py-2 text-xs text-fg-2">
                      <p>
                        Calculated deposit in {form.province}: <Num>{money(pay[who]!.est!.depositMonthly)}</Num>/month
                        (after tax, CPP/EI and workplace deductions) · marginal rate{' '}
                        <Num>{formatPercent(pay[who]!.est!.marginalRate)}</Num>
                      </p>
                      {pay[who]!.est!.payrollTaxSaving > 0 && (
                        <p>
                          Before-tax workplace deductions already lower the tax on each cheque by about{' '}
                          <Num>{whole(pay[who]!.est!.payrollTaxSaving)}</Num> a year, so no refund is expected for them.
                        </p>
                      )}
                      {pay[who]!.est!.personalRefund > 0 && (
                        <p>
                          Personal RRSP/FHSA contributions from the bank: expected refund about{' '}
                          <Num>{whole(pay[who]!.est!.personalRefund)}</Num> a year at tax time.
                        </p>
                      )}
                    </div>
                  )}
                  {pay[who]?.gap && (
                    <p role="note" className="rounded-sm bg-warn-dim px-3 py-2 text-xs text-warn">
                      {pay[who]!.gap!.gap > 0
                        ? `The deposit entered (${money(pay[who]!.gap!.entered)}/month) is ${money(pay[who]!.gap!.gap)} a month less than calculated (${money(pay[who]!.gap!.estimated)}). That's usually workplace deductions: benefit premiums, pension or group RRSP. Add them above so savings through work are counted.`
                        : `The deposit entered (${money(pay[who]!.gap!.entered)}/month) is ${money(-pay[who]!.gap!.gap)} a month more than calculated (${money(pay[who]!.gap!.estimated)}). Check the gross income, or whether it includes overtime, bonuses or a different province.`}
                    </p>
                  )}
                  <AmountWithFrequency
                    id={`snap-${who}-other`}
                    label="Other income (rental, side business…)"
                    value={form[who].other}
                    frequency={form[who].otherFrequency}
                    onValue={(v) => setPerson(who, 'other', v)}
                    onFrequency={(f) => setPerson(who, 'otherFrequency', f)}
                  />
                </div>
              )}
            </PersonColumns>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <MoneyField id="snap-refund" label="Tax refund" value={form.taxRefund} onChange={(v) => set('taxRefund', v)} />
              <Field id="snap-refund-year" label="For">
                <NativeSelect
                  id="snap-refund-year"
                  value={form.taxRefundYear}
                  onChange={(v) => set('taxRefundYear', v as 'this' | 'last')}
                  options={[
                    ['last', 'Last year'],
                    ['this', 'This year'],
                  ]}
                />
              </Field>
            </div>
          </Section>

          {/* ---------- Savings ---------- */}
          <Section title="Savings & investments" description="Balances today, contribution room left, and what goes in each month.">
            <PersonColumns people={people} label={label}>
              {(who) => (
                <div className="space-y-3">
                  {(['rrsp', 'tfsa', 'fhsa'] as const).map((acct) => (
                    <div key={acct} className="grid grid-cols-3 gap-2">
                      <MoneyField id={`snap-${who}-${acct}-bal`} label={`${acct.toUpperCase()} balance`} {...personMoney(who, `${acct}Balance`)} />
                      <MoneyField id={`snap-${who}-${acct}-room`} label="Room left" {...personMoney(who, `${acct}Room`)} />
                      <MoneyField id={`snap-${who}-${acct}-mo`} label="From bank / month" {...personMoney(who, `${acct}Monthly`)} />
                    </div>
                  ))}
                  <div className="grid grid-cols-3 gap-2">
                    <MoneyField id={`snap-${who}-nr-bal`} label="Non-registered" {...personMoney(who, 'nonRegBalance')} />
                    <div />
                    <MoneyField id={`snap-${who}-nr-mo`} label="From bank / month" {...personMoney(who, 'nonRegMonthly')} />
                  </div>
                  <MoneyField id={`snap-${who}-cash`} label="Chequing / savings" {...personMoney(who, 'cash')} />
                </div>
              )}
            </PersonColumns>
            {summary.roomWarnings.length > 0 && (
              <ul className="space-y-1 rounded-sm bg-warn-dim px-3 py-2 text-xs text-warn">
                {summary.roomWarnings.map((w) => (
                  <li key={`${w.person}-${w.account}`}>
                    {label(w.person)}: {w.account} contributions for the rest of {today.getFullYear()} ({whole(w.projected)}) are{' '}
                    {whole(w.over)} over the {whole(w.room)} room left.
                  </li>
                ))}
              </ul>
            )}
            <div className="w-56">
              <MoneyField
                id="snap-home"
                label="Home value (if owned)"
                hint="Used for net worth only."
                value={form.homeValue}
                onChange={(v) => set('homeValue', v)}
              />
            </div>
          </Section>

          {/* ---------- Insurance ---------- */}
          <Section title="Insurance" description="Life cover in place today. Group cover through an employer usually ends when the job does.">
            <PersonColumns people={people} label={label}>
              {(who) => (
                <div className="grid grid-cols-2 gap-2">
                  <MoneyField id={`snap-${who}-group`} label="Group life (employer)" {...personMoney(who, 'groupLife')} />
                  <MoneyField id={`snap-${who}-personal`} label="Personal life" {...personMoney(who, 'personalLife')} />
                </div>
              )}
            </PersonColumns>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="snap-replace" label="Years of income to replace">
                <Input
                  id="snap-replace"
                  inputMode="numeric"
                  autoComplete="off"
                  className="text-right font-mono tabular-nums"
                  value={form.incomeReplacementYears}
                  onChange={(e) => set('incomeReplacementYears', e.target.value)}
                />
              </Field>
              <MoneyField
                id="snap-edu"
                label="Education fund per child"
                value={form.educationPerChild}
                onChange={(v) => set('educationPerChild', v)}
              />
            </div>
          </Section>

          {/* ---------- Debts ---------- */}
          <Section
            title="Debts & cards"
            description="Leave the payment blank to use an estimate: 3% of a card balance, interest-only on a line of credit, or amortized over the years left."
          >
            <div className="space-y-3">
              {form.debts.map((d, i) => {
                const r = summary.debts[i];
                const hasTerm = d.kind === 'car' || d.kind === 'mortgage' || d.kind === 'other';
                return (
                  <div key={d.id} className="space-y-1 border-b border-line pb-3 last:border-b-0">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.1fr)_auto] sm:items-end">
                      <Field id={`${d.id}-kind`} label="Type">
                        <NativeSelect
                          id={`${d.id}-kind`}
                          value={d.kind}
                          onChange={(v) => patchRow('debts', d.id, { kind: v as typeof d.kind })}
                          options={DEBT_KINDS.map((k) => [k, DEBT_KIND_LABELS[k]])}
                        />
                      </Field>
                      <MoneyField id={`${d.id}-bal`} label="Balance" value={d.balance} onChange={(v) => patchRow('debts', d.id, { balance: v })} />
                      <PercentField id={`${d.id}-rate`} label="Rate" value={d.ratePct} onChange={(v) => patchRow('debts', d.id, { ratePct: v })} />
                      {hasTerm ? (
                        <Field id={`${d.id}-term`} label="Years left">
                          <Input
                            id={`${d.id}-term`}
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="0"
                            className="text-right font-mono tabular-nums"
                            value={d.termYears}
                            onChange={(e) => patchRow('debts', d.id, { termYears: e.target.value })}
                          />
                        </Field>
                      ) : (
                        <div />
                      )}
                      <MoneyField
                        id={`${d.id}-pay`}
                        label="Payment / month"
                        placeholder={r.estimated ? r.payment.toFixed(2) : '0'}
                        value={d.monthlyPayment}
                        onChange={(v) => patchRow('debts', d.id, { monthlyPayment: v })}
                      />
                      <RemoveButton label={`Remove ${DEBT_KIND_LABELS[d.kind]}`} onClick={() => removeRow('debts', d.id)} />
                    </div>
                    {d.kind === 'other' && (
                      <Input
                        aria-label="Describe this debt"
                        placeholder="What is it? (e.g. student loan, CRA)"
                        maxLength={200}
                        className="h-9"
                        value={d.label}
                        onChange={(e) => patchRow('debts', d.id, { label: e.target.value })}
                      />
                    )}
                    {parseAmount(d.balance) > 0 && (
                      <p className={cn('text-xs', r.payoffMonths === null || r.highInterest ? 'text-bad' : 'text-fg-3')}>
                        {r.estimated && `Estimated ${money(r.payment)}/month · `}
                        {money(r.monthlyInterest)} interest/month · {payoffText(r)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <Button type="button" size="sm" variant="ghost" className="print:hidden" onClick={() => addRow('debts', newDebt())}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add debt
            </Button>
          </Section>

          {/* ---------- Expenses ---------- */}
          <Section
            title="Monthly expenses"
            description="Car loan and mortgage payments come from Debts, so they aren't listed again here. Untick “Essential” for spending that could be cut."
          >
            <div className="space-y-2">
              <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_5rem_6rem_auto] gap-2 text-xs font-semibold uppercase tracking-wide text-fg-3 sm:grid">
                <span>Expense</span>
                <span className="text-right">Amount</span>
                <span>How often</span>
                <span className="text-center">Essential</span>
                <span className="text-right">Per month</span>
                <span className="w-9" />
              </div>
              {form.expenses.map((e, i) => (
                <div
                  key={e.id}
                  className="grid items-center gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_5rem_6rem_auto]"
                >
                  <Input
                    aria-label="Expense name"
                    maxLength={200}
                    className="h-9"
                    placeholder="Expense"
                    value={e.label}
                    onChange={(ev) => patchRow('expenses', e.id, { label: ev.target.value })}
                  />
                  <MoneyInput
                    aria-label={`${e.label || 'Expense'} amount`}
                    className="h-9"
                    value={e.amount}
                    onChange={(v) => patchRow('expenses', e.id, { amount: v })}
                  />
                  <FrequencySelect
                    aria-label={`${e.label || 'Expense'} frequency`}
                    value={e.frequency}
                    onChange={(f) => patchRow('expenses', e.id, { frequency: f })}
                  />
                  <div className="flex justify-center">
                    <Checkbox
                      aria-label={`${e.label || 'Expense'} is essential`}
                      checked={e.essential}
                      onCheckedChange={(v) => patchRow('expenses', e.id, { essential: v === true })}
                    />
                  </div>
                  <span className="text-right font-mono text-sm tabular-nums text-fg-2">
                    {money(toMonthly(household.expenses[i].amount, e.frequency))}
                  </span>
                  <RemoveButton label={`Remove ${e.label || 'expense'}`} onClick={() => removeRow('expenses', e.id)} />
                </div>
              ))}
            </div>
            <Button type="button" size="sm" variant="ghost" className="print:hidden" onClick={() => addRow('expenses', newExpense())}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add expense
            </Button>
          </Section>

          {/* ---------- Goals ---------- */}
          <Section title="Goals" description="Add an amount and a target date to see what it takes each month.">
            <div className="space-y-3">
              {form.goals.map((g, i) => {
                const plan = goalMonthly(household.goals[i].amount, g.targetMonth, today);
                const years = plan ? Math.min(MAX_YEARS, Math.max(MIN_YEARS, Math.ceil(plan.months / 12))) : 0;
                return (
                  <div key={g.id} className="space-y-1">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,2.5fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_auto] sm:items-end">
                      <Field id={`${g.id}-text`} label={`Goal ${i + 1}`}>
                        <Input
                          id={`${g.id}-text`}
                          maxLength={200}
                          placeholder="e.g. Down payment on a home"
                          value={g.text}
                          onChange={(e) => patchRow('goals', g.id, { text: e.target.value })}
                        />
                      </Field>
                      <MoneyField id={`${g.id}-amt`} label="Amount" value={g.amount} onChange={(v) => patchRow('goals', g.id, { amount: v })} />
                      <Field id={`${g.id}-date`} label="By">
                        <Input
                          id={`${g.id}-date`}
                          type="month"
                          value={g.targetMonth}
                          onChange={(e) => patchRow('goals', g.id, { targetMonth: e.target.value })}
                        />
                      </Field>
                      <RemoveButton label={`Remove goal ${i + 1}`} onClick={() => removeRow('goals', g.id)} />
                    </div>
                    {plan && (
                      <p className="text-xs text-fg-2">
                        <Num>{money(plan.monthly)}</Num>/month for {plan.months} months (before any growth).{' '}
                        <Link
                          className="font-medium text-acc underline-offset-4 hover:underline print:hidden"
                          href={`/tools/investment-calculator?mo=${Math.ceil(plan.monthly)}&goal=${household.goals[i].amount}&yrs=${years}`}
                        >
                          Project with growth in the Investment Calculator
                        </Link>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="print:hidden"
              onClick={() => addRow('goals', { id: `g-${Date.now().toString(36)}`, text: '', amount: '', targetMonth: '' })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Add goal
            </Button>
          </Section>
        </div>

        {/* ---------- Summary ---------- */}
        {/* Printed first: the leave-behind opens with the results, then the details. */}
        <div className="space-y-4 lg:sticky lg:top-4 print:order-first print:break-after-page">
          <Card>
            <CardHeader>
              <CardTitle>
                Monthly balance{names.client && ` — ${names.client}${form.hasSpouse && names.spouse ? ` & ${names.spouse}` : ''}`}
              </CardTitle>
              <CardDescription>Everything converted to a monthly amount.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <SumRow label="Total net income" value={summary.totalNetIncome} />
              <SumRow label="Savings & investments" value={summary.savingsMonthly} minus />
              <SumRow label="Net income after savings" value={summary.netAfterSavings} strong />
              <SumRow label="Expenses" value={summary.expenseLines} minus />
              <SumRow label="Debt payments" value={summary.debtPayments} minus />
              <SumRow label="Total expenses" value={summary.totalExpenses} minus strong />
              <div className="mt-2 flex items-baseline justify-between border-t border-line-2 pt-3">
                <span className="font-semibold text-fg">Balance amount</span>
                <span className={cn('font-mono text-2xl tabular-nums tracking-tighter', balanceTone)}>
                  {money(summary.balance)}
                </span>
              </div>
              <p className="text-xs text-fg-3">
                {summary.balance < 0
                  ? 'Short each month: spending and savings are more than take-home pay.'
                  : summary.balance > 0
                    ? 'Left over each month: available for goals, debt or protection.'
                    : 'Income and outgoings are balanced.'}
              </p>
              {summary.protectionTarget > 0 && (
                <div className="flex items-baseline justify-between border-t border-line pt-2 text-sm">
                  <span className="text-fg-2">
                    After 5% protection set-aside
                    <span className="block text-xs text-fg-3">
                      {money(summary.protectionTarget)}/month target
                      {summary.protectionCurrent > 0 && `, ${money(summary.protectionCurrent)} already in premiums`}
                    </span>
                  </span>
                  <span className={cn('font-mono tabular-nums', summary.balanceAfterProtection < 0 ? 'text-bad' : 'text-fg')}>
                    {money(summary.balanceAfterProtection)}
                  </span>
                </div>
              )}
              {summary.savedThroughWork > 0 && (
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-fg-2">
                    Saved through work
                    <span className="block text-xs text-fg-3">Group RRSP, pension, share plans and employer match; not in the deposit.</span>
                  </span>
                  <span className="font-mono tabular-nums text-ok">{money(summary.savedThroughWork)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid grid-cols-2 gap-4 pt-6">
              <Stat label="Net worth" value={whole(summary.netWorth)} tone={summary.netWorth < 0 ? 'bad' : undefined} />
              <Stat
                label="Emergency fund"
                value={summary.emergencyMonths === null ? '—' : `${summary.emergencyMonths.toFixed(1)} mo`}
                hint="Chequing/savings ÷ essential monthly spending. Aim for 3–6."
                tone={summary.emergencyMonths !== null && summary.emergencyMonths < 3 ? 'warn' : undefined}
              />
              <Stat
                label="Savings rate"
                value={summary.savingsRate === null ? '—' : formatPercent(summary.savingsRate)}
                hint="Share of take-home pay going to savings."
              />
              <Stat
                label={`Tax refund (${form.taxRefundYear === 'this' ? 'this' : 'last'} year)`}
                value={parseAmount(form.taxRefund) > 0 ? whole(parseAmount(form.taxRefund)) : '—'}
              />
              {summary.insurance.map((g) => (
                <Stat
                  key={g.person}
                  label={`Life insurance gap — ${label(g.person)}`}
                  value={whole(g.gap)}
                  hint={`Need ${whole(g.need)} (debts + ${parseAmount(form.incomeReplacementYears)} yrs income + education), have ${whole(g.have)} (cover + cash, TFSA, non-reg).`}
                  tone={g.gap > 0 ? 'bad' : 'ok'}
                />
              ))}
            </CardContent>
          </Card>

          {expenseSlices.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Where the money goes</CardTitle>
              </CardHeader>
              <CardContent>
                <DonutChart
                  title="Monthly expenses"
                  slices={expenseSlices}
                  formatValue={whole}
                  centerLabel="per month"
                  valueHeader="Per month"
                />
              </CardContent>
            </Card>
          )}

          <Recommendations
            tips={tips}
            notes={form.recommendationNotes}
            custom={form.customRecommendations}
            advisorNotes={form.advisorNotes}
            onNote={(id, text) =>
              setForm((f) => {
                const notes = { ...f.recommendationNotes };
                // An emptied note is removed, so clearing it reads as "no change".
                if (text) notes[id] = text;
                else delete notes[id];
                return { ...f, recommendationNotes: notes };
              })
            }
            edits={form.recommendationEdits}
            onEdit={(id, edit) =>
              setForm((f) => {
                const edits = { ...f.recommendationEdits };
                if (edit) edits[id] = edit;
                else delete edits[id];
                return { ...f, recommendationEdits: edits };
              })
            }
            onCustom={(next) => set('customRecommendations', next)}
            onAdvisorNotes={(text) => set('advisorNotes', text)}
          />

          <p className="text-xs text-fg-3">
            Estimates only. Take-home pay and tax use the Tax Calculator&apos;s single-filer {today.getFullYear()} model.
            Payoff times assume a fixed rate and payment. The insurance gap is a rule-of-thumb starting point, not a
            needs analysis.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Net income that fills itself in (P43c). Auto: shows the calculated
 * monthly deposit from gross, recalculating as inputs change. Typing
 * switches to the agent's own figure (e.g. the actual bi-weekly deposit);
 * "Recalculate" switches back.
 */
function NetIncomeField({
  who,
  form,
  estimate,
  onTyped,
  onFrequency,
  onRecalculate,
}: {
  who: Who;
  form: PersonForm;
  estimate: { depositMonthly: number } | null;
  onTyped: (v: string) => void;
  onFrequency: (f: Frequency) => void;
  onRecalculate: () => void;
}) {
  const id = `snap-${who}-net`;
  const auto = form.netMode === 'auto' && estimate !== null;
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs">
          Net income (deposited to bank)
        </Label>
        {auto ? (
          <span className="rounded-full bg-acc-dim px-2 py-0.5 text-[11px] font-medium text-acc">Calculated</span>
        ) : (
          estimate && (
            <button
              type="button"
              className="text-xs font-medium text-acc underline-offset-4 hover:underline print:hidden"
              onClick={onRecalculate}
            >
              Recalculate from gross
            </button>
          )
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <MoneyInput id={id} value={auto ? estimate.depositMonthly.toFixed(2) : form.net} onChange={onTyped} />
        <NativeSelect
          aria-label="Net income frequency"
          value={auto ? 'monthly' : form.netFrequency}
          onChange={(v) => onFrequency(v as Frequency)}
          options={FREQUENCY_OPTIONS}
          disabled={auto}
        />
      </div>
      {auto && <p className="text-xs text-fg-3">Type the actual deposit to use it instead.</p>}
    </div>
  );
}

/* ---------- small building blocks ---------- */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="print:break-inside-avoid">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-fg-3">{children}</p>;
}

function PersonColumns({
  people,
  label,
  children,
}: {
  people: Who[];
  label: (who: Who) => string;
  children: (who: Who) => React.ReactNode;
}) {
  return (
    <div className={cn('grid gap-6', people.length === 2 && 'xl:grid-cols-2')}>
      {people.map((who) => (
        <div key={who} className="min-w-0 space-y-2">
          {people.length === 2 && <SubHeading>{label(who)}</SubHeading>}
          {children(who)}
        </div>
      ))}
    </div>
  );
}

const FREQUENCY_OPTIONS = FREQUENCIES.map((f) => [f, FREQUENCY_LABELS[f]] as [string, string]);

function FrequencySelect({
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  value: Frequency;
  onChange: (f: Frequency) => void;
  'aria-label': string;
}) {
  return (
    <NativeSelect
      aria-label={ariaLabel}
      className="h-9"
      value={value}
      onChange={(v) => onChange(v as Frequency)}
      options={FREQUENCY_OPTIONS}
    />
  );
}

function AmountWithFrequency({
  id,
  label,
  value,
  frequency,
  onValue,
  onFrequency,
}: {
  id: string;
  label: string;
  value: string;
  frequency: Frequency;
  onValue: (v: string) => void;
  onFrequency: (f: Frequency) => void;
}) {
  return (
    <Field id={id} label={label}>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <MoneyInput id={id} value={value} onChange={onValue} />
        <NativeSelect
          aria-label={`${label} frequency`}
          value={frequency}
          onChange={(v) => onFrequency(v as Frequency)}
          options={FREQUENCY_OPTIONS}
        />
      </div>
    </Field>
  );
}

function AgeTag({ dob, today }: { dob: string; today: Date }) {
  const age = ageOn(dob, today);
  return (
    <span className="flex h-11 items-center whitespace-nowrap text-sm text-fg-2 sm:min-w-[4.5rem]">
      {age === null ? '' : `Age ${age}`}
    </span>
  );
}

function SumRow({ label, value, strong, minus }: { label: string; value: number; strong?: boolean; minus?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between', strong && 'border-t border-line pt-1 font-medium text-fg')}>
      <span className={strong ? 'text-fg' : 'text-fg-2'}>{label}</span>
      <span className="font-mono tabular-nums">{minus && value > 0 ? `−${money(value)}` : money(value)}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs text-fg-3">{label}</p>
      <p
        className={cn(
          'font-mono text-lg tabular-nums tracking-tight',
          tone === 'ok' && 'text-ok',
          tone === 'warn' && 'text-warn',
          tone === 'bad' && 'text-bad',
          !tone && 'text-fg'
        )}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-fg-3">{hint}</p>}
    </div>
  );
}
