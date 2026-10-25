'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon, IconName } from '@/components/Icon';
import { InteractiveTraining } from '@/components/InteractiveTraining';
import { api, Entity } from '@/lib/api';
import { Capability, hasCapability } from '@/lib/capabilities';
import { clearStoredUser, DEPARTMENT_CHANGE_EVENT, getCurrentDepartmentId, getStoredUser, setCurrentDepartmentId } from '@/lib/session';

type NavItem = { href: string; label: string; shortLabel?: string; icon: IconName; badge?: number };
type AdminNavItem = NavItem & { capability?: Capability; ownerOnly?: boolean };

const homeItems: NavItem[] = [
  { href: '/', label: 'Today', icon: 'home' },
  { href: '/my-work', label: 'My Work', shortLabel: 'My Work', icon: 'check' },
];

const workItems: NavItem[] = [
  { href: '/tasks', label: 'Tasks', icon: 'tasks' },
  { href: '/projects', label: 'Projects', icon: 'projects' },
  { href: '/requests', label: 'Requests', icon: 'request' },
];

const operationsItems: NavItem[] = [
  { href: '/guests', label: 'Guest Matters', shortLabel: 'Guests', icon: 'guests' },
  { href: '/fixes', label: 'Maintenance', icon: 'maintenance' },
  { href: '/rooms', label: 'Rooms', icon: 'rooms' },
  { href: '/shift', label: 'Shift Handover', shortLabel: 'Handover', icon: 'shift' },
];

const decisionItems: NavItem[] = [
  { href: '/review', label: 'Review', icon: 'review' },
  { href: '/approvals', label: 'Approvals', icon: 'check' },
];

const activityItems: NavItem[] = [
  { href: '/notifications', label: 'Notifications', icon: 'bell' },
  { href: '/history', label: 'History', icon: 'history' },
];

const adminItems: AdminNavItem[] = [
  { href: '/admin/appearance', label: 'Appearance', shortLabel: 'Appearance', icon: 'palette', ownerOnly: true },
  { href: '/admin/users', label: 'People & Access', shortLabel: 'People', icon: 'guests', capability: 'manage_accounts' },
  { href: '/admin/approve', label: 'Approval Administration', shortLabel: 'Approvals', icon: 'check', capability: 'manage_approvals' },
  { href: '/admin/health', label: 'System Health', shortLabel: 'Health', icon: 'health', capability: 'view_system_health' },
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
        <Link className="btn" href="/login">Open sign in</Link>
      </section>
    </main>
  );
}

function isActivePath(path: string, href: string) {
  if (href === '/') return path === '/';
  if (href === '/posts') return path === '/posts';
  return path === href || path.startsWith(`${href}/`);
}

function NavLink({ item, path, onNavigate }: { item: NavItem; path: string; onNavigate?: () => void }) {
  const active = isActivePath(path, item.href);
  return <Link className={`ops-nav-link${active ? ' active' : ''}`} href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} title={item.label} aria-label={item.label}>
    <Icon name={item.icon} /><span className="ops-nav-copy">{item.label}</span>
    {item.badge ? <span className="ops-badge" aria-label={`${item.badge} unread`}>{item.badge > 99 ? '99+' : item.badge}</span> : null}
  </Link>;
}

