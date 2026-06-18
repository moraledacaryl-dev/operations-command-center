'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { canUseAdmin, clearStoredUser, getCurrentDepartmentId, getStoredUser, setCurrentDepartmentId, setStoredUser } from '@/lib/session';

const groups = [
  { label: 'Main', items: [['/', 'Home'], ['/departments', 'Departments'], ['/account', 'Account']] },
  { label: 'Work', items: [['/projects', 'Projects'], ['/tasks', 'Tasks'], ['/requests', 'Requests']] },
  { label: 'Ops', items: [['/shift', 'Shift'], ['/guests', 'Guests'], ['/fixes', 'Fixes'], ['/rooms', 'Rooms']] },
  { label: 'Market', items: [['/posts', 'Posts']] },
  { label: 'Review', items: [['/review', 'Review']] },
  { label: 'Memory', items: [['/history', 'History']] },
];
const adminItems = [['/admin/users', 'Users'], ['/admin/health', 'Health'], ['/admin/approve', 'Approve']];

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
  const showAdmin = canUseAdmin(user);

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
          {groups.map(group => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {group.items.map(([href, label]) => {
                const active = href === '/' ? path === '/' : path.startsWith(href);
                return <Link className={active ? 'active' : ''} key={href} href={href}><span className="dot" />{label}</Link>;
              })}
            </div>
          ))}
          {showAdmin ? (
            <div className="nav-group admin-fold">
              <span className="nav-label">Admin</span>
              {adminItems.map(([href, label]) => { const active = path.startsWith(href); return <Link className={active ? 'active' : ''} key={href} href={href}><span className="dot" />{label}</Link>; })}
            </div>
          ) : null}
        </nav>
        <button className="btn secondary logout" onClick={logout}>Sign out</button>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
