'use client';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';

const filters = ['All', 'Rooms', 'Areas', 'Needs action'];
const statusOptions = ['active', 'watch', 'cleaning', 'maintenance', 'out of service'];
const blankFollowUp = { kind: 'guest', title: '', urgency: 'Normal', note: '' };

function isOpenGuest(item: Entity) {
  return item.status !== 'Done' && !item.hidden_from_active;
}

function isOpenFix(item: Entity) {
  return item.status !== 'Verified' && !item.hidden_from_active;
}

function roomStats(room: Entity, guests: Entity[], fixes: Entity[]) {
  const roomGuests = guests.filter(item => Number(item.room_area_id) === Number(room.id) && isOpenGuest(item));
  const roomFixes = fixes.filter(item => Number(item.room_area_id) === Number(room.id) && isOpenFix(item));
  const urgent = [...roomGuests, ...roomFixes].filter(item => item.urgency === 'Urgent').length;
  return { guests: roomGuests.length, fixes: roomFixes.length, urgent, needsAction: roomGuests.length + roomFixes.length + urgent > 0 };
}

function defaultDepartmentId(meta: Entity, kind: string) {
  const needle = kind === 'fix' ? 'maintenance' : 'front desk';
  return meta.departments?.find((department: Entity) => String(department.name || '').toLowerCase().includes(needle))?.id || null;
}

