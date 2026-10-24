'use client';

import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { normalizeRole } from '@/lib/capabilities';
import { propertyDateInput } from '@/lib/property-dates';

export function ProjectDetailsEditor({ project, busy, error, onSave, onCancel }: {
  project: Entity; busy: boolean; error: string;
  onSave: (payload: Entity) => Promise<void>; onCancel: () => void;
}) {
  const [original] = useState(project);
  const [title, setTitle] = useState(project.title || '');
  const [owner, setOwner] = useState(project.owner_id ? String(project.owner_id) : '');
  const [priority, setPriority] = useState(project.priority || 'Normal');
  const [date, setDate] = useState(propertyDateInput(project.due_date));
  const [note, setNote] = useState(project.note || '');
  const [people, setPeople] = useState<Entity[]>([]);
  const [peopleError, setPeopleError] = useState('');
  useEffect(() => {
    let active = true;
    api.meta().then(meta => { if (active) setPeople((meta.users || []).filter((person: Entity) =>
      ['owner', 'admin', 'manager'].includes(normalizeRole(person.role))
      || project.department_id && (Number(person.primary_department_id) === Number(project.department_id)
        || (person.departments || []).some((dept: Entity) => Number(dept.id) === Number(project.department_id))))); })
      .catch(() => { if (active) setPeopleError('Team choices could not be loaded. The current owner is preserved.'); });
    return () => { active = false; };
  }, [project.department_id]);
  return <form className="form" onSubmit={event => {
    event.preventDefault();
    if (!busy && title.trim() && original.updated_at) void onSave({ title: title.trim(), owner_id: owner ? Number(owner) : null,
      priority, due_date: date === propertyDateInput(original.due_date) ? original.due_date || null : date || null,
      note: note.trim() || null, expected_updated_at: original.updated_at });
  }}>
    {error ? <div role="alert" className="pill urgent">{error}</div> : null}
    <label className="label">Project title<input className="input" required maxLength={180} value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label className="label">Owner<select className="select" value={owner} onChange={event => setOwner(event.target.value)}><option value="">Unassigned</option>{owner && !people.some(person => String(person.id) === owner) ? <option value={owner}>Current owner (unavailable)</option> : null}{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
    {peopleError ? <p role="status">{peopleError}</p> : null}
    <label className="label">Priority<select className="select" value={priority} onChange={event => setPriority(event.target.value)}><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
    <label className="label">Due date<input className="input" type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
    <label className="label">Notes<textarea className="textarea" value={note} onChange={event => setNote(event.target.value)} /></label>
    {!original.updated_at ? <p role="alert">Refresh the project to load its current details before editing.</p> : null}
    <div className="toolbar"><button className="btn" disabled={busy || !title.trim() || !original.updated_at}>{busy ? 'Saving…' : 'Save project'}</button><button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>Cancel editing</button></div>
  </form>;
}
