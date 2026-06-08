'use client';
import { useEffect, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Pill } from '@/components/Pill';

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  useEffect(() => { api.list('rooms', { active: false }).then(setRooms); }, []);
  async function open(id: number) { setSelected(await api.roomMemory(id)); }
  return (
    <>
      <Top eyebrow="Memory" title="Rooms" />
      <div className="grid cols-3">
        {rooms.map(r => <div className="card" key={r.id} onClick={() => open(r.id)}><div className="card-title">{r.name}</div><div className="card-line"><Pill value={r.kind} /><Pill value={r.status} /></div></div>)}
      </div>
      {selected && <div className="panel" style={{ marginTop: 18 }}>
        <div className="topbar"><h2>{selected.room.name}</h2><button className="btn secondary" onClick={() => setSelected(null)}>Close</button></div>
        <div className="grid cols-2">
          <section><h3>Guests</h3><div className="grid">{selected.guests.map((g: Entity) => <div className="card" key={g.id}><b>{g.title}</b><div className="card-line"><Pill value={g.issue_type} /><Pill value={g.status} /></div></div>)}</div></section>
          <section><h3>Fixes</h3><div className="grid">{selected.fixes.map((f: Entity) => <div className="card" key={f.id}><b>{f.title}</b><div className="card-line"><Pill value={f.status} /><Pill value={f.urgency} /></div></div>)}</div></section>
        </div>
      </div>}
    </>
  );
}
