'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Capability, hasCapability } from '@/lib/capabilities';
import { clearStoredUser, DEPARTMENT_CHANGE_EVENT, getCurrentDepartmentId, getStoredUser, setCurrentDepartmentId } from '@/lib/session';

type NavItem = { href: string; label: string; shortLabel?: string; icon: string; badge?: number };
type AdminNavItem = NavItem & { capability?: Capability; ownerOnly?: boolean };

const homeItems: NavItem[] = [
  { href: '/', label: 'Overview', icon: '⌂' },
  { href: '/my-work', label: 'My Work', shortLabel: 'My Work', icon: '✓' },
];

const workItems: NavItem[] = [
  { href: '/tasks', label: 'Tasks', icon: '▣' },
  { href: '/projects', label: 'Projects', icon: '◇' },
  { href: '/requests', label: 'Requests', icon: '↗' },
];

const operationsItems: NavItem[] = [
  { href: '/guests', label: 'Guest Matters', shortLabel: 'Guests', icon: '◎' },
  { href: '/fixes', label: 'Maintenance', icon: '◆' },
  { href: '/rooms', label: 'Rooms', icon: '▦' },
  { href: '/shift', label: 'Shift Handover', shortLabel: 'Handover', icon: '⇄' },
];

const decisionItems: NavItem[] = [
  { href: '/review', label: 'Review', icon: '◫' },
  { href: '/approvals', label: 'Approvals', icon: '✓' },
];

const activityItems: NavItem[] = [
  { href: '/notifications', label: 'Notifications', icon: '♢' },
  { href: '/history', label: 'History', icon: '◷' },
];

const adminItems: AdminNavItem[] = [
  { href: '/admin/appearance', label: 'Appearance', shortLabel: 'Appearance', icon: '◈', ownerOnly: true },
  { href: '/admin/users', label: 'People & Access', shortLabel: 'People', icon: '♙', capability: 'manage_accounts' },
  { href: '/admin/approve', label: 'Approval Administration', shortLabel: 'Approvals', icon: '✓', capability: 'manage_approvals' },
  { href: '/admin/health', label: 'System Health', shortLabel: 'Health', icon: '●', capability: 'view_system_health' },
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
    <Link className={active ? 'active' : ''} href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} aria-label={item.label}>
      <span className="nav-icon" aria-hidden="true">{item.icon}</span>
      <span className="nav-copy">{item.label}</span>
      {item.badge ? <span className="nav-badge" aria-label={`${item.badge} unread`}>{item.badge > 99 ? '99+' : item.badge}</span> : null}
    </Link>
  );
}

