import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import { ServiceWorkerRegistration } from '@/components/shell/service-worker-registration';
import { ThemeProvider } from '@/components/shell/theme-provider';
import { THEME_BOOTSTRAP_SCRIPT, THEME_COLOR } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'Kautis',
  description: 'From action to achievement — Kautis performance tracker for WFG Associates',
  appleWebApp: {
    capable: true,
    // 'default' lets iOS pick status-bar content from theme-color, which
    // ThemeProvider keeps in step with the active theme. 'black-translucent'
    // forces an opaque black overlay strip on a light canvas.
    statusBarStyle: 'default',
    title: 'Kautis',
  },
  icons: {
    // A real versioned path, not Next's file-convention `apple-icon` route
    // and not just a query string -- see src/app/apple-touch-icon-v3/route.tsx
    // for why iOS needs this to force a refetch of the home-screen icon
    // (any time the artwork changes again, bump the folder to -v4 etc.).
    apple: '/apple-touch-icon-v3',
    // Listed explicitly: once `icons` is set here, Next no longer emits the
    // <link rel="icon"> for the icon.tsx file convention on its own.
    icon: [{ url: '/icon', type: 'image/png', sizes: '512x512' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // ThemeProvider rewrites this when the resolved theme changes.
  themeColor: THEME_COLOR.light,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the bootstrap script below sets class/style
    // on <html> before React hydrates, so they legitimately differ from the
    // server markup. It only applies to this element's own attributes.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Sets the light/dark class from the kautis-theme cookie before the
            first paint, so a dark-mode user never sees a white flash. Static
            string, no user input (see lib/theme.ts); allowed by the existing
            script-src 'unsafe-inline' CSP. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="bg-bg text-fg font-ui antialiased">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
