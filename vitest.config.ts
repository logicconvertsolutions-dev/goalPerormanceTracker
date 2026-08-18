import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // The real package throws outside a Next.js Server Component bundler
      // context; tests run under plain Node/vitest, so it's a no-op here.
      'server-only': path.resolve(__dirname, './src/test/server-only-mock.ts'),
    },
  },
});
