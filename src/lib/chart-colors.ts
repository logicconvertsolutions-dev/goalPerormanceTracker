/**
 * Shared categorical color palette for charts and activity-type UI (icons,
 * active-tab highlighting). Order is pre-validated for adjacent-pair
 * colorblind-safety (worst adjacent CVD Delta E 9.1, target >=8) — do not
 * reorder these slots or the guarantee no longer holds.
 */
export const CHART_COLORS = {
  blue: '#2a78d6',
  orange: '#eb6834',
  aqua: '#1baf7a',
  yellow: '#eda100',
  magenta: '#e87ba4',
  green: '#008300',
  violet: '#4a3aa7',
  red: '#e34948',
} as const;

/** Fixed categorical order — index by position, never by name, when assigning to series/slices. */
export const CATEGORICAL_ORDER = [
  CHART_COLORS.blue,
  CHART_COLORS.orange,
  CHART_COLORS.aqua,
  CHART_COLORS.yellow,
  CHART_COLORS.magenta,
  CHART_COLORS.green,
  CHART_COLORS.violet,
  CHART_COLORS.red,
];

/** Single-hue ordinal ramp (light -> dark) for ordered stages, e.g. a funnel. */
export const BLUE_ORDINAL_RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#184f95'];
