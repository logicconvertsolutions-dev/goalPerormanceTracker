import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import { StatusBarBand } from '@/components/shell/status-bar-band';
import { ServiceWorkerRegistration } from '@/components/shell/service-worker-registration';

export const metadata: Metadata = {
  title: 'Kautis',
  description: 'From action to achievement — Kautis performance tracker for WFG Associates',
  appleWebApp: {
    capable: true,
    // P36: the page draws under the status bar (white clock/battery) so the
    // My Day photo runs up behind it. Every other page gets a navy strip
    // there (StatusBarBand); body pads its content clear of it.
    statusBarStyle: 'black-translucent',
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
  // Needed for env(safe-area-inset-*) to be non-zero (black-translucent).
  viewportFit: 'cover',
  themeColor: '#0B1E3D',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bg pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] text-fg font-ui antialiased">
        <StatusBarBand />
        {children}
        <Toaster />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
