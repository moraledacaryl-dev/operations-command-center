'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Capability, hasCapability } from '@/lib/capabilities';
import { clearStoredUser, DEPARTMENT_CHANGE_EVENT, getCurrentDepartmentId, getStoredUser, setCurrentDepartmentId } from '@/lib/session';

type NavItem = {
  href: string;
  label: string;
  shortLabel?: string;
  icon: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

type AdminNavItem = NavItem & { capability: Capability };

const primaryItems: NavItem[] = [
  { href: '/', label: 'Today', icon: 'T' },
  { href: '/tasks', label: 'My work', icon: 'W' },
  { href: '/departments', label: 'Department', icon: 'D' },
  { href: '/projects', label: 'Projects', icon: 'P' },
  { href: '/review', label: 'Review', icon: 'R' },
];

const groups: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { href: '/requests', label: 'Requests', icon: 'Q' },
      { href: '/shift', label: 'Shift handover', shortLabel: 'Handover', icon: 'S' },
      { href: '/guests', label: 'Guest matters', shortLabel: 'Guests', icon: 'G' },
      { href: '/fixes', label: 'Maintenance', icon: 'F' },
      { href: '/rooms', label: 'Rooms', icon: 'M' },
    ],
  },
  {
    label: 'Planning',
    items: [
      { href: '/posts', label: 'Marketing', icon: 'K' },
      { href: '/history', label: 'History', icon: 'H' },
    ],
  },
];

const adminItems: AdminNavItem[] = [
  { href: '/admin/users', label: 'People & access', shortLabel: 'People', icon: 'U', capability: 'manage_accounts' },
  { href: '/admin/approve', label: 'Approval setup', shortLabel: 'Approvals', icon: 'A', capability: 'manage_approvals' },
  { href: '/admin/health', label: 'System health', shortLabel: 'Health', icon: 'Y', capability: 'view_system_health' },
];

const connectedApps = [
  ['Staff & Payroll', process.env.NEXT_PUBLIC_STAFF_PAYROLL_APP_URL],
  ['POS', process.env.NEXT_PUBLIC_POS_APP_URL],
  ['Accounting', process.env.NEXT_PUBLIC_ACCOUNTING_APP_URL],
].filter((item): item is [string, string] => Boolean(item[1]));

function SignInRequired() {
  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="logo big">HO</div>
        <p className="eyebrow">Hidden Oasis Operations</p>
        <h1>Sign in to continue</h1>
        <p className="muted">Use your personal account to open your work, department and approvals.</p>
        <Link className="btn" href="/login">Open sign in</Link>
      </section>
    </main>
  );
}

function isActivePath(path: string, href: string) {
  return href === '/' ? path === '/' : path.startsWith(href);
}

