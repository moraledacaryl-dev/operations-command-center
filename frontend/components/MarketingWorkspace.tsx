'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, Entity } from '@/lib/api';
import { marketingAssetsApi } from '@/lib/marketing-assets-api';
import { ConceptCreativeAssets } from './ConceptCreativeAssets';
import { Drawer } from './Drawer';
import { Pill } from './Pill';
import { Tabs } from './Tabs';

const platforms = ['Facebook', 'Instagram', 'TikTok', 'Google Business', 'Website', 'Internal'];
const formats = ['Reel', 'Story', 'Static', 'Carousel', 'Ad', 'Blog'];
const propertyTimeZone = 'Asia/Manila';
const actionLabels: Record<string, string> = { 'start-draft': 'Start draft', 'submit-review': 'Submit review', 'request-revision': 'Request revision', 'resubmit-review': 'Resubmit', approve: 'Approve', schedule: 'Schedule', publish: 'Publish', 'return-draft': 'Return to draft', reopen: 'Reopen' };

function dayKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (typeof value === 'string') {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: propertyTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const part = (type: string) => parts.find(item => item.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayLabel(value: Date) { return new Intl.DateTimeFormat('en-PH', { weekday: 'short', day: 'numeric' }).format(value); }
function dayAccessibleLabel(value: Date) { return new Intl.DateTimeFormat('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }).format(value); }

function range(anchor: Date, view: string) {
  const from = new Date(anchor); const to = new Date(anchor);
  if (view === 'Month') {
    from.setDate(1); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
    to.setMonth(to.getMonth() + 1, 1); to.setHours(0, 0, 0, 0); to.setDate(to.getDate() + ((8 - to.getDay()) % 7));
  } else if (view === 'Week') {
    const offset = (from.getDay() + 6) % 7; from.setDate(from.getDate() - offset); from.setHours(0, 0, 0, 0); to.setTime(from.getTime()); to.setDate(to.getDate() + 7);
  } else {
    from.setDate(from.getDate() - 14); from.setHours(0, 0, 0, 0); to.setDate(to.getDate() + 45); to.setHours(0, 0, 0, 0);
  }
  return { from, to };
}

export function MarketingWorkspace({ departmentId, canManage, createIntentKey = 0 }: { departmentId: number; canManage: boolean; createIntentKey?: number }) {
  const [view, setView] = useState('Month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [campaigns, setCampaigns] = useState<Entity[]>([]);
  const [concepts, setConcepts] = useState<Entity[]>([]);
  const [calendar, setCalendar] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [showCampaign, setShowCampaign] = useState(false);
  const [showConcept, setShowConcept] = useState(false);
  const [campaign, setCampaign] = useState({ name: '', objective: '', start_at: '', end_at: '' });
  const [concept, setConcept] = useState({ campaign_id: '', title: '', content_pillar: 'General', brief: '', format: 'Reel', scheduled_at: '', shared_caption: '' });
  const [creativeFile, setCreativeFile] = useState<File | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['Facebook', 'Instagram']);
  const [platformOverrides, setPlatformOverrides] = useState<Record<string, { format: string; scheduled_at: string; caption: string }>>({});
  const [note, setNote] = useState(''); const [finalUrl, setFinalUrl] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const conceptFormRef = useRef<HTMLDivElement | null>(null); const lastCreateIntentRef = useRef(0);

  const load = useCallback(async () => {
    const dates = range(anchor, view); setError('');
    try {
      const [campaignRows, conceptRows, calendarRows] = await Promise.all([api.marketingCampaigns(), api.marketingConcepts(), api.marketingCalendar({ date_from: dates.from.toISOString(), date_to: dates.to.toISOString(), department_id: departmentId })]);
      setCampaigns(campaignRows.filter(row => Number(row.department_id) === departmentId));
      setConcepts(conceptRows.filter(row => Number(row.campaign?.department_id) === departmentId)); setCalendar(calendarRows);
    } catch (err: any) { setError(err.message || 'The campaign calendar could not be loaded.'); }
  }, [anchor, departmentId, view]);

  useEffect(() => { void load(); }, [load]);
  const dates = useMemo(() => range(anchor, view), [anchor, view]);
  const calendarDays = useMemo(() => { const days: Date[] = []; const start = new Date(dates.from); const end = new Date(dates.to); while (start < end) { days.push(new Date(start)); start.setDate(start.getDate() + 1); if (days.length >= 42) break; } return days; }, [dates]);
  const scheduled = calendar.filter(item => item.scheduled_at); const unscheduled = calendar.filter(item => !item.scheduled_at);

  function move(direction: number) { const next = new Date(anchor); if (view === 'Month') next.setMonth(next.getMonth() + direction); else next.setDate(next.getDate() + direction * (view === 'Week' ? 7 : 30)); setAnchor(next); }
  function openConceptForm(scheduledAt?: string) {
    if (!canManage || !campaigns.length) return; setShowCampaign(false);
    setConcept(value => ({ ...value, campaign_id: value.campaign_id || String(campaigns[0].id), scheduled_at: scheduledAt ?? value.scheduled_at })); setShowConcept(true);
    window.setTimeout(() => { conceptFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); conceptFormRef.current?.querySelector<HTMLInputElement>('input[name="concept-title"]')?.focus(); }, 0);
  }
  useEffect(() => {
    if (!createIntentKey || createIntentKey <= lastCreateIntentRef.current || !canManage || !campaigns.length) return;
    lastCreateIntentRef.current = createIntentKey; setShowCampaign(false); setConcept(value => ({ ...value, campaign_id: value.campaign_id || String(campaigns[0].id) })); setShowConcept(true);
    window.setTimeout(() => { conceptFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); conceptFormRef.current?.querySelector<HTMLInputElement>('input[name="concept-title"]')?.focus(); }, 0);
  }, [createIntentKey, canManage, campaigns]);

  async function createCampaign() {
    if (!campaign.name.trim() || busy) return; setBusy(true);
    try {
      const created = await api.createMarketingCampaign({ ...campaign, department_id: departmentId, start_at: campaign.start_at ? new Date(`${campaign.start_at}T00:00:00+08:00`).toISOString() : null, end_at: campaign.end_at ? new Date(`${campaign.end_at}T23:59:59+08:00`).toISOString() : null });
      setCampaign({ name: '', objective: '', start_at: '', end_at: '' }); setConcept(value => ({ ...value, campaign_id: String(created.id) })); setShowCampaign(false); setShowConcept(true); await load();
    } catch (err: any) { setError(err.message || 'Campaign could not be created.'); } finally { setBusy(false); }
  }

  async function createConcept() {
    if (!concept.campaign_id || !concept.title.trim() || !selectedPlatforms.length || busy) return; setBusy(true); setError('');
    try {
      const sharedScheduledAt = concept.scheduled_at ? new Date(`${concept.scheduled_at}T09:00:00+08:00`).toISOString() : null;
      const deliverables = selectedPlatforms.map(platform => { const override = platformOverrides[platform]; return { platform, format: override?.format || concept.format, scheduled_at: override?.scheduled_at ? new Date(`${override.scheduled_at}T09:00:00+08:00`).toISOString() : sharedScheduledAt, caption: override?.caption || concept.shared_caption || null }; });
      const created = await api.createMarketingConcept({ ...concept, campaign_id: Number(concept.campaign_id), platforms: selectedPlatforms, deliverables, scheduled_at: sharedScheduledAt });
      if (creativeFile) await marketingAssetsApi.upload(Number(created.concept.id), creativeFile, creativeFile.name, 'Uploaded during canonical content creation');
      setConcept({ campaign_id: concept.campaign_id, title: '', content_pillar: 'General', brief: '', format: 'Reel', scheduled_at: '', shared_caption: '' }); setCreativeFile(null); setPlatformOverrides({}); setShowConcept(false); await load();
      const refreshed = (await api.marketingConcepts()).find(row => Number(row.id) === Number(created.concept.id)); if (refreshed) setSelected(refreshed);
    } catch (err: any) { setError(err.message || 'Content concept could not be created.'); } finally { setBusy(false); }
  }

  async function transition(deliverable: Entity, action: string) { setBusy(true); try { await api.marketingDeliverableAction(deliverable.id, action, { note: note.trim() || null, final_url: finalUrl.trim() || null }); setNote(''); setFinalUrl(''); await load(); const refreshed = (await api.marketingConcepts()).find(row => row.id === selected?.id); if (refreshed) setSelected(refreshed); } catch (err: any) { setError(err.message || 'Platform workflow could not be updated.'); } finally { setBusy(false); } }
  async function reschedule(deliverable: Entity, value: string) { setBusy(true); try { await api.rescheduleMarketingDeliverable(deliverable.id, value ? new Date(`${value}T09:00:00+08:00`).toISOString() : null); await load(); } catch (err: any) { setError(err.message || 'Schedule could not be updated.'); } finally { setBusy(false); } }

  return <section className="marketing-workspace">
    <div className="topbar"><div><p className="eyebrow">Campaign workspace</p><h2>Multi-platform calendar</h2><p className="muted">Plan one concept, then manage each platform deliverable independently.</p></div>{canManage ? <div className="toolbar"><button className="btn secondary" onClick={() => setShowCampaign(value => !value)}>New campaign</button><button className="btn" disabled={!campaigns.length} onClick={() => openConceptForm()}>{showConcept ? 'Edit concept draft' : 'New concept'}</button></div> : null}</div>
    {error ? <div className="pill urgent" role="alert">{error}</div> : null}
    {showCampaign ? <div className="panel marketing-form"><h3>Create campaign</h3><div className="form-grid"><label className="label">Campaign name<input className="input" value={campaign.name} onChange={event => setCampaign({ ...campaign, name: event.target.value })} /></label><label className="label">Objective<input className="input" value={campaign.objective} onChange={event => setCampaign({ ...campaign, objective: event.target.value })} /></label><label className="label">Start<input className="input" type="date" value={campaign.start_at} onChange={event => setCampaign({ ...campaign, start_at: event.target.value })} /></label><label className="label">End<input className="input" type="date" value={campaign.end_at} onChange={event => setCampaign({ ...campaign, end_at: event.target.value })} /></label></div><button className="btn" disabled={busy || !campaign.name.trim()} onClick={createCampaign}>Create campaign</button></div> : null}
    {showConcept ? <div ref={conceptFormRef} className="panel marketing-form" style={{ scrollMarginTop: 24 }}><h3>Create multi-platform concept</h3><div className="form-grid"><label className="label">Campaign<select className="select" value={concept.campaign_id} onChange={event => setConcept({ ...concept, campaign_id: event.target.value })}><option value="">Select campaign</option>{campaigns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="label">Content pillar<input className="input" value={concept.content_pillar} onChange={event => setConcept({ ...concept, content_pillar: event.target.value })} /></label><label className="label">Concept title<input name="concept-title" className="input" value={concept.title} onChange={event => setConcept({ ...concept, title: event.target.value })} /></label><label className="label">Shared format<select className="select" value={concept.format} onChange={event => setConcept({ ...concept, format: event.target.value })}>{formats.map(value => <option key={value}>{value}</option>)}</select></label><label className="label">Publishing date<input className="input" type="date" value={concept.scheduled_at} onChange={event => setConcept({ ...concept, scheduled_at: event.target.value })} /></label><label className="label">Creative asset<input className="input" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,video/mp4,video/quicktime" onChange={(event: ChangeEvent<HTMLInputElement>) => setCreativeFile(event.target.files?.[0] || null)} /><span className="muted">PNG, JPEG and WebP can be opened directly in Annotation Studio.</span></label></div><fieldset className="platform-picker"><legend>Platforms</legend>{platforms.map(platform => <label key={platform}><input type="checkbox" checked={selectedPlatforms.includes(platform)} onChange={event => setSelectedPlatforms(values => event.target.checked ? [...values, platform] : values.filter(value => value !== platform))} />{platform}</label>)}</fieldset><label className="label">Brief<textarea className="textarea" value={concept.brief} onChange={event => setConcept({ ...concept, brief: event.target.value })} /></label><label className="label">Shared caption<textarea className="textarea" value={concept.shared_caption} onChange={event => setConcept({ ...concept, shared_caption: event.target.value })} /></label><div className="grid cols-2"><h4 style={{ gridColumn: '1 / -1' }}>Platform overrides</h4>{selectedPlatforms.map(platform => { const override = platformOverrides[platform] || { format: '', scheduled_at: '', caption: '' }; return <section className="card" key={platform}><strong>{platform}</strong><label className="label">Format<select className="select" value={override.format} onChange={event => setPlatformOverrides(values => ({ ...values, [platform]: { ...override, format: event.target.value } }))}><option value="">Use shared format</option>{formats.map(value => <option key={value}>{value}</option>)}</select></label><label className="label">Date<input className="input" type="date" value={override.scheduled_at} onChange={event => setPlatformOverrides(values => ({ ...values, [platform]: { ...override, scheduled_at: event.target.value } }))} /></label><label className="label">Caption<textarea className="textarea" placeholder="Use shared caption" value={override.caption} onChange={event => setPlatformOverrides(values => ({ ...values, [platform]: { ...override, caption: event.target.value } }))} /></label></section>; })}</div><div className="toolbar"><button className="btn" disabled={busy || !concept.campaign_id || !concept.title.trim() || !selectedPlatforms.length} onClick={createConcept}>Create {selectedPlatforms.length} deliverable{selectedPlatforms.length === 1 ? '' : 's'}</button><button className="btn secondary" type="button" onClick={() => setShowConcept(false)}>Cancel</button></div></div> : null}
    <div className="calendar-toolbar"><Tabs values={['Month', 'Week', 'List']} active={view} onChange={setView} label="Calendar view" /><div className="toolbar"><button className="btn small secondary" onClick={() => move(-1)}>Previous</button><button className="btn small secondary" onClick={() => setAnchor(new Date())}>Today</button><button className="btn small secondary" onClick={() => move(1)}>Next</button></div></div>
    <div><h3>{new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(anchor)}</h3><span className="muted">Publishing times use Philippine Time (UTC+8). Select a date to start a content concept.</span></div>
    {view !== 'List' ? <div className={`social-calendar ${view.toLowerCase()}`}>{calendarDays.map(day => { const rows = scheduled.filter(item => dayKey(item.scheduled_at) === dayKey(day)); return <div className={`calendar-day ${day.getMonth() !== anchor.getMonth() && view === 'Month' ? 'outside' : ''}`} key={day.toISOString()}><button type="button" className="calendar-date-button" disabled={!canManage || !campaigns.length} aria-label={`Plan content on ${dayAccessibleLabel(day)}`} onClick={() => openConceptForm(dayKey(day))}>{dayLabel(day)}</button>{rows.map(item => <button type="button" key={item.id} onClick={() => setSelected(concepts.find(concept => concept.id === item.concept_id) || null)}><b>{item.concept_title}</b><small>{item.platform} · {item.status}</small></button>)}</div>; })}</div> : <div className="grid">{scheduled.map(item => <button type="button" className="card" key={item.id} onClick={() => setSelected(concepts.find(concept => concept.id === item.concept_id) || null)}><strong>{item.concept_title}</strong><div className="card-line"><Pill value={item.platform} /><Pill value={item.status} /><Pill value={item.campaign_name} /></div><span className="muted">{new Date(item.scheduled_at).toLocaleString('en-PH', { timeZone: propertyTimeZone })} PHT</span></button>)}</div>}
    {unscheduled.length ? <div className="unscheduled-tray"><h3>Unscheduled</h3><div className="card-line">{unscheduled.map(item => <button type="button" className="card" key={item.id} onClick={() => setSelected(concepts.find(concept => concept.id === item.concept_id) || null)}><b>{item.concept_title}</b><small>{item.platform}</small></button>)}</div></div> : null}
    <Drawer item={selected} title="Content concept" onClose={() => setSelected(null)}>{selected ? <div className="grid"><section className="panel"><p className="eyebrow">{selected.content_pillar}</p><h2>{selected.title}</h2><p className="muted">{selected.brief || 'No shared brief yet.'}</p></section><ConceptCreativeAssets conceptId={Number(selected.id)} canManage={canManage} />{(selected.deliverables || []).map((deliverable: Entity) => <section className="panel" key={deliverable.id}><div className="card-line"><Pill value={deliverable.platform} /><Pill value={deliverable.format} /><Pill value={deliverable.status} /></div><label className="label">Publishing date<input className="input" type="date" disabled={busy || deliverable.status === 'Published'} value={deliverable.scheduled_at ? dayKey(deliverable.scheduled_at) : ''} onChange={event => void reschedule(deliverable, event.target.value)} /></label>{(deliverable.allowed_actions || []).includes('schedule') && !deliverable.scheduled_at ? <p className="muted">Set a publishing date before scheduling.</p> : null}{(deliverable.allowed_actions || []).some((action: string) => ['request-revision', 'return-draft', 'reopen'].includes(action)) ? <label className="label">Action reason<textarea className="textarea" value={note} onChange={event => setNote(event.target.value)} /></label> : null}{(deliverable.allowed_actions || []).includes('publish') ? <label className="label">Final publication URL<input className="input" type="url" value={finalUrl} onChange={event => setFinalUrl(event.target.value)} /></label> : null}<div className="toolbar">{(deliverable.allowed_actions || []).map((action: string) => <button className="btn small secondary" key={action} disabled={busy || (['request-revision', 'return-draft', 'reopen'].includes(action) && !note.trim()) || (action === 'schedule' && !deliverable.scheduled_at) || (action === 'publish' && !finalUrl.trim())} onClick={() => void transition(deliverable, action)}>{actionLabels[action] || action}</button>)}</div></section>)}</div> : null}</Drawer>
  </section>;
}