function NavGroup({ label, icon, items, path, onNavigate, onExpand }: { label: string; icon: IconName; items: NavItem[]; path: string; onNavigate: () => void; onExpand: () => void }) {
  const active = items.some(item => isActivePath(path, item.href));
  const [open, setOpen] = useState(active);
  useEffect(() => { if (active) setOpen(true); }, [active]);
  return <details className={`ops-nav-group${active ? ' has-active' : ''}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary title={label} aria-label={label} onClick={onExpand}><Icon name={icon} /><span className="ops-nav-copy">{label}</span><Icon className="ops-chevron" name="down" /></summary>
    <div className="ops-subnav">{items.map(item => <NavLink key={item.href} item={item} path={path} onNavigate={onNavigate} />)}</div>
  </details>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<Entity | null>(null);
  const [deptId, setDeptId] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => { try { setCompact(localStorage.getItem('ops-sidebar-compact') === 'true'); } catch { /* Storage is optional. */ } }, []);
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
    const refresh = () => { if (document.visibilityState !== 'visible') return; return api.notifications({ unread_only: true, limit: 1 }).then(page => { if (!cancelled) setUnreadCount(Number(page.unread_count || 0)); }).catch(() => undefined); };
    void refresh();
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('notifications-changed', refresh);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('notifications-changed', refresh); };
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
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusFrame = requestAnimationFrame(() => {
      // The desktop brand row is intentionally hidden in the mobile overlay.
      // Focus the first *visible* drawer control rather than a hidden link.
      const firstVisible = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>('a, button, select, summary') || [],
      ).find(node => node.getClientRects().length > 0 && !node.hasAttribute('disabled'));
      firstVisible?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
      if (event.key !== 'Tab') return;
      const controls = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a, button, select, summary') || []).filter(node => node.getClientRects().length && !node.hasAttribute('disabled'));
      const first = controls[0], last = controls[controls.length - 1];
      if (!sidebarRef.current?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      cancelAnimationFrame(focusFrame);
      previousFocus?.focus();
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
    { href: '/posts', label: 'Marketing', icon: 'marketing' },
    { href: '/posts/editor', label: 'Annotation Studio', shortLabel: 'Studio', icon: 'edit' },
  ] : [];
  const peopleItems: NavItem[] = [{ href: '/departments', label: 'Departments', icon: 'guests' }];
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

  const allNavItems = [...homeItems, ...workItems, ...operationsItems, ...decisionItems, ...contentItems, ...peopleItems, ...activityItems, ...visibleAdminItems];
  const currentPage = [...allNavItems].sort((a, b) => b.href.length - a.href.length).find(item => isActivePath(path, item.href))?.label || 'Account';
  function toggleCompact() {
    const next = !compact;
    setCompact(next);
    try { localStorage.setItem('ops-sidebar-compact', String(next)); } catch { /* Storage is optional. */ }
  }
  const expand = () => { if (compact) { setCompact(false); try { localStorage.setItem('ops-sidebar-compact', 'false'); } catch { /* Storage is optional. */ } } };

  return (
    <div id="operations-app-root" className={`app ops-app${compact ? ' ops-compact' : ''}`}>
      <a className="ops-skip" href="#workspace-main">Skip to content</a>
      <header className="mobile-header">
        <Link className="ops-brand" href="/"><span className="ops-mark"><Icon name="leaf" /></span><span><strong>Hidden Oasis</strong><small>Operations</small></span></Link>
        <button ref={menuRef} className="ops-icon-button" type="button" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileOpen} aria-controls="mobile-sidebar" onClick={() => setMobileOpen(open => !open)}><Icon name={mobileOpen ? 'close' : 'menu'} /></button>
      </header>
      {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={closeMobile} />}
      <aside ref={sidebarRef} id="mobile-sidebar" className={`sidebar ops-sidebar ${mobileOpen ? 'open' : ''}`} aria-label="Workspace navigation">
        <div className="ops-brand-row"><Link className="ops-brand" href="/" aria-label="Hidden Oasis Operations" onClick={closeMobile}><span className="ops-mark"><Icon name="leaf" /></span><span className="ops-brand-copy"><strong>Hidden Oasis</strong><small>Operations</small></span></Link><button className="ops-mobile-close ops-icon-button" aria-label="Close navigation" onClick={closeMobile}><Icon name="close" /></button></div>
        <div className="ops-workspace-picker">
          {fixedMarketingWorkspace ? <span><span className="ops-status-dot" />Marketing workspace</span> : deptOptions.length > 1 ? <label><span>Workspace</span><select value={currentDept?.id || ''} onChange={e => changeDept(e.target.value)}>{deptOptions.map((dept: Entity) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}</select></label> : <span><span className="ops-status-dot" />{workspaceName}</span>}
        </div>
        <nav className="ops-nav" aria-label="Main navigation">
          {homeItems.map(item => <NavLink key={item.href} item={item} path={path} onNavigate={closeMobile} />)}
          <NavLink item={decisionItems[0]} path={path} onNavigate={closeMobile} />
          <span className="ops-nav-label">Workspace</span>
          {workItems.map(item => <NavLink key={item.href} item={item} path={path} onNavigate={closeMobile} />)}
          <NavLink item={operationsItems[1]} path={path} onNavigate={closeMobile} />
          <NavGroup label="Property" icon="rooms" items={operationsItems.filter(item => item.href !== '/fixes')} path={path} onNavigate={closeMobile} onExpand={expand} />
          {contentItems.length ? <NavGroup label="Marketing" icon="marketing" items={contentItems} path={path} onNavigate={closeMobile} onExpand={expand} /> : null}
          <NavLink item={peopleItems[0]} path={path} onNavigate={closeMobile} />
          <NavGroup label="Activity" icon="history" items={[decisionItems[1], ...activityItems.map(item => item.href === '/notifications' ? { ...item, badge: unreadCount } : item)]} path={path} onNavigate={closeMobile} onExpand={expand} />
          {visibleAdminItems.length ? <NavGroup label="Administration" icon="settings" items={visibleAdminItems} path={path} onNavigate={closeMobile} onExpand={expand} /> : null}
          {connectedApps.length > 0 ? <details className="ops-nav-group"><summary title="Connected apps" onClick={expand}><Icon name="external" /><span className="ops-nav-copy">Connected apps</span><Icon className="ops-chevron" name="down" /></summary><div className="ops-subnav">{connectedApps.map(([label, href]) => <a className="ops-nav-link" href={href} key={label} rel="noreferrer" target="_blank"><Icon name="external" /><span>{label}</span></a>)}</div></details> : null}
        </nav>
        <div className="ops-profile"><Link href="/account" onClick={closeMobile} title="Your account" aria-label="Your account"><span className="ops-avatar">{String(user.name || 'U').slice(0, 1).toUpperCase()}</span><span className="ops-profile-copy"><strong>{user.name || 'User'}</strong><small>{user.role}</small></span></Link><button className="ops-icon-button" title="Sign out" aria-label="Sign out" disabled={signingOut} onClick={logout}><Icon name="logout" /></button></div>
      </aside>
      <div className="ops-stage">
        <header className="ops-topbar"><div className="ops-breadcrumb"><button className="ops-icon-button ops-collapse" type="button" aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!compact} aria-controls="mobile-sidebar" onClick={toggleCompact}><Icon name="panel" /></button><span>{workspaceName}</span><span aria-hidden="true">/</span><strong>{currentPage}</strong></div><Link className="ops-icon-button ops-notifications" href="/notifications" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}><Icon name="bell" />{unreadCount > 0 && <span className="ops-unread-dot" />}</Link></header>
        {process.env.NEXT_PUBLIC_DEMO_PREVIEW === 'true' && <div className="ops-demo-banner"><span>Demo workspace</span> Fictional sample data for design preview</div>}
        <main id="workspace-main" tabIndex={-1} className="main" key={deptId ?? 'no-department'}>{children}</main>
        <InteractiveTraining user={user} path={path} />
      </div>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        {[homeItems[0], homeItems[1], workItems[0], decisionItems[0]].map(item => <NavLink key={item.href} item={item} path={path} onNavigate={closeMobile} />)}
        <button type="button" aria-label="Open all navigation" onClick={() => setMobileOpen(true)}><Icon name="menu" /><small>More</small></button>
      </nav>
    </div>
  );
}
