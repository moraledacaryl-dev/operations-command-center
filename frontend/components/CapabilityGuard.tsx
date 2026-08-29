'use client';

import Link from 'next/link';
import { Capability, hasCapability } from '@/lib/capabilities';
import { getStoredUser } from '@/lib/session';

export function CapabilityGuard({ capability, children }: { capability: Capability; children: React.ReactNode }) {
  const user = getStoredUser();
  if (hasCapability(user, capability)) return <>{children}</>;

  return (
    <main className="login-screen">
      <section className="login-card">
        <p className="eyebrow">Access restricted</p>
        <h1>This page is not available for your account.</h1>
        <p className="muted">Your session does not include the required operational capability.</p>
        <Link className="btn" href="/">Return to Today</Link>
      </section>
    </main>
  );
}
