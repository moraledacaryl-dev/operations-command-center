'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, Entity } from '@/lib/api';
import { getCurrentDepartmentId, getStoredUser, setCurrentDepartmentId } from '@/lib/session';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';
import Link from 'next/link';

const tabs = ['Tasks', 'Talk', 'Requests', 'Projects', 'Routine', 'Docs', 'People', 'History'];

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
  const rows = tab === 'Tasks' ? workspace?.tasks : tab === 'Talk' ? workspace?.talk : tab === 'Requests' ? workspace?.requests : tab === 'Projects' ? workspace?.projects : tab === 'Routine' ? workspace?.routines : tab === 'Docs' ? workspace?.docs : tab === 'History' ? workspace?.history : workspace?.people;

  return (
    <>
      <Top eyebrow="Workspace" title={activeDept?.name || 'Departments'} right={departments.length > 1 ? <select className="select" style={{ maxWidth: 220 }} value={deptId || ''} onChange={e => switchDept(Number(e.target.value))}>{departments.map((d: Entity) => <option key={d.id} value={d.id}>{d.name}</option>)}</select> : null} />
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="card-line">
          <Pill value={departments.length > 1 ? 'Multi-dept' : 'Primary'} />
          <Pill value={user?.role} />
          <span className="muted">Person login, department workspace.</span>
        </div>
      </div>
      <div className="command-band">
        <Link className="btn" href="/tasks">Open tasks</Link>
        <Link className="btn secondary" href="/requests">New request</Link>
        <Link className="btn secondary" href="/shift">Shift note</Link>
        <Link className="btn secondary" href="/review">Review queue</Link>
      </div>
      <div className="tabs">{tabs.map(t => <button className={`tab ${tab === t ? 'active' : ''}`} key={t} onClick={() => setTab(t)}>{t}</button>)}</div>
      <div className="grid cols-3">
        {rows?.length ? rows.map((item: Entity) => <MiniCard key={`${tab}-${item.id}`} item={item} kind={tab} />) : <div className="empty">All clear</div>}
      </div>
    </>
  );
}
