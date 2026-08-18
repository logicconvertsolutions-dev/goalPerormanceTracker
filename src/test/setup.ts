import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

// jsdom has no ResizeObserver; Recharts' ResponsiveContainer needs one to
// mount at all. A no-op is sufficient — tests assert on data/DOM content,
// never on actual pixel dimensions.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock;
