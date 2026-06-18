'use client';
import { assetUrl, Entity } from '@/lib/api';
import { Pill } from './Pill';

const hidden = new Set(['id', 'created_at', 'updated_at', 'hidden_from_active', 'archived_at', 'archive_reason', 'completed_at', 'comments', 'attachments', 'activity', 'payload_json']);

export function Drawer({ item, title, onClose, children }: { item: Entity | null; title?: string; onClose: () => void; children?: React.ReactNode }) {
  if (!item) return null;
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="eyebrow">Open</div>
            <h1>{title || item.title || item.name || 'Item'}</h1>
            <div className="card-line"><Pill value={item.status || item.review_status} /><Pill value={item.priority || item.urgency} /></div>
          </div>
          <button className="btn secondary" onClick={onClose}>Close</button>
        </div>
        {children}
        {item.activity?.length ? (
          <div className="panel" style={{ marginTop: 16 }}>
            <h2>Activity</h2>
            <div className="timeline">
              {item.activity.map((entry: Entity) => (
                <div className="timeline-item" key={entry.id}>
                  <b>{entry.action}</b>
                  <span>{entry.message}</span>
                  <small>{entry.created_at ? String(entry.created_at).slice(0, 16).replace('T', ' ') : ''}</small>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {item.attachments?.length ? (
          <div className="panel" style={{ marginTop: 16 }}>
            <h2>Attachments</h2>
            <div className="grid" style={{ marginTop: 12 }}>
              {item.attachments.map((attachment: Entity) => <a className="version" key={attachment.id} href={assetUrl(attachment.file_url)} target="_blank" rel="noreferrer"><b>{attachment.filename}</b><span className="muted">{attachment.mime_type}</span></a>)}
            </div>
          </div>
        ) : null}
        <div className="panel" style={{ marginTop: 16 }}>
          <h2>Details</h2>
          {Object.entries(item).filter(([k, v]) => !hidden.has(k) && v !== null && v !== '').map(([k, v]) => (
            <div className="detail-row" key={k}>
              <span>{k.replaceAll('_', ' ')}</span>
              <span>{String(v)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
