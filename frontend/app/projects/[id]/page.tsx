'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { Top } from '@/components/Top';
import { Icon } from '@/components/Icon';
import { Pill } from '@/components/Pill';
import { Tabs } from '@/components/Tabs';
import { Drawer } from '@/components/Drawer';

const categories = ['Decorations', 'Food & drinks', 'Activities', 'Equipment', 'Marketing', 'Other'];
const statuses = ['All', 'Suggested', 'Planned', 'Purchased', 'Declined'];
const money = (cents: number | null | undefined) => cents == null ? 'Not set' : new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(cents / 100);
const stamp = (date: string) => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(new Date(date));
const initials = (name: string) => name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
function cents(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) > 10000000) throw new Error('Enter a price from ₱0 to ₱10,000,000, with up to two decimal places.');
  return Math.round(Number(value) * 100);
}
const blankItem = { name: '', quantity: '1', price: '', category: 'Other', note: '', actual: '' };

export default function ProjectWorkspace() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const search = useSearchParams();
  const [syncError, setSyncError] = useState(false);
  const [data, setData] = useState<Entity | null>(null);
  const [tab, setTab] = useState('Discussion');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState('');
  const [type, setType] = useState('Suggestion');
  const [sort, setSort] = useState('Latest');
  const [thread, setThread] = useState<number | null>(null);
  const [reply, setReply] = useState('');
  const [filter, setFilter] = useState('All');
  const [selectedPurchase, setSelectedPurchase] = useState<number | null>(null);
  const [editing, setEditing] = useState<Entity | null>(null);
  const [item, setItem] = useState(blankItem);
  const [formError, setFormError] = useState('');
  const [paying, setPaying] = useState<Entity | null>(null);
  const [actual, setActual] = useState('');
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetExpanded, setBudgetExpanded] = useState(false);
  const [limit, setLimit] = useState('');
  const [budgetVersion, setBudgetVersion] = useState(0);

  const purchaseDialog = useMemo(() => editing ? {} : null, [editing]);
  const paymentDialog = useMemo(() => paying ? {} : null, [paying]);
  const closePurchase = useCallback(() => { if (!busy) setEditing(null); }, [busy]);
  const closePayment = useCallback(() => { if (!busy) setPaying(null); }, [busy]);

  const load = useCallback(async () => { const next = await api.projectWorkspace(id); setData(next); return next; }, [id]);
  useEffect(() => { let active = true; setData(null); setError(''); api.projectWorkspace(id).then(next => { if (active) setData(next); }).catch(err => { if (active) setError(err.message); }); return () => { active = false; }; }, [id]);

  useEffect(() => {
    if (busy || editing || paying || budgetOpen) return;
    let active = true, pending = false;
    async function refresh() {
      if (document.visibilityState !== 'visible' || pending) return;
      pending = true;
      try {
        const next = await api.projectWorkspace(id);
        if (active) { setData(next); setSyncError(false); }
      } catch { if (active) setSyncError(true); }
      finally { pending = false; }
    }
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [id, busy, editing, paying, budgetOpen]);

  const discussionLink = Number(search.get('discussion'));
  const purchaseLink = Number(search.get('purchase'));
  const loaded = Boolean(data);
  useEffect(() => {
    if (!loaded) return;
    if (purchaseLink > 0) { setTab('Purchase list'); setFilter('All'); setSelectedPurchase(purchaseLink); }
    else if (discussionLink > 0) { setTab('Discussion'); setThread(discussionLink); }
  }, [id, loaded, discussionLink, purchaseLink]);

  useEffect(() => {
    if (tab === 'Discussion' && thread) document.getElementById(`discussion-${thread}`)?.scrollIntoView({ block: 'nearest' });
  }, [tab, thread]);

  useEffect(() => {
    if (tab !== 'Purchase list' || !selectedPurchase) return;
    const target = document.getElementById(`purchase-${selectedPurchase}`);
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
  }, [tab, selectedPurchase]);

  async function run(action: () => Promise<unknown>, done?: () => void) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); done?.(); await load(); }
    catch (err: any) { setError(err.message || 'Could not save. Try again.'); }
    finally { setBusy(false); }
  }

  function openItem(source?: Entity, existing?: Entity) {
    setFormError('');
    setEditing(existing || { source_comment_id: source?.id || null, source_body: source?.body });
    setItem(existing ? { name: existing.name, quantity: String(existing.quantity), price: existing.unit_price_cents == null ? '' : String(existing.unit_price_cents / 100), category: existing.category, note: existing.note || '', actual: existing.actual_total_cents == null ? '' : String(existing.actual_total_cents / 100) } : { ...blankItem, note: source?.body?.slice(0, 4000) || '' });
  }

  async function saveItem() {
    if (!editing || busy) return;
    setFormError('');
    try {
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) throw new Error('Quantity must be a whole number from 1 to 10,000.');
      const payload = { name: item.name.trim(), quantity, unit_price_cents: cents(item.price), category: item.category, note: item.note.trim() || null };
      if (!payload.name) throw new Error('Enter an item name.');
      const actualCost = editing.status === 'Purchased' ? cents(item.actual) : null;
      if (editing.status === 'Purchased' && actualCost == null) throw new Error('Enter the actual total paid.');
      setBusy(true);
      if (editing.id) await api.editProjectPurchase(id, editing.id, { ...payload, actual_total_cents: actualCost, version: editing.version });
      else await api.projectPurchase(id, { ...payload, source_comment_id: editing.source_comment_id || null });
      setEditing(null); setTab('Purchase list'); await load();
    } catch (err: any) { setFormError(err.message || 'Could not save the item.'); setError(err.message || 'Could not save the item.'); }
    finally { setBusy(false); }
  }

  async function savePaid() {
    if (!paying || busy) return;
    try {
      const cost = cents(actual);
      if (cost == null) throw new Error('Enter the actual total paid.');
      setBusy(true); setFormError('');
      await api.projectPurchaseStatus(id, paying.id, { status: 'Purchased', actual_total_cents: cost, version: paying.version });
      setPaying(null); await load();
    } catch (err: any) { setFormError(err.message); }
    finally { setBusy(false); }
  }

  if (!data) return <div className="ops-module"><Link href="/projects">← Projects</Link><Top title="Project" />{error ? <p role="alert">{error}</p> : <div className="empty">Loading project…</div>}</div>;
  const { project, budget, purchases, comments, tasks, can_manage: manage, can_contribute: contribute } = data;
  const roots: Entity[] = comments.filter((c: Entity) => !c.reply_to_id).sort((a: Entity, b: Entity) => sort === 'Top' ? b.vote_count - a.vote_count || b.id - a.id : b.id - a.id);
  const visible: Entity[] = purchases.filter((p: Entity) => filter === 'All' || p.status === filter);
  let itemEstimate: number | null = null;
  try {
    const unit = cents(item.price), quantity = Number(item.quantity);
    if (unit != null && Number.isInteger(quantity) && quantity >= 1 && quantity <= 10000) itemEstimate = unit * quantity;
  } catch { /* The form displays validation errors on submit. */ }
  const totalProgress = tasks.length ? Math.round(tasks.filter((t: Entity) => t.status === 'Done').length * 100 / tasks.length) : 0;

  const budgetCard = <aside className={`event-budget-card ${budgetExpanded ? '' : 'event-budget-collapsed'}`}>
    <div className="event-card-heading"><h2>Budget</h2><div className="event-inline-actions"><button className="event-budget-toggle event-text-button" aria-expanded={budgetExpanded} onClick={() => setBudgetExpanded(!budgetExpanded)}>{budgetExpanded ? 'Hide totals' : 'Show totals'}</button>{manage ? <button className="event-text-button" onClick={() => { setLimit(budget.limit_cents == null ? '' : String(budget.limit_cents / 100)); setBudgetVersion(budget.version); setBudgetOpen(!budgetOpen); setBudgetExpanded(true); }}>Edit</button> : null}</div></div>
    <span className="event-budget-label">Budget limit</span><strong className="event-budget-limit">{money(budget.limit_cents)}</strong><p className="event-budget-mobile-total">Planned + purchased <strong>{money(budget.committed_cents)}</strong></p>{budget.remaining_cents != null ? <p className={`event-budget-mobile-total event-budget-mobile-remaining ${budget.remaining_cents < 0 ? 'event-over-budget' : ''}`}><span>{budget.remaining_cents < 0 ? 'Over budget' : 'Remaining'}</span><strong>{money(Math.abs(budget.remaining_cents))}</strong></p> : null}
    {budgetOpen ? <form className="event-budget-form" onSubmit={event => { event.preventDefault(); let cost; try { cost = cents(limit); } catch (err: any) { setError(err.message); return; } void run(() => api.projectBudget(id, { limit_cents: cost, version: budgetVersion }), () => setBudgetOpen(false)); }}><label className="label">Budget limit (₱)<input aria-label="Budget limit (₱)" className="input" type="number" min="0" step="0.01" value={limit} onChange={e => setLimit(e.target.value)} placeholder="No limit set" /></label><div className="event-inline-actions"><button className="btn small" disabled={busy}>Save budget</button><button type="button" className="btn secondary small" onClick={() => setBudgetOpen(false)}>Cancel</button></div></form> : null}
    <dl><div><dt>Planned estimate</dt><dd>{money(budget.planned_cents)}</dd></div><div><dt>Purchased · actual</dt><dd>{money(budget.purchased_cents)}</dd></div><div className="event-budget-total"><dt>Planned + purchased</dt><dd>{money(budget.committed_cents)}</dd></div>{budget.remaining_cents != null ? <div className={budget.remaining_cents < 0 ? 'event-over-budget' : ''}><dt>{budget.remaining_cents < 0 ? 'Over budget' : 'Remaining'}</dt><dd>{money(Math.abs(budget.remaining_cents))}</dd></div> : null}</dl>
    <div className="event-budget-forecast"><span>Including suggestions</span><strong>{money(budget.forecast_cents)}</strong>{budget.limit_cents != null && budget.forecast_cents > budget.limit_cents ? <small>{money(budget.forecast_cents - budget.limit_cents)} above the limit</small> : null}</div>
    {budget.unpriced_count ? <p className="event-unpriced" role="status">{budget.unpriced_count} item{budget.unpriced_count === 1 ? '' : 's'} still need{budget.unpriced_count === 1 ? 's' : ''} a price. Totals are incomplete.</p> : null}
    <p className="event-budget-footnote">PHP · Declined items excluded.</p>
  </aside>;

  return <div className="ops-module event-workspace">
    <Link href="/projects" className="event-back">← Projects</Link>
    <Top title={project.title} right={<div className="event-inline-actions"><button className="ops-icon-button" aria-label="Refresh project" disabled={busy} onClick={() => void run(async () => {})}><Icon name="refresh" /></button><Link className="btn secondary" href={`/projects?project=${id}`}>Project details</Link></div>} />
    <div className="event-project-meta"><Pill value={project.status} />{project.due_date ? <span><Icon name="clock" />{new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(project.due_date))}</span> : null}<span>{tasks.length} tasks · {totalProgress}% done</span></div>
    {project.note ? <p className="event-project-note">{project.note}</p> : null}
    {error ? <div role="alert" className="event-error">{error}<button className="event-text-button" onClick={() => void run(async () => {})}>Refresh</button></div> : null}
    {syncError ? <p role="status" className="event-readonly">Updates paused. Reconnecting…</p> : null}
    {!contribute ? <p className="event-readonly">{project.status === 'Done' || project.hidden_from_active ? 'This project is closed.' : 'You have view-only access to this project.'}</p> : null}
    <div className="event-tabs"><Tabs values={['Discussion', 'Purchase list', 'Tasks']} active={tab} onChange={setTab} label="Project sections" /><span>{roots.length} discussion{roots.length === 1 ? '' : 's'} · {purchases.length} purchase items</span></div>
    <div className="event-layout"><div className="event-main">
      {tab === 'Discussion' ? <>
        {contribute ? <form className="event-composer" onSubmit={event => { event.preventDefault(); void run(() => api.projectDiscussion(id, { body: body.trim(), comment_type: type }), () => setBody('')); }}><div className="event-card-heading"><h2>New discussion</h2><select aria-label="Discussion type" className="select" value={type} onChange={e => setType(e.target.value)}>{['Suggestion', 'Question', 'Update', ...(manage ? ['Decision'] : [])].map(value => <option key={value}>{value}</option>)}</select></div><textarea aria-label="Discussion message" className="textarea" placeholder="Share an idea or ask a question…" maxLength={10000} value={body} onChange={e => setBody(e.target.value)} /><div className="event-composer-actions"><button className="btn" disabled={busy || !body.trim()}>Post</button></div></form> : null}
        <div className="event-feed-heading"><h2>Discussion <span>{roots.length}</span></h2><select aria-label="Sort discussions" className="select" value={sort} onChange={e => setSort(e.target.value)}><option>Latest</option><option>Top</option></select></div>
        <div className="event-feed">{roots.map(post => { const replies: Entity[] = comments.filter((c: Entity) => c.reply_to_id === post.id); const linked: Entity[] = purchases.filter((p: Entity) => p.source_comment_id === post.id); return <article className="event-thread" id={`discussion-${post.id}`} key={post.id}>
          <div className="event-post-header"><span className="event-avatar">{initials(post.author_name)}</span><div><strong>{post.author_name}</strong><time dateTime={post.created_at}>{stamp(post.created_at)}</time></div><span className={`event-type event-type-${post.comment_type.toLowerCase()}`}>{post.comment_type}</span></div>
          <p className="event-post-body">{post.body}</p>
          {linked.length ? <div className="event-linked-items">{linked.map(p => <button key={p.id} onClick={() => { setTab('Purchase list'); setFilter('All'); setSelectedPurchase(p.id); }}><Icon name="request" /><span>{p.name}</span><small>{p.status} · {p.status === 'Purchased' ? money(p.actual_total_cents) : p.estimate_cents == null ? 'Needs price' : money(p.estimate_cents)}</small></button>)}</div> : null}
          <div className="event-thread-actions"><button aria-label={`Vote for ${post.author_name}'s discussion`} aria-pressed={post.voted} disabled={busy || !contribute} className={post.voted ? 'event-voted' : ''} onClick={() => void run(() => api.projectVote(id, post.id, !post.voted))}><span aria-hidden="true">↑</span>{post.vote_count}</button><button onClick={() => { setThread(thread === post.id ? null : post.id); setReply(''); }}>Replies{replies.length ? ` · ${replies.length}` : ''}</button>{contribute ? <button onClick={() => openItem(post)}><Icon name="plus" />Suggest purchase</button> : null}</div>
          {thread === post.id ? <div className="event-replies">{replies.map(r => <div className="event-reply" key={r.id}><span className="event-avatar">{initials(r.author_name)}</span><div><header><strong>{r.author_name}</strong><time dateTime={r.created_at}>{stamp(r.created_at)}</time></header><p>{r.body}</p></div></div>)}{!replies.length ? <p className="muted">No replies yet.</p> : null}{contribute ? <form onSubmit={event => { event.preventDefault(); void run(() => api.projectDiscussion(id, { body: reply.trim(), comment_type: 'Update', reply_to_id: post.id }), () => setReply('')); }}><textarea className="textarea" aria-label="Reply" placeholder="Write a reply…" maxLength={10000} value={reply} onChange={e => setReply(e.target.value)} /><button className="btn small" disabled={busy || !reply.trim()}>Reply</button></form> : null}</div> : null}
        </article>; })}{!roots.length ? <div className="empty">No discussions yet.</div> : null}</div>
      </> : tab === 'Purchase list' ? <>
        <div className="event-feed-heading"><h2>Purchase list</h2>{contribute ? <button className="btn" onClick={() => openItem()}><Icon name="plus" />Suggest item</button> : null}</div>
        <div className="event-purchase-filters"><Tabs values={statuses} active={filter} onChange={value => { setFilter(value); setSelectedPurchase(null); }} label="Purchase status" /></div>
        <div className="event-purchase-list">{visible.map(p => <article className={`event-purchase ${selectedPurchase === p.id ? 'event-purchase-selected' : ''}`} id={`purchase-${p.id}`} tabIndex={-1} aria-label={p.name} key={p.id}>
          <div className="event-purchase-heading"><span className="ops-record-icon"><Icon name={p.category === 'Food & drinks' ? 'leaf' : p.category === 'Equipment' ? 'maintenance' : 'request'} /></span><div><h3>{p.name}</h3><span>{p.category} · {p.proposed_by_name}</span></div><span className={`event-purchase-status event-status-${p.status.toLowerCase()}`}>{p.status}</span></div>
          {p.note ? <p className="event-purchase-note">{p.note}</p> : null}
          <div className="event-item-cost"><div><span>Quantity</span><strong>{p.quantity}</strong></div><div><span>Unit estimate</span><strong>{p.unit_price_cents == null ? 'Needs price' : money(p.unit_price_cents)}</strong></div><div><span>Estimated total</span><strong>{p.estimate_cents == null ? '—' : money(p.estimate_cents)}</strong></div>{p.status === 'Purchased' ? <div><span>Actual total</span><strong>{money(p.actual_total_cents)}</strong></div> : null}</div>
          <div className="event-purchase-actions">{p.source_comment_id ? <button className="event-text-button" onClick={() => { const source = comments.find((c: Entity) => c.id === p.source_comment_id); setThread(source?.reply_to_id || p.source_comment_id); setTab('Discussion'); }}>View discussion</button> : null}{p.can_edit ? <button className="btn small secondary" onClick={() => openItem(undefined, p)}>Edit</button> : null}{manage ? <>{p.status === 'Suggested' ? <><button className="btn small" disabled={busy} onClick={() => void run(() => api.projectPurchaseStatus(id, p.id, { status: 'Planned', version: p.version }))}>Add to plan</button><button className="btn small secondary" disabled={busy} onClick={() => void run(() => api.projectPurchaseStatus(id, p.id, { status: 'Declined', version: p.version }))}>Decline</button></> : p.status === 'Planned' ? <><button className="btn small" onClick={() => { setPaying(p); setActual(p.estimate_cents == null ? '' : String(p.estimate_cents / 100)); setFormError(''); }}>Mark purchased</button><button className="btn small secondary" disabled={busy} onClick={() => void run(() => api.projectPurchaseStatus(id, p.id, { status: 'Suggested', version: p.version }))}>Move to suggested</button></> : <button className="btn small secondary" disabled={busy} onClick={() => void run(() => api.projectPurchaseStatus(id, p.id, { status: p.status === 'Purchased' ? 'Planned' : 'Suggested', version: p.version }))}>{p.status === 'Purchased' ? 'Return to planned' : 'Reconsider'}</button>}</> : null}</div>
        </article>)}{!visible.length ? <div className="empty">No {filter === 'All' ? '' : filter.toLowerCase() + ' '}purchase items.</div> : null}</div>
      </> : <section className="event-task-list"><div className="event-card-heading"><h2>Tasks</h2>{manage ? <Link className="btn secondary small" href={`/projects?project=${id}`}>Manage tasks</Link> : null}</div>{tasks.map((t: Entity) => <div key={t.id}><Icon name={t.status === 'Done' ? 'check' : 'tasks'} /><strong>{t.title}</strong><Pill value={t.status} /></div>)}{!tasks.length ? <p className="muted">No linked tasks.</p> : null}</section>}
    </div>{budgetCard}</div>
    <Drawer item={purchaseDialog} title={editing?.id ? 'Edit purchase item' : 'Suggest purchase'} onClose={closePurchase}><form className="event-item-form" onSubmit={event => { event.preventDefault(); void saveItem(); }}>
      {formError ? <p role="alert" className="event-error">{formError}</p> : null}
      <label className="label">Item name<input className="input" autoComplete="off" required maxLength={180} value={item.name} onChange={e => setItem({ ...item, name: e.target.value })} /></label>
      <div className="form-grid"><label className="label">Quantity<input className="input" type="number" min="1" max="10000" step="1" required value={item.quantity} onChange={e => setItem({ ...item, quantity: e.target.value })} /></label><label className="label">Unit estimate (₱)<input className="input" type="number" min="0" max="10000000" step="0.01" placeholder="Not priced yet" value={item.price} onChange={e => setItem({ ...item, price: e.target.value })} /></label></div>
      <div className="event-item-estimate" role="status"><span>Estimated total</span><strong>{itemEstimate == null ? 'Needs price' : money(itemEstimate)}</strong></div>
      <label className="label">Category<select className="select" value={item.category} onChange={e => setItem({ ...item, category: e.target.value })}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
      <label className="label">Notes<textarea className="textarea" maxLength={4000} value={item.note} onChange={e => setItem({ ...item, note: e.target.value })} /></label>
      {editing?.status === 'Purchased' ? <label className="label">Actual total paid (₱)<input className="input" type="number" min="0" step="0.01" required value={item.actual} onChange={e => setItem({ ...item, actual: e.target.value })} /></label> : null}
      {editing?.source_comment_id ? <span className="muted">Linked to the original discussion.</span> : null}
      <button className="btn" disabled={busy || !item.name.trim()}>{busy ? 'Saving…' : editing?.id ? 'Save changes' : 'Add suggestion'}</button>
    </form></Drawer>
    <Drawer item={paymentDialog} title="Mark purchased" onClose={closePayment}><form className="event-item-form" onSubmit={event => { event.preventDefault(); void savePaid(); }}><h2>{paying?.name}</h2>{formError ? <p role="alert" className="event-error">{formError}</p> : null}<label className="label">Actual total paid (₱)<input className="input" type="number" min="0" max="10000000" step="0.01" required value={actual} onChange={e => setActual(e.target.value)} /></label><button className="btn" disabled={busy}>Save purchase</button></form></Drawer>
  </div>;
}
