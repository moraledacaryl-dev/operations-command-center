'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ModulePage } from '@/components/ModulePage';
import { Top } from '@/components/Top';
import { api } from '@/lib/api';
import { configs } from '@/lib/config';
import { getStoredUser } from '@/lib/session';

export default function ApproveAdminPage() {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    const storedRole = String(getStoredUser()?.role || '').toLowerCase();
    if (storedRole) setRole(storedRole);
    api.me()
      .then(user => setRole(String(user.role || '').toLowerCase()))
      .catch(() => setRole(storedRole || ''));
  }, []);

  if (role === null) return null;
  if (role !== 'owner') {
    return (
      <>
        <Top eyebrow="Admin" title="Approve" />
        <section className="panel" style={{ maxWidth: 720 }}>
          <h2>Owner only</h2>
          <p className="muted">Use Review for normal approval work.</p>
          <div className="toolbar"><Link className="btn secondary" href="/review">Open Review</Link></div>
        </section>
      </>
    );
  }

  return <ModulePage config={configs.approve} />;
}