function NavLink({ item, path, onNavigate }: { item: NavItem; path: string; onNavigate?: () => void }) {
  const active = isActivePath(path, item.href);
  return (
    <Link className={active ? 'active' : ''} href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined}>
      <span className="nav-icon" aria-hidden="true">{item.icon}</span>
      <span className="nav-copy">{item.label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<Entity | null>(null);
  const [deptId, setDeptId] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const isLogin = path === '/login';
  const isKnownRoute = ['/', '/account', '/tasks', '/departments', '/projects', '/review', '/requests', '/shift', '/guests', '/fixes', '/rooms', '/posts', '/history', '/approvals', '/approve', '/my-work', '/admin'].some(route => route === '/' ? path === '/' : path === route || path.startsWith(`${route}/`));

  useEffect(() => {
    const stored = getStoredUser();
    setUser(stored);
    setDeptId(getCurrentDepartmentId(stored));
    setMobileOpen(false);
  }, [path]);

  useEffect(() => {
    function syncDepartment() {
      setDeptId(getCurrentDepartmentId(getStoredUser()));
    }
    window.addEventListener(DEPARTMENT_CHANGE_EVENT, syncDepartment);
    window.addEventListener('storage', syncDepartment);
    return () => {
      window.removeEventListener(DEPARTMENT_CHANGE_EVENT, syncDepartment);
      window.removeEventListener('storage', syncDepartment);
    };
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileOpen]);

  const deptOptions = user?.departments || [];
  const currentDept = deptOptions.find((d: Entity) => Number(d.id) === Number(deptId)) || deptOptions[0];
  const visibleAdminItems = adminItems.filter(item => hasCapability(user, item.capability));
  const canOpenMarketing = hasCapability(user, 'view_all_operations') || deptOptions.some((department: Entity) => String(department.name || '').toLowerCase().includes('marketing'));
  const visibleGroups = groups.map(group => ({
    ...group,
    items: group.items.filter(item => item.href !== '/posts' || canOpenMarketing),
  })).filter(group => group.items.length);

  function changeDept(value: string) {
    const id = Number(value);
    setCurrentDepartmentId(id);
    if (path.startsWith('/departments')) router.push(`/departments?dept=${id}`);
  }

  async function logout() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await api.logout();
    } finally {
      clearStoredUser();
      setUser(null);
      setMobileOpen(false);
      setSigningOut(false);
      router.replace('/login');
    }
  }

  if (isLogin) return <>{children}</>;
  if (!isKnownRoute) return <>{children}</>;
  if (!user) return <SignInRequired />;

  return (
    <div id="operations-app-root" className="app">
      <header className="mobile-header">
        <Link className="mobile-brand" href="/">
          <span className="logo">HO</span>
          <span><strong>Operations</strong><small>{currentDept?.name || 'Hidden Oasis'}</small></span>
        </Link>
        <button
          className="menu-toggle"
          type="button"
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileOpen}
          aria-controls="mobile-sidebar"
          onClick={() => setMobileOpen(open => !open)}
        >
          {mobileOpen ? 'Close' : 'Menu'}
        </button>
      </header>

      {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}

      <aside id="mobile-sidebar" className={`sidebar ${mobileOpen ? 'open' : ''}`} aria-hidden={!mobileOpen ? undefined : false}>
        <div className="brand">
          <div className="logo">HO</div>
          <div>
            <strong>Operations</strong>
            <small>Hidden Oasis command center</small>
          </div>
        </div>

        <div className="user-summary">
          <span className="user-avatar" aria-hidden="true">{String(user.name || 'U').slice(0, 1).toUpperCase()}</span>
          <span><strong>{user.name || 'User'}</strong><small>{user.role}</small></span>
          <Link href="/account" className="account-link" onClick={() => setMobileOpen(false)}>Account</Link>
        </div>

        {deptOptions.length > 0 && (
          <div className="dept-switch">
            <label>
              <span>Current workspace</span>
              <select className="select" value={currentDept?.id || ''} onChange={e => changeDept(e.target.value)}>
                {deptOptions.map((dept: Entity) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
              </select>
            </label>
          </div>
        )}

        <nav className="nav grouped" aria-label="Main navigation">
          <div className="nav-group primary-nav">
            {primaryItems.map(item => <NavLink key={item.href} item={item} path={path} onNavigate={() => setMobileOpen(false)} />)}
          </div>

          {visibleGroups.map(group => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {group.items.map(item => <NavLink key={item.href} item={item} path={path} onNavigate={() => setMobileOpen(false)} />)}
            </div>
          ))}

          {connectedApps.length > 0 && (
            <div className="nav-group">
              <span className="nav-label">Connected apps</span>
              {connectedApps.map(([label, href]) => (
                <a href={href} key={label} rel="noreferrer" target="_blank">
                  <span className="nav-icon external" aria-hidden="true">↗</span>
                  <span className="nav-copy">{label}</span>
                </a>
              ))}
            </div>
          )}

          {visibleAdminItems.length > 0 && (
            <details className="nav-admin" open={path.startsWith('/admin')}>
              <summary>Administration</summary>
              <div className="nav-group">
                {visibleAdminItems.map(item => <NavLink key={item.href} item={item} path={path} onNavigate={() => setMobileOpen(false)} />)}
              </div>
            </details>
          )}
        </nav>

        <button className="btn secondary logout" disabled={signingOut} onClick={logout}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
      </aside>

      <main className="main" key={deptId ?? 'no-department'}>{children}</main>

      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        {primaryItems.map(item => {
          const active = isActivePath(path, item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
              <span aria-hidden="true">{item.icon}</span>
              <small>{item.shortLabel || item.label}</small>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
