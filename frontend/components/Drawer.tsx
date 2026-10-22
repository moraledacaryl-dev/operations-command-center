'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Entity } from '@/lib/api';
import { Pill } from './Pill';

const hidden = new Set([
  'id', 'created_at', 'updated_at', 'hidden_from_active', 'archived_at',
  'archive_reason', 'completed_at', 'comments', 'attachments', 'activity',
]);

function isPresent(value: unknown) {
  return value !== null && value !== undefined && value !== '';
}

function shouldShowDetail(key: string, value: unknown) {
  if (hidden.has(key) || key.endsWith('_id') || !isPresent(value)) return false;
  return ['string', 'number', 'boolean'].includes(typeof value);
}

function detailLabel(key: string) {
  return key.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function detailValue(key: string, value: unknown) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && (key.endsWith('_at') || key.endsWith('_date'))) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('en-PH', {
        dateStyle: 'medium',
        timeStyle: key.endsWith('_at') ? 'short' : undefined,
        timeZone: 'Asia/Manila',
      }).format(date);
    }
  }
  return String(value);
}

export function Drawer({ item, title, onClose, children, showSupplemental = true }: {
  item: Entity | null;
  title?: string;
  onClose: () => void;
  children?: React.ReactNode;
  showSupplemental?: boolean;
}) {
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const isOpen = item !== null;

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById('operations-app-root');

    document.body.style.overflow = 'hidden';
    document.body.dataset.modalOpen = 'true';
    if (appRoot) appRoot.inert = true;

    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter(element =>
        element.getClientRects().length > 0
        && !element.hasAttribute('hidden')
        && !element.closest('[inert], [aria-hidden="true"]')
      );

      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      delete document.body.dataset.modalOpen;
      if (appRoot) appRoot.inert = false;
      // A workflow update may move a board card into another column,
      // disconnecting the original trigger. Never focus a stale node.
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
      else document.getElementById('workspace-main')?.focus();
    };
  }, [isOpen]);

  // Keep the open dialog usable if a status action replaces its focused
  // button. Do not reset the original trigger/scroll-lock on item refresh.
  useEffect(() => {
    if (item && dialogRef.current && !dialogRef.current.contains(document.activeElement)) {
      closeRef.current?.focus();
    }
  }, [item]);

  if (!item || typeof document === 'undefined') return null;

  const displayTitle = title || item.title || item.name || 'Item';
  const details = Object.entries(item).filter(([key, value]) =>
    shouldShowDetail(key, value)
    && !((key === 'title' || key === 'name') && value === displayTitle)
  );

  return createPortal(
    <div
      className="drawer-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="drawer"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="drawer-head">
          <div>
            <h1 id={titleId}>{displayTitle}</h1>
            <div className="card-line">
              <Pill value={item.status || item.review_status} />
              <Pill value={item.priority || item.urgency} />
            </div>
          </div>
          <button ref={closeRef} type="button" className="btn secondary" onClick={onClose} aria-label="Close details">
            Close
          </button>
        </div>

        {children}

        {showSupplemental && item.activity?.length ? (
          <div className="panel" style={{ marginTop: 16 }}>
            <h2>Activity</h2>
            <div className="timeline">
              {item.activity.map((entry: Entity) => (
                <div className="timeline-item" key={entry.id}>
                  <b>{entry.action}</b>
                  <span>{entry.message}</span>
                  <small>{entry.created_at ? detailValue('created_at', entry.created_at) : ''}</small>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {showSupplemental && item.attachments?.length ? (
          <div className="panel" style={{ marginTop: 16 }}>
            <h2>Attachments</h2>
            <div className="grid" style={{ marginTop: 12 }}>
              {item.attachments.map((attachment: Entity) => (
                <a className="version" key={attachment.id} href={`/api/attachments/${attachment.id}/download`} target="_blank" rel="noreferrer">
                  <b>{attachment.filename}</b>
                  <span className="muted">{attachment.mime_type}</span>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {showSupplemental && details.length ? (
          <div className="panel drawer-details" style={{ marginTop: 16 }}>
            <h2>Details</h2>
            {details.map(([key, value]) => (
              <div className="detail-row" key={key}>
                <span>{detailLabel(key)}</span>
                <span>{detailValue(key, value)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
