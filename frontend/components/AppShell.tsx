'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { clearStoredUser, getCurrentDepartmentId, getStoredUser, setCurrentDepartmentId, setStoredUser } from '@/lib/session';

type NavItem = { href: string; label: string };
type NavGroup = { label: string; items: NavItem[] };

const adminItems: NavItem[] = [
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/health', label: 'Health' },
  { href: '/admin/approve', label: 'Approve' },
];

function normalizedRole(user?: Entity | null) {
  return String(user?.role || '').toLowerCase();
}

function departmentNames(user?: Entity | null) {
  return (user?.departments || []).map((dept: Entity) => String(dept.name || '').toLowerCase());
}

function hasDepartment(user: Entity | null, names: string[]) {
  const departments = departmentNames(user);
  return names.some(name => departments.some(dept => dept.includes(name)));
}

function departmentSpecificItems(user: Entity | null): NavItem[] {
  const items: NavItem[] = [];
  if (hasDepartment(user, ['front desk'])) {
    items.push({ href: '/guests', label: 'Guests' }, { href: '/rooms', label: 'Rooms' }, { href: '/fixes', label: 'Fixes' });
  }
  if (hasDepartment(user, ['maintenance', 'housekeeping'])) {
    items.push({ href: '/fixes', label: 'Fixes' }, { href: '/rooms', label: 'Rooms' });
  }
  if (hasDepartment(user, ['marketing'])) {
    items.push({ href: '/posts', label: 'Posts' });
  }
  return items.filter((item, index, all) => all.findIndex(candidate => candidate.href === item.href) === index);
}

function navForUser(user: Entity | null): NavGroup[] {
  const role = normalizedRole(user);
  const hasWideAccess = ['owner', 'admin', 'manager'].includes(role);

  if (hasWideAccess) {
    return [
      { label: 'Main', items: [{ href: '/', label: 'Home' }, { href: '/review', label: 'Review' }, { href: '/departments', label: 'Departments' }] },
      { label: 'Work', items: [{ href: '/tasks', label: 'Tasks' }, { href: '/requests', label: 'Requests' }, { href: '/shift', label: 'Shift' }] },
      { label: 'Operations', items: [{ href: '/guests', label: 'Guests' }, { href: '/fixes', label: 'Fixes' }, { href: '/rooms', label: 'Rooms' }] },
      { label: 'Marketing', items: [{ href: '/posts', label: 'Posts' }] },
      { label: 'History', items: [{ href: '/history', label: 'History' }] },
      { label: 'Account', items: [{ href: '/account', label: 'Account' }] },
    ];
  }

  if (role === 'lead') {
    return [
      { label: 'Main', items: [{ href: '/my-work', label: 'My Work' }, { href: '/departments', label: 'My Department' }] },
      { label: 'Work', items: [{ href: '/tasks', label: 'Tasks' }, { href: '/requests', label: 'Requests' }, { href: '/shift', label: 'Shift' }] },
      { label: 'Department', items: departmentSpecificItems(user) },
      { label: 'History', items: [{ href: '/history', label: 'History' }] },
      { label: 'Account', items: [{ href: '/account', label: 'Account' }] },
    ].filter(group => group.items.length);
  }

  return [
    { label: 'Main', items: [{ href: '/my-work', label: 'My Work' }, { href: '/departments', label: 'My Department' }] },
    { label: 'Work', items: [{ href: '/shift', label: 'Shift' }, { href: '/requests', label: 'Requests' }] },
    { label: 'History', items: [{ href: '/history', label: 'History' }] },
    { label: 'Account', items: [{ href: '/account', label: 'Account' }] },
  ];
}

function adminNavForUser(user: Entity | null): NavItem[] {
  const role = normalizedRole(user);
  if (role === 'owner') return adminItems;
  if (role === 'admin') return adminItems.filter(item => item.href !== '/admin/approve');
  return [];
}

function SignInRequired() {
  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="logo big">HO</div>
        <h1>Sign in</h1>
        <p className="muted">Use your personal account.</p>
        <Link className="btn" href="/login">Open Login</Link>
      </section>
    </main>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<Entity | null>(null);
  const [deptId, setDeptId] = useState<number | null>(null);
  const [checking, setChecking] = useState(true);
  const isLogin = path === '/login';

  useEffect(() => {
    if (isLogin) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    const stored = getStoredUser();
    setUser(stored);
    setDeptId(getCurrentDepartmentId(stored));
    setChecking(!stored);
    api.me()
      .then(fresh => {
        if (cancelled) return;
        setStoredUser(fresh);
        setUser(fresh);
        setDeptId(getCurrentDepartmentId(fresh));
      })
      .catch(() => {
        if (cancelled) return;
        clearStoredUser();
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => { cancelled = true; };
  }, [path, isLogin]);

  const deptOptions = user?.departments || [];
  const currentDept = deptOptions.find((d: Entity) => Number(d.id) === Number(deptId)) || deptOptions[0];
  const navGroups = navForUser(user);

  function changeDept(value: string) {
    const id = Number(value);
    setDeptId(id);
    setCurrentDepartmentId(id);
    if (path.startsWith('/departments')) router.push(`/departments?dept=${id}`);
  }

  async function logout() {
    await api.logout().catch(() => null);
    clearStoredUser();
    setUser(null);
    router.push('/login');
  }

  if (isLogin) return <>{children}</>;
  if (checking && !user) return null;
  if (!user) return <SignInRequired />;
  const adminNav = adminNavForUser(user);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">HO</div>
          <div>
            <strong>Operations</strong>
            <small>{user.name || 'User'} · {user.role}</small>
          </div>
        </div>

        {deptOptions.length > 0 && (
          <div className="dept-switch">
            <label className="label">Workspace
              <select className="select" value={currentDept?.id || ''} onChange={e => changeDept(e.target.value)}>
                {deptOptions.map((dept: Entity) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
              </select>
            </label>
            {deptOptions.length > 1 ? <small className="muted">Multi-dept</small> : null}
          </div>
        )}

        <nav className="nav grouped">
          {navGroups.map(group => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {group.items.map(({ href, label }) => {
                const active = href === '/' ? path === '/' : path.startsWith(href);
                return <Link className={active ? 'active' : ''} key={href} href={href}><span className="dot" />{label}</Link>;
              })}
            </div>
          ))}
          {adminNav.length ? (
            <div className="nav-group admin-fold">
              <span className="nav-label">Admin</span>
              {adminNav.map(({ href, label }) => { const active = path.startsWith(href); return <Link className={active ? 'active' : ''} key={href} href={href}><span className="dot" />{label}</Link>; })}
            </div>
          ) : null}
        </nav>
        <button className="btn secondary logout" onClick={logout}>Sign out</button>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
