import './globals.css';
import './resources.css';
import './mobile.css';
import './polish.css';
import './capabilities.css';
import './interactions.css';
import './accessibility.css';
import './ui-v3.css';
import './ui-v3-accessibility.css';
import './ui-v3-core.css';
import './ui-v3-operations.css';
import './ui-v3-decisions-content.css';
import './ui-v3-admin-system.css';
import './ui-v3-property-media.css';
import './ui-mockup-pass2.css';
import './ui-mockup-pass3.css';
import './ui-mockup-pass4.css';
import './ui-mockup-pass5.css';
import './ui-mockup-pass6.css';
import './ui-mockup-pass7.css';
import './ui-room-media.css';
import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/AppShell';
import { PropertyMediaSync } from '@/components/PropertyMediaSync';
import { RolePresentationSync } from '@/components/RolePresentationSync';

export const dynamic = 'force-dynamic';

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
        <PropertyMediaSync />
        <RolePresentationSync />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
