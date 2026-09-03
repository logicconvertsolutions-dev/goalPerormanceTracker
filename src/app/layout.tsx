import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import { ServiceWorkerRegistration } from '@/components/shell/service-worker-registration';

export const metadata: Metadata = {
  title: 'Kautis',
  description: 'From action to achievement — Kautis performance tracker for WFG Associates',
  appleWebApp: {
    capable: true,
    // 'default' renders dark status-bar content on the page's own light
    // background. 'black-translucent' (the old dark-theme setting) forces
    // an opaque black overlay strip on a light canvas.
    statusBarStyle: 'default',
    title: 'Kautis',
  },
  icons: {
    // A real versioned path, not Next's file-convention `apple-icon` route
    // and not just a query string -- see src/app/apple-touch-icon-v3/route.tsx
    // for why iOS needs this to force a refetch of the home-screen icon
    // (any time the artwork changes again, bump the folder to -v4 etc.).
    apple: '/apple-touch-icon-v3',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0B1E3D',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bg text-fg font-ui antialiased">
        {children}
        <Toaster />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
