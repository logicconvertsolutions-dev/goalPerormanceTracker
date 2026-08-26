'use client';

import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { CATEGORICAL_ORDER } from '@/lib/chart-colors';

export interface DonutSlice {
  label: string;
  value: number;
}

// Fixed categorical order, pre-validated for colorblind-safe adjacent slices
// (src/lib/chart-colors.ts) — Recharts fills can't consume Tailwind classes.
const COLORS = CATEGORICAL_ORDER;

/** Donut for 2-3 (or up to 5) slice breakdowns, total in the centre (08-screen-specs.md). */
export function DonutChart({ title, slices }: { title: string; slices: DonutSlice[] }) {
  const total = slices.reduce((acc, s) => acc + s.value, 0);

  return (
    <div>
      <div className="relative h-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="60%"
              outerRadius="85%"
              paddingAngle={total === 0 ? 0 : 2}
              stroke="none"
            >
              {slices.map((s, i) => (
                <Cell key={s.label} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-2xl tabular-nums tracking-tighter text-fg">{total}</span>
          <span className="text-xs text-fg-3">total</span>
        </div>
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-fg-2">
              <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              {s.label}
            </span>
            <span className="font-mono tabular-nums text-fg">{s.value}</span>
          </li>
        ))}
      </ul>
      {/* Screen-reader / no-JS fallback table (03-ui.md: every chart needs one). */}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Outcome</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((s) => (
            <tr key={s.label}>
              <td>{s.label}</td>
              <td>{s.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
