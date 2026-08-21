// Green, amber, and red mean target attainment and nothing else (03-ui.md).
// Extracted from kpi-card.tsx so the /team roster rows can share the same
// thresholds instead of redefining them.
export function attainmentColor(pct: number): string {
  if (pct >= 100) return 'text-ok';
  if (pct >= 70) return 'text-warn';
  return 'text-bad';
}

export function attainmentBar(pct: number): string {
  if (pct >= 100) return 'bg-ok';
  if (pct >= 70) return 'bg-warn';
  return 'bg-bad';
}