function itemNote(item: Entity) {
  return String(item.note || item.problem || item.action_taken || '').slice(0, 100);
}

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Entity[]>([]);
  const [guests, setGuests] = useState<Entity[]>([]);
  const [fixes, setFixes] = useState<Entity[]>([]);
  const [meta, setMeta] = useState<Entity>({ departments: [] });
  const [selected, setSelected] = useState<Entity | null>(null);
  const [memory, setMemory] = useState<Entity | null>(null);
  const [roomEdit, setRoomEdit] = useState<Entity>({ status: '', note: '' });
  const [followUp, setFollowUp] = useState<Entity>(blankFollowUp);
  const [filter, setFilter] = useState('All');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setError('');
    try {
      const [roomRows, guestRows, fixRows, metaRows] = await Promise.all([
        api.list('rooms', { active: false, limit: 500 }),
        api.list('guests', { active: true, limit: 500 }),
        api.list('fixes', { active: true, limit: 500 }),
        api.meta(),
      ]);
      setRooms(roomRows);
      setGuests(guestRows);
      setFixes(fixRows);
      setMeta(metaRows);
    } catch (err: any) {
      setError(err.message || 'Could not load rooms.');
    }
  }

  useEffect(() => { load(); }, []);

  async function open(room: Entity) {
    setError('');
    setSaved('');
    setSelected(room);
    setRoomEdit({ status: room.status || 'active', note: room.note || '' });
    setMemory(await api.roomMemory(room.id));
  }

  async function saveRoom() {
    const room = memory?.room || selected;
    if (!room) return;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const updated = await api.update('rooms', room.id, roomEdit);
      setSaved('Room updated.');
      setRooms(rows => rows.map(row => Number(row.id) === Number(updated.id) ? { ...row, ...updated } : row));
      await open({ ...room, ...updated });
    } catch (err: any) {
      setError(err.message || 'Could not update room.');
    } finally {
      setBusy(false);
    }
  }

  async function createFollowUp() {
    const room = memory?.room || selected;
    if (!room || !String(followUp.title || '').trim()) {
      setError('Title is required.');
      return;
    }
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const department_id = defaultDepartmentId(meta, followUp.kind);
      if (followUp.kind === 'fix') {
        await api.create('fixes', {
          title: followUp.title,
          room_area_id: room.id,
          department_id,
          urgency: followUp.urgency,
          status: 'Open',
          problem: followUp.note,
        });
      } else {
        await api.create('guests', {
          title: followUp.title,
          room_area_id: room.id,
          department_id,
          issue_type: 'Request',
          urgency: followUp.urgency,
          status: 'Open',
          note: followUp.note,
        });
      }
      setFollowUp(blankFollowUp);
      setSaved('Follow-up created.');
      await load();
      await open(room);
    } catch (err: any) {
      setError(err.message || 'Could not create follow-up.');
    } finally {
      setBusy(false);
    }
  }

  const visibleRooms = rooms.filter(room => {
    const stats = roomStats(room, guests, fixes);
    const text = `${room.name || ''} ${room.kind || ''} ${room.status || ''} ${room.note || ''}`.toLowerCase();
    if (q && !text.includes(q.toLowerCase())) return false;
    if (filter === 'Rooms' && room.kind !== 'room') return false;
    if (filter === 'Areas' && room.kind === 'room') return false;
    if (filter === 'Needs action' && !stats.needsAction) return false;
    return true;
  });
  const totalOpenGuests = guests.filter(isOpenGuest).length;
  const totalOpenFixes = fixes.filter(isOpenFix).length;
  const urgentRooms = rooms.filter(room => roomStats(room, guests, fixes).urgent > 0).length;
  const selectedStats = selected ? roomStats(selected, guests, fixes) : null;

  return (
    <>
      <Top eyebrow="Operations" title="Rooms" right={<button className="btn secondary" onClick={load}>Refresh</button>} />
      {error ? <div className="pill urgent" style={{ marginBottom: 12 }}>{error}</div> : null}
      {saved ? <div className="pill ok" style={{ marginBottom: 12 }}>{saved}</div> : null}
      <div className="owner-command-grid">
        <section className="panel">
          <div className="section-head"><h2>Room pulse</h2><Pill value={`${visibleRooms.length} shown`} /></div>
          <div className="command-metrics">
            <span><span>Rooms</span><b>{rooms.filter(room => room.kind === 'room').length}</b></span>
            <span><span>Guest items</span><b>{totalOpenGuests}</b></span>
            <span><span>Fixes</span><b>{totalOpenFixes}</b></span>
            <span><span>Urgent</span><b>{urgentRooms}</b></span>
          </div>
        </section>
        <section className="panel">
          <h2>Find</h2>
          <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
            <input className="input" style={{ maxWidth: 320 }} placeholder="Room, area, status" value={q} onChange={event => setQ(event.target.value)} />
            <div className="tabs" style={{ marginBottom: 0 }}>{filters.map(item => <button key={item} className={`tab ${filter === item ? 'active' : ''}`} onClick={() => setFilter(item)}>{item}</button>)}</div>
          </div>
        </section>
      </div>

      <div className="grid cols-3">
        {visibleRooms.map(room => {
          const stats = roomStats(room, guests, fixes);
          return (
            <div className={`card ${stats.needsAction ? 'card-important' : ''}`} key={room.id} onClick={() => open(room)}>
              <div className="section-head">
                <div className="card-title">{room.name}</div>
                <Pill value={room.status || 'active'} />
              </div>
              <div className="card-line">
                <Pill value={room.kind} />
                <Pill value={`Guests: ${stats.guests}`} />
                <Pill value={`Fixes: ${stats.fixes}`} />
                {stats.urgent ? <Pill value={`Urgent: ${stats.urgent}`} /> : null}
              </div>
              {room.note ? <span className="muted">{String(room.note).slice(0, 90)}</span> : null}
            </div>
          );
        })}
      </div>

      {selected ? (
        <section className="panel room-detail">
          <div className="topbar">
            <div>
              <div className="eyebrow">Selected</div>
              <h2>{memory?.room?.name || selected.name}</h2>
            </div>
            <button className="btn secondary" onClick={() => { setSelected(null); setMemory(null); }}>Close</button>
          </div>
          <div className="card-line" style={{ marginBottom: 14 }}>
            <Pill value={memory?.room?.kind || selected.kind} />
            <Pill value={`Guests: ${selectedStats?.guests || 0}`} />
            <Pill value={`Fixes: ${selectedStats?.fixes || 0}`} />
          </div>
          <div className="grid cols-2">
            <section>
              <h3>Status</h3>
              <div className="form-grid" style={{ marginTop: 12 }}>
                <label className="label">Status
                  <select className="select" value={roomEdit.status || ''} onChange={event => setRoomEdit({ ...roomEdit, status: event.target.value })}>
                    {statusOptions.map(status => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>
                <label className="label">Note<input className="input" value={roomEdit.note || ''} onChange={event => setRoomEdit({ ...roomEdit, note: event.target.value })} /></label>
              </div>
              <div className="toolbar"><button className="btn" disabled={busy} onClick={saveRoom}>Save room</button></div>
            </section>
            <section>
              <h3>Create follow-up</h3>
              <div className="form-grid" style={{ marginTop: 12 }}>
                <label className="label">Type
                  <select className="select" value={followUp.kind} onChange={event => setFollowUp({ ...followUp, kind: event.target.value })}>
                    <option value="guest">Guest</option>
                    <option value="fix">Fix</option>
                  </select>
                </label>
                <label className="label">Priority
                  <select className="select" value={followUp.urgency} onChange={event => setFollowUp({ ...followUp, urgency: event.target.value })}>
                    {['Low', 'Normal', 'Urgent'].map(priority => <option key={priority}>{priority}</option>)}
                  </select>
                </label>
                <label className="label">Title<input className="input" value={followUp.title || ''} onChange={event => setFollowUp({ ...followUp, title: event.target.value })} /></label>
                <label className="label">Note<input className="input" value={followUp.note || ''} onChange={event => setFollowUp({ ...followUp, note: event.target.value })} /></label>
              </div>
              <div className="toolbar"><button className="btn secondary" disabled={busy} onClick={createFollowUp}>Create</button></div>
            </section>
          </div>
          <div className="grid cols-2" style={{ marginTop: 16 }}>
            <section>
              <h3>Guests</h3>
              <div className="grid" style={{ marginTop: 12 }}>
                {memory?.guests?.length ? memory.guests.map((item: Entity) => <div className="card" key={item.id}><b>{item.title}</b><div className="card-line"><Pill value={item.issue_type} /><Pill value={item.status} /><Pill value={item.urgency} /></div>{itemNote(item) ? <span className="muted">{itemNote(item)}</span> : null}</div>) : <div className="empty">No guest items</div>}
              </div>
            </section>
            <section>
              <h3>Fixes</h3>
              <div className="grid" style={{ marginTop: 12 }}>
                {memory?.fixes?.length ? memory.fixes.map((item: Entity) => <div className="card" key={item.id}><b>{item.title}</b><div className="card-line"><Pill value={item.status} /><Pill value={item.urgency} /></div>{itemNote(item) ? <span className="muted">{itemNote(item)}</span> : null}</div>) : <div className="empty">No fixes</div>}
              </div>
            </section>
          </div>
        </section>
      ) : null}
    </>
  );
}
