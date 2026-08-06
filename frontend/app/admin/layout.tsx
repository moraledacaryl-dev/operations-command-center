'use client';

import { usePathname } from 'next/navigation';
import { CapabilityGuard } from '@/components/CapabilityGuard';
import type { Capability } from '@/lib/capabilities';

function requiredCapability(path: string): Capability {
  if (path.startsWith('/admin/users')) return 'manage_accounts';
  if (path.startsWith('/admin/health')) return 'view_system_health';
  if (path.startsWith('/admin/approve')) return 'manage_approvals';
  return 'manage_system';
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return <CapabilityGuard capability={requiredCapability(path)}>{children}</CapabilityGuard>;
}
