'use client';

import { Bar, ComposedChart, Line, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts';

export interface TrendWeek {
  weekStart: string;
  label: string;
  calls: number;
  callsTarget: number;
  premiumCents: number;
}

/** 8-week trend: bars = calls, line = calls target; toggle to premium (08-screen-specs.md). */
export function TrendChart({ weeks, metric }: { weeks: TrendWeek[]; metric: 'calls' | 'premium' }) {
  const data =
    metric === 'calls'
      ? weeks.map((w) => ({ label: w.label, value: w.calls, target: w.callsTarget }))
      : weeks.map((w) => ({ label: w.label, value: w.premiumCents / 100, target: null }));

  return (
    <div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ left: -16, right: 8, top: 4, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,.065)" />
            <XAxis dataKey="label" tick={{ fill: '#666A73', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,.065)' }} tickLine={false} />
            <YAxis tick={{ fill: '#666A73', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Bar dataKey="value" fill="#3D9AFF" radius={[4, 4, 0, 0]} maxBarSize={28} />
            {metric === 'calls' && <Line type="monotone" dataKey="target" stroke="#7FBBFF" strokeWidth={1.5} dot={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>8-week trend ({metric})</caption>
        <thead>
          <tr>
            <th>Week of</th>
            <th>{metric === 'calls' ? 'Calls' : 'Premium'}</th>
            {metric === 'calls' && <th>Goal</th>}
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.weekStart}>
              <td>{w.label}</td>
              <td>{metric === 'calls' ? w.calls : `$${(w.premiumCents / 100).toLocaleString('en-CA')}`}</td>
              {metric === 'calls' && <td>{w.callsTarget}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
