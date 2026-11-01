'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { payrollTotals } from '@/lib/snapshot/calculate';
import { newPayroll, type PayrollForm } from '@/lib/snapshot/form';
import {
  FREQUENCY_LABELS,
  PAY_FREQUENCIES,
  PAYROLL_INFO,
  PAYROLL_KINDS,
  type PayFrequency,
  type PayrollKind,
  type PersonMoney,
} from '@/lib/snapshot/types';
import { formatMoney } from '@/lib/tax/format';
import { MoneyInput, NativeSelect, RemoveButton } from './fields';

const money = (n: number) => formatMoney(n);

/**
 * Deductions taken from each pay cheque (P43c). Before-tax ones (group
 * RRSP, pension, dues) lower the tax withheld on every cheque, so there's no
 * refund for them later; after-tax ones (benefit premiums, share purchase)
 * just come off the deposit. Savings here never reach the bank, so the
 * summary shows them as "Saved through work" instead of subtracting them.
 */
export function PayrollDeductions({
  rows,
  payFrequency,
  person,
  onRows,
  onPayFrequency,
}: {
  rows: PayrollForm[];
  payFrequency: PayFrequency;
  /** The same person as numbers, for the monthly totals line. */
  person: PersonMoney;
  onRows: (rows: PayrollForm[]) => void;
  onPayFrequency: (f: PayFrequency) => void;
}) {
  const totals = payrollTotals(person);
  const patch = (id: string, change: Partial<PayrollForm>) =>
    onRows(rows.map((r) => (r.id === id ? { ...r, ...change } : r)));

  return (
    <div className="space-y-2 rounded-sm border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-fg-2">Workplace deductions (per pay cheque)</p>
        <NativeSelect
          aria-label="Pay frequency"
          className="h-8 w-auto text-xs"
          value={payFrequency}
          onChange={(v) => onPayFrequency(v as PayFrequency)}
          options={PAY_FREQUENCIES.map((f) => [f, `Paid ${FREQUENCY_LABELS[f].toLowerCase()}`])}
        />
      </div>

      {rows.length === 0 && (
        <p className="text-xs text-fg-3">
          Group RRSP, pension, benefit premiums or dues taken from the cheque. Add them so the calculated deposit matches
          the bank, and savings through work are counted.
        </p>
      )}

      {rows.map((r) => {
        const info = PAYROLL_INFO[r.kind];
        return (
          <div key={r.id} className="space-y-1">
            <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
              <NativeSelect
                aria-label="Deduction type"
                className="h-9 text-xs"
                value={r.kind}
                onChange={(v) => patch(r.id, { kind: v as PayrollKind })}
                options={PAYROLL_KINDS.map((k) => [k, PAYROLL_INFO[k].label])}
              />
              <MoneyInput
                aria-label={`${info.label}: amount per pay`}
                placeholder="Per pay"
                className="h-9"
                value={r.amount}
                onChange={(v) => patch(r.id, { amount: v })}
              />
              {info.employerMatch ? (
                <MoneyInput
                  aria-label={`${info.label}: employer adds per pay`}
                  placeholder="Employer adds"
                  className="h-9"
                  value={r.employer}
                  onChange={(v) => patch(r.id, { employer: v })}
                />
              ) : (
                <span />
              )}
              <RemoveButton label={`Remove ${info.label}`} onClick={() => onRows(rows.filter((x) => x.id !== r.id))} />
            </div>
            <p className="text-[11px] text-fg-3">
              {info.preTax ? 'Before tax: lowers the tax on each cheque, no refund later.' : 'After tax: comes off the deposit.'}
              {info.savings && ' Counts as savings.'}
              {info.rrspRoom && ' Uses RRSP room (with the employer match).'}
              {r.kind === 'pension' && " Lowers next year's RRSP room (pension adjustment)."}
            </p>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" className="print:hidden" onClick={() => onRows([...rows, newPayroll()])}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add deduction
        </Button>
        {rows.length > 0 && (
          <p className="text-[11px] text-fg-2">
            Per month: before tax <span className="font-mono">{money(totals.preTax / 12)}</span> · after tax{' '}
            <span className="font-mono">{money(totals.afterTax / 12)}</span> · saved{' '}
            <span className="font-mono">{money((totals.employeeSavings + totals.employerMatch) / 12)}</span>
          </p>
        )}
      </div>
    </div>
  );
}
