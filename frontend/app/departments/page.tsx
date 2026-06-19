'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, Entity } from '@/lib/api';
import { canUseAdmin, getCurrentDepartmentId, getStoredUser, setCurrentDepartmentId } from '@/lib/session';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
import Link from 'next/link';

const tabs = ['Tasks', 'Requests', 'Guests', 'Fixes', 'Shift', 'Projects', 'Routine', 'Posts', 'Docs', 'People', 'History', 'Talk'];

function MiniCard({ item, kind }: { item: Entity; kind: string }) {
  return (
    <div className="card">
      <div className="card-title">{item.title || item.name}</div>
      <div className="card-line"><Pill value={kind} /><Pill value={item.status || item.role} /><Pill value={item.priority || item.urgency} /></div>
      {item.note ? <span className="muted">{String(item.note).slice(0, 90)}</span> : null}
    </div>
  );
}

export default function DepartmentsPage() {
  const router = useRouter();
  const search = useSearchParams();
  const [user, setUser] = useState<Entity | null>(null);
  const [deptId, setDeptId] = useState<number | null>(null);
  const [workspace, setWorkspace] = useState<Entity | null>(null);
  const [tab, setTab] = useState('Tasks');

  useEffect(() => {
    const stored = getStoredUser();
    setUser(stored);
    const queryDept = search.get('dept');
    const id = queryDept ? Number(queryDept) : getCurrentDepartmentId(stored);
    if (id) {
      setDeptId(id);
      setCurrentDepartmentId(id);
      api.departmentWorkspace(id).then(setWorkspace);
    }
  }, [search]);

  function switchDept(id: number) {
    setDeptId(id);
    setCurrentDepartmentId(id);
    router.push(`/departments?dept=${id}`);
  }

  const departments = user?.departments || [];
  const activeDept = workspace?.department;
  const wideAccess = canUseAdmin(user);
  const visibleTabs = wideAccess ? tabs : ['Tasks', 'Talk', 'Requests', 'Shift', 'Docs', 'History'];
  const activeTab = visibleTabs.includes(tab) ? tab : visibleTabs[0];
  const rows = activeTab === 'Tasks' ? workspace?.tasks
    : activeTab === 'Talk' ? workspace?.talk
    : activeTab === 'Requests' ? workspace?.requests
    : activeTab === 'Guests' ? workspace?.guests
    : activeTab === 'Fixes' ? workspace?.fixes
    : activeTab === 'Shift' ? workspace?.shift
    : activeTab === 'Projects' ? workspace?.projects
    : activeTab === 'Routine' ? workspace?.routines
    : activeTab === 'Posts' ? workspace?.posts
    : activeTab === 'Docs' ? workspace?.docs
    : activeTab === 'History' ? workspace?.history
    : workspace?.people;
  const openTasks = (workspace?.tasks || []).filter((item: Entity) => item.status !== 'Done').length;
  const openRequests = (workspace?.requests || []).filter((item: Entity) => !['Done', 'Rejected'].includes(item.status)).length;
  const openGuests = (workspace?.guests || []).filter((item: Entity) => item.status !== 'Done').length;
  const openFixes = (workspace?.fixes || []).filter((item: Entity) => item.status !== 'Verified').length;

  return (
    <>
      <Top eyebrow={wideAccess ? 'Workspace' : 'Department'} title={activeDept?.name || (wideAccess ? 'Departments' : 'My Department')} right={departments.length > 1 ? <select className="select" style={{ maxWidth: 220 }} value={deptId || ''} onChange={e => switchDept(Number(e.target.value))}>{departments.map((d: Entity) => <option key={d.id} value={d.id}>{d.name}</option>)}</select> : null} />
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="section-head">
          <div className="card-line">
            <Pill value={departments.length > 1 ? 'Multi-dept' : 'Primary'} />
            <Pill value={user?.role} />
            <span className="muted">{wideAccess ? 'Department workspace.' : 'Your team workspace.'}</span>
          </div>
          <div className="card-line">
            <Pill value={`Tasks: ${openTasks}`} />
            <Pill value={`Requests: ${openRequests}`} />
            <Pill value={`Guests: ${openGuests}`} />
            <Pill value={`Fixes: ${openFixes}`} />
          </div>
        </div>
      </div>
      <div className="command-band">
        {!wideAccess ? <Link className="btn" href="/my-work">My Work</Link> : null}
        <Link className={wideAccess ? 'btn' : 'btn secondary'} href="/tasks">Tasks</Link>
        <Link className="btn secondary" href="/requests">New request</Link>
        <Link className="btn secondary" href="/shift">Shift note</Link>
        {wideAccess ? <Link className="btn secondary" href="/review">Review</Link> : null}
      </div>
      <div className="tabs">{visibleTabs.map(t => <button className={`tab ${activeTab === t ? 'active' : ''}`} key={t} onClick={() => setTab(t)}>{t}</button>)}</div>
      <div className="grid cols-3">
        {rows?.length ? rows.map((item: Entity) => <MiniCard key={`${activeTab}-${item.id}`} item={item} kind={activeTab} />) : <div className="empty">All clear</div>}
      </div>
    </>
  );
}