function NavSection({ label, items, path, onNavigate }: { label?: string; items: NavItem[]; path: string; onNavigate: () => void }) {
  return (
    <div className="nav-group">
      {label ? <span className="nav-label">{label}</span> : null}
      {items.map(item => <NavLink key={item.href} item={item} path={path} onNavigate={onNavigate} />)}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<Entity | null>(null);
  const [deptId, setDeptId] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const isLogin = path === '/login';
  const isKnownRoute = ['/', '/account', '/tasks', '/departments', '/projects', '/review', '/requests', '/shift', '/guests', '/fixes', '/rooms', '/posts', '/history', '/notifications', '/approvals', '/approve', '/my-work', '/admin'].some(route => route === '/' ? path === '/' : path === route || path.startsWith(`${route}/`));

  useEffect(() => {
    const stored = getStoredUser();
    setUser(stored);
    setDeptId(getCurrentDepartmentId(stored));
    setMobileOpen(false);
  }, [path]);

  useEffect(() => {
    if (!user) { setUnreadCount(0); return; }
    let cancelled = false;
    const refresh = () => api.notifications({ unread_only: true, limit: 1 }).then(page => { if (!cancelled) setUnreadCount(Number(page.unread_count || 0)); }).catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [path, user]);

  useEffect(() => {
    function syncDepartment() { setDeptId(getCurrentDepartmentId(getStoredUser())); }
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
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileOpen]);

  const deptOptions = user?.departments || [];
  const currentDept = deptOptions.find((d: Entity) => Number(d.id) === Number(deptId)) || deptOptions[0];
  const fixedMarketingWorkspace = path.startsWith('/posts');
  const workspaceName = fixedMarketingWorkspace ? 'Marketing' : currentDept?.name || 'Hidden Oasis';
  const role = String(user?.role || '').toLowerCase();
  const visibleAdminItems = adminItems.filter(item => (!item.ownerOnly || role === 'owner') && (!item.capability || hasCapability(user, item.capability)));
  const canOpenMarketing = hasCapability(user, 'view_all_operations') || deptOptions.some((department: Entity) => String(department.name || '').toLowerCase().includes('marketing'));
  const contentItems: NavItem[] = canOpenMarketing ? [
    { href: '/posts', label: 'Marketing', icon: '◉' },
    { href: '/posts/editor', label: 'Annotation Studio', shortLabel: 'Studio', icon: '✎' },
  ] : [];
  const peopleItems: NavItem[] = [{ href: '/departments', label: 'Departments', icon: '▥' }];
  const closeMobile = () => setMobileOpen(false);

  function changeDept(value: string) {
    const id = Number(value);
    setCurrentDepartmentId(id);
    if (path.startsWith('/departments')) router.push(`/departments?dept=${id}`);
  }

  async function logout() {
    if (signingOut) return;
    setSigningOut(true);
    try { await api.logout(); }
    finally {
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
          <span><strong>Operations</strong><small>{workspaceName}</small></span>
        </Link>
        <button className="menu-toggle" type="button" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileOpen} aria-controls="mobile-sidebar" onClick={() => setMobileOpen(open => !open)}>
          {mobileOpen ? 'Close' : 'Menu'}
        </button>
      </header>

      {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={closeMobile} />}

      <aside id="mobile-sidebar" className={`sidebar ${mobileOpen ? 'open' : ''}`} aria-hidden={!mobileOpen ? undefined : false}>
        <div className="brand">
          <div className="logo">HO</div>
          <div><strong>Hidden Oasis</strong><small>Operations</small></div>
        </div>

        <div className="user-summary">
          <span className="user-avatar" aria-hidden="true">{String(user.name || 'U').slice(0, 1).toUpperCase()}</span>
          <span><strong>{user.name || 'User'}</strong><small>{user.role}</small></span>
          <Link href="/account" className="account-link" onClick={closeMobile}>Account</Link>
        </div>

        {fixedMarketingWorkspace ? (
          <div className="dept-switch"><label><span>Current workspace</span><strong>Marketing</strong></label></div>
        ) : deptOptions.length > 0 ? (
          <div className="dept-switch"><label><span>Current workspace</span><select className="select" value={currentDept?.id || ''} onChange={e => changeDept(e.target.value)}>{deptOptions.map((dept: Entity) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}</select></label></div>
        ) : null}

        <nav className="nav grouped" aria-label="Main navigation">
          <NavSection items={homeItems} path={path} onNavigate={closeMobile} />
          <NavSection label="Execution" items={workItems} path={path} onNavigate={closeMobile} />
          <NavSection label="Property" items={operationsItems} path={path} onNavigate={closeMobile} />
          <NavSection label="Control" items={decisionItems} path={path} onNavigate={closeMobile} />
          {contentItems.length ? <NavSection label="Content" items={contentItems} path={path} onNavigate={closeMobile} /> : null}
          <NavSection label="Organization" items={peopleItems} path={path} onNavigate={closeMobile} />

          {visibleAdminItems.length > 0 ? (
            <details className="nav-admin" open={path.startsWith('/admin')}>
              <summary>Administration</summary>
              <NavSection items={visibleAdminItems} path={path} onNavigate={closeMobile} />
            </details>
          ) : null}

          <NavSection label="Activity" items={activityItems.map(item => item.href === '/notifications' ? { ...item, badge: unreadCount } : item)} path={path} onNavigate={closeMobile} />

          {connectedApps.length > 0 ? (
            <div className="nav-group">
              <span className="nav-label">Connected Apps</span>
              {connectedApps.map(([label, href]) => <a href={href} key={label} rel="noreferrer" target="_blank"><span className="nav-icon external" aria-hidden="true">↗</span><span className="nav-copy">{label}</span></a>)}
            </div>
          ) : null}
        </nav>

        <button className="btn secondary logout" disabled={signingOut} onClick={logout}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
      </aside>

      <main className="main" key={deptId ?? 'no-department'}>{children}</main>

      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        {[homeItems[0], homeItems[1], workItems[0], decisionItems[0]].map(item => {
          const active = isActivePath(path, item.href);
          return <Link key={item.href} href={item.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} aria-label={item.label}><span aria-hidden="true">{item.icon}</span><small>{item.shortLabel || item.label}</small></Link>;
        })}
        <button type="button" aria-label="Open all navigation" onClick={() => setMobileOpen(true)}><span aria-hidden="true">•••</span><small>More</small></button>
      </nav>
    </div>
  );
}
