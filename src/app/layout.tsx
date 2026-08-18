import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Performance Tracker',
  description: 'Performance management tool for WFG Associates',
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
  },
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
      </body>
    </html>
  );
}
