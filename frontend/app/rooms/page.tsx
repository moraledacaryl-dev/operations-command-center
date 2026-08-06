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
        {rooms.map(room => (
          <button
            className="card card-button"
            type="button"
            key={room.id}
            onClick={() => open(room.id)}
            aria-label={`Open ${room.name} room memory`}
          >
            <div className="card-title">{room.name}</div>
            <div className="card-line"><Pill value={room.kind} /><Pill value={room.status} /></div>
          </button>
        ))}
      </div>
      {selected && <div className="panel" style={{ marginTop: 18 }}>
        <div className="topbar"><h2>{selected.room.name}</h2><button className="btn secondary" onClick={() => setSelected(null)}>Close</button></div>
        <div className="grid cols-2">
          <section><h3>Guests</h3><div className="grid">{selected.guests.map((guest: Entity) => <div className="card" key={guest.id}><b>{guest.title}</b><div className="card-line"><Pill value={guest.issue_type} /><Pill value={guest.status} /></div></div>)}</div></section>
          <section><h3>Fixes</h3><div className="grid">{selected.fixes.map((fix: Entity) => <div className="card" key={fix.id}><b>{fix.title}</b><div className="card-line"><Pill value={fix.status} /><Pill value={fix.urgency} /></div></div>)}</div></section>
        </div>
      </div>}
    </>
  );
}
