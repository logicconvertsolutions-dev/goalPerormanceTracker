import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';
import { ServiceWorkerRegistration } from '@/components/shell/service-worker-registration';

export const metadata: Metadata = {
  title: 'Performance Tracker',
  description: 'Performance management tool for WFG Associates',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Tracker',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
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
