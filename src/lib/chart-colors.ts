/**
 * Shared categorical color palette for charts and activity-type UI (icons,
 * active-tab highlighting). Order is pre-validated for adjacent-pair
 * colorblind-safety (worst adjacent CVD Delta E 9.1 light / 8.4 dark, target
 * >=8) — do not reorder these slots or the guarantee no longer holds.
 *
 * Values are CSS variables (src/app/globals.css) so every chart follows the
 * light/dark theme: light and dark each have their own validated steps of the
 * same eight hues. Recharts passes these straight to SVG fill/stroke, which
 * resolves var() like any CSS colour.
 */
const SLOTS = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'] as const;
export type ChartColorName = (typeof SLOTS)[number];

/** A palette slot as a CSS colour, optionally translucent (e.g. 0.1 for a tint). */
export function chartColor(name: ChartColorName, alpha?: number): string {
  return alpha === undefined ? `rgb(var(--chart-${name}))` : `rgb(var(--chart-${name}) / ${alpha})`;
}

export const CHART_COLORS = Object.fromEntries(SLOTS.map((name) => [name, chartColor(name)])) as Record<
  ChartColorName,
  string
>;

/** Fixed categorical order — index by position, never by name, when assigning to series/slices. */
export const CATEGORICAL_ORDER = SLOTS.map((name) => CHART_COLORS[name]);

/** Single-hue ordinal ramp (least -> most emphasis) for ordered stages, e.g. a funnel. */
export const BLUE_ORDINAL_RAMP = [1, 2, 3, 4].map((step) => `rgb(var(--chart-ramp-${step}))`);

/** Chart chrome (axes, ticks, grid, reference lines) — theme tokens, never literals. */
export const CHART_CHROME = {
  tick: 'rgb(var(--c-fg-3))',
  label: 'rgb(var(--c-fg-2))',
  grid: 'rgb(var(--c-fg) / 0.08)',
  reference: 'rgb(var(--c-fg-3))',
} as const;
