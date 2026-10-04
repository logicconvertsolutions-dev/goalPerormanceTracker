import { act, fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/components/shell/theme-provider';
import { THEME_COOKIE } from '@/lib/theme';
import { AppearanceSetting } from './appearance-setting';

// A controllable prefers-color-scheme so we can flip the "OS" mid-test.
let systemDark = false;
const listeners = new Set<() => void>();
function setSystemDark(dark: boolean) {
  systemDark = dark;
  listeners.forEach((l) => l());
}

beforeEach(() => {
  systemDark = false;
  listeners.clear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return systemDark && query.includes('dark');
      },
      media: query,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }))
  );
});

afterEach(() => {
  document.cookie = `${THEME_COOKIE}=; Max-Age=0; Path=/`;
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
  vi.unstubAllGlobals();
});

function renderSetting() {
  return render(
    <ThemeProvider>
      <AppearanceSetting />
    </ThemeProvider>
  );
}

const html = () => document.documentElement;

describe('AppearanceSetting', () => {
  it('defaults to Light for a user with no saved choice', () => {
    setSystemDark(true);
    renderSetting();
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(html()).not.toHaveClass('dark');
  });

  it('switches to Dark immediately and remembers it in the cookie', () => {
    renderSetting();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(html()).toHaveClass('dark');
    expect(html().style.colorScheme).toBe('dark');
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
  });

  it('System follows the device and re-themes live when the OS flips', () => {
    renderSetting();
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(html()).not.toHaveClass('dark');
    expect(screen.getByText(/currently light/i)).toBeInTheDocument();

    act(() => setSystemDark(true));
    expect(html()).toHaveClass('dark');
    expect(screen.getByText(/currently dark/i)).toBeInTheDocument();

    act(() => setSystemDark(false));
    expect(html()).not.toHaveClass('dark');
  });

  it('an explicit choice ignores OS changes', () => {
    renderSetting();
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    act(() => setSystemDark(true));
    expect(html()).not.toHaveClass('dark');
  });

  it('picks up a saved choice on load', () => {
    document.cookie = `${THEME_COOKIE}=dark; Path=/`;
    renderSetting();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(html()).toHaveClass('dark');
  });

  it('updates the browser theme-color', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#0B1E3D';
    document.head.appendChild(meta);
    renderSetting();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(meta.content).toBe('#0E1626');
    meta.remove();
  });

  it('is accessible', async () => {
    const { container } = renderSetting();
    expect(await axe(container)).toHaveNoViolations();
  });
});
