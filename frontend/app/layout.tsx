import './globals.css';
import './resources.css';
import './mobile.css';
import './polish.css';
import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: {
    default: 'Hidden Oasis Operations',
    template: '%s · Hidden Oasis Operations',
  },
  description: 'Hidden Oasis operational command center for daily work, departments, projects, reviews and handovers.',
  applicationName: 'Hidden Oasis Operations',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#173126',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-PH">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
