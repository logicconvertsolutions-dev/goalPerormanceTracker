const money = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeMoney = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  currencyDisplay: 'narrowSymbol',
  maximumFractionDigits: 0,
});

/** Dollars -> "$1,234.56" (or "$1,235" with `whole`). */
export function formatMoney(dollars: number, { whole = false }: { whole?: boolean } = {}): string {
  return (whole ? wholeMoney : money).format(dollars);
}

/** Fraction -> "25.69%". */
export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}
