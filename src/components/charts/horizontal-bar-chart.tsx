'use client';

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';

export interface BarDatum {
  label: string;
  value: number;
}

/** Horizontal bar, sorted descending — for ranking questions like "where are my leads from" (08-screen-specs.md). */
export function HorizontalBarChart({
  title,
  data,
  target,
}: {
  title: string;
  data: BarDatum[];
  /** Optional reference line, e.g. the per-agent calls target on "Calls by Agent" (08-screen-specs.md). */
  target?: number;
}) {
  const sorted = [...data].sort((a, b) => b.value - a.value);

  return (
    <div>
      <div className="h-56 min-w-[280px] overflow-x-auto">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={sorted} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <CartesianGrid horizontal={false} stroke="rgba(11,30,61,.08)" />
            <XAxis type="number" tick={{ fill: '#94A0B8', fontSize: 11 }} axisLine={{ stroke: 'rgba(11,30,61,.08)' }} tickLine={false} />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fill: '#5C6580', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={90}
            />
            <Bar dataKey="value" fill="#0B1E3D" radius={[0, 4, 4, 0]} maxBarSize={18} />
            {target !== undefined && (
              <ReferenceLine x={target} stroke="#94A0B8" strokeDasharray="3 3" />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Source</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((d) => (
            <tr key={d.label}>
              <td>{d.label}</td>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
