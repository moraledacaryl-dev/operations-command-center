'use client';

import Link from 'next/link';
import { ChangeEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE, api, Entity } from '@/lib/api';
import { marketingAssetsApi } from '@/lib/marketing-assets-api';
import styles from './editor.module.css';

type Tool = 'pen' | 'highlighter' | 'eraser' | 'text';
const swatches = ['#ef4444', '#f59e0b', '#22c55e', '#2563eb', '#111827'];

function safeFilename(value?: string) {
  const base = String(value || 'annotated-creative').replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${base || 'annotated-creative'}-annotated.png`;
}
function imageMime(filename: string, mimeType: string) {
  if (/^image\/(png|jpeg|webp)$/i.test(mimeType)) return mimeType.toLowerCase();
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.jpe?g$/i.test(filename)) return 'image/jpeg';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  return '';
}

export default function MarketingAnnotationStudio() {
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const annotationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const requestedVersionRef = useRef('');
  const openVersionRef = useRef<(version: Entity, isCanonical: boolean, currentAssetId: string, currentPostId: string) => Promise<void>>(async () => {});
  const [posts, setPosts] = useState<Entity[]>([]);
  const [postId, setPostId] = useState('');
  const [conceptId, setConceptId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [canonicalConcept, setCanonicalConcept] = useState<Entity | null>(null);
  const [versions, setVersions] = useState<Entity[]>([]);
  const [versionId, setVersionId] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(swatches[0]);
  const [size, setSize] = useState(6);
  const [zoom, setZoom] = useState(1);
  const [drawing, setDrawing] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [textOpen, setTextOpen] = useState(false);
  const [textValue, setTextValue] = useState('');
  const [textPoint, setTextPoint] = useState({ x: 0, y: 0 });

  const canonicalMode = Boolean(conceptId && assetId);
  const selectedPost = useMemo(() => posts.find(item => String(item.id) === postId), [postId, posts]);
  const selectedVersion = useMemo(() => versions.find(item => String(item.id) === versionId), [versionId, versions]);
  const imageVersions = useMemo(() => versions.filter(row => Boolean(row.annotatable) || /\.(png|jpe?g|webp)$/i.test(String(row.filename || row.file_url || ''))), [versions]);
  const sourceTitle = canonicalConcept?.title || selectedPost?.title || 'creative';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedConcept = params.get('conceptId') || '';
    const requestedAsset = params.get('assetId') || '';
    const requestedPost = params.get('postId') || '';
    requestedVersionRef.current = params.get('versionId') || '';
    if (requestedConcept && requestedAsset) {
      setConceptId(requestedConcept); setAssetId(requestedAsset);
      api.marketingConcepts().then(rows => setCanonicalConcept(rows.find(row => String(row.id) === requestedConcept) || null)).catch(err => setError(err.message || 'Content concept could not be loaded.'));
      return;
    }
    if (requestedPost) setPostId(requestedPost);
    api.listAll('posts', { active: true }).then(setPosts).catch(err => setError(err.message || 'Marketing posts could not be loaded.'));
  }, []);

  useEffect(() => {
    setLoaded(false); setHistory([]); setFuture([]); setSaved('');
    if (canonicalMode) {
      marketingAssetsApi.versions(Number(assetId)).then(rows => {
        setVersions(rows);
        const requested = rows.find(row => String(row.id) === requestedVersionRef.current && (row.annotatable || /\.(png|jpe?g|webp)$/i.test(String(row.filename || ''))));
        const image = requested || rows.find(row => row.annotatable || /\.(png|jpe?g|webp)$/i.test(String(row.filename || '')));
        setVersionId(image ? String(image.id) : '');
        requestedVersionRef.current = '';
        if (requested && image) void openVersionRef.current(image, true, assetId, '');
      }).catch(err => setError(err.message || 'Creative versions could not be loaded.'));
      return;
    }
    if (!postId) { setVersions([]); setVersionId(''); return; }
    api.versions(Number(postId)).then(rows => {
      setVersions(rows);
      const requested = rows.find(row => String(row.id) === requestedVersionRef.current && /\.(png|jpe?g|webp)$/i.test(String(row.filename || row.file_url || '')));
      const image = requested || rows.find(row => /\.(png|jpe?g|webp)$/i.test(String(row.filename || row.file_url || '')));
      setVersionId(image ? String(image.id) : '');
      requestedVersionRef.current = '';
      if (requested && image) void openVersionRef.current(image, false, '', postId);
    }).catch(err => setError(err.message || 'Creative versions could not be loaded.'));
  }, [assetId, canonicalMode, postId]);

  function currentAnnotation() { return annotationCanvasRef.current?.toDataURL('image/png') || ''; }
  function checkpoint() { const current = currentAnnotation(); if (!current) return; setHistory(items => [...items.slice(-24), current]); setFuture([]); setSaved(''); }
  function restoreAnnotation(dataUrl: string) { const canvas = annotationCanvasRef.current; if (!canvas) return; const image = new Image(); image.onload = () => { const ctx = canvas.getContext('2d'); ctx?.clearRect(0, 0, canvas.width, canvas.height); ctx?.drawImage(image, 0, 0, canvas.width, canvas.height); }; image.src = dataUrl; }
  function loadBlob(blob: Blob, filename: string) {
    const mimeType = imageMime(filename, blob.type); if (!mimeType) { setError('Use a PNG, JPEG, or WebP image.'); return; }
    const sourceBlob = blob.type.toLowerCase() === mimeType ? blob : new Blob([blob], { type: mimeType }); const url = URL.createObjectURL(sourceBlob); const image = new Image();
    image.onload = () => { const base = baseCanvasRef.current; const annotation = annotationCanvasRef.current; if (!base || !annotation) return; const max = 2400; const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight)); const width = Math.max(1, Math.round(image.naturalWidth * scale)); const height = Math.max(1, Math.round(image.naturalHeight * scale)); base.width = annotation.width = width; base.height = annotation.height = height; const baseCtx = base.getContext('2d'); const annotationCtx = annotation.getContext('2d'); if (!baseCtx || !annotationCtx) return; baseCtx.clearRect(0, 0, width, height); baseCtx.drawImage(image, 0, 0, width, height); annotationCtx.clearRect(0, 0, width, height); URL.revokeObjectURL(url); setLoaded(true); setSourceName(filename); setZoom(1); setHistory([]); setFuture([]); setSaved(''); setError(''); };
    image.onerror = () => { URL.revokeObjectURL(url); setError('This image could not be opened.'); }; image.src = url;
  }
  async function openVersion(version: Entity, isCanonical: boolean, currentAssetId: string, currentPostId: string) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const path = isCanonical
        ? marketingAssetsApi.downloadUrl(Number(currentAssetId), Number(version.id))
        : `${API_BASE}/posts/${currentPostId}/versions/${version.id}/download`;
      const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) throw new Error('Creative file could not be downloaded.');
      loadBlob(await res.blob(), String(version.filename || sourceTitle));
    } catch (err: any) {
      setError(err.message || 'Creative file could not be loaded.');
    } finally {
      setBusy(false);
    }
  }
  openVersionRef.current = openVersion;
  async function loadSelectedVersion() {
    if (!selectedVersion || busy || (!canonicalMode && !postId)) return;
    await openVersion(selectedVersion, canonicalMode, assetId, postId);
  }
  function localUpload(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (file) loadBlob(file, file.name); event.target.value = ''; }
  function point(event: ReactPointerEvent<HTMLCanvasElement>) { const rect = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (event.currentTarget.width / rect.width), y: (event.clientY - rect.top) * (event.currentTarget.height / rect.height) }; }
  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) { if (!loaded) return; const p = point(event); if (tool === 'text') { setTextPoint(p); setTextValue(''); setTextOpen(true); return; } checkpoint(); setDrawing(true); event.currentTarget.setPointerCapture(event.pointerId); const ctx = event.currentTarget.getContext('2d'); if (ctx) { ctx.beginPath(); ctx.moveTo(p.x, p.y); } }
  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) { if (!drawing || !loaded) return; const ctx = event.currentTarget.getContext('2d'); if (!ctx) return; const p = point(event); const scale = event.currentTarget.width / Math.max(1, event.currentTarget.getBoundingClientRect().width); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; if (tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 1; ctx.strokeStyle = '#000'; ctx.lineWidth = size * 2 * scale; } else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = color; ctx.globalAlpha = tool === 'highlighter' ? .28 : 1; ctx.lineWidth = (tool === 'highlighter' ? size * 3 : size) * scale; } ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>) { if (!drawing) return; setDrawing(false); try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {} }
  function addText() { const canvas = annotationCanvasRef.current; const value = textValue.trim(); if (!canvas || !value) { setTextOpen(false); return; } checkpoint(); const ctx = canvas.getContext('2d'); if (!ctx) return; const scale = canvas.width / Math.max(1, canvas.getBoundingClientRect().width); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.font = `700 ${Math.max(16, size * 4) * scale}px system-ui, -apple-system, sans-serif`; ctx.textBaseline = 'top'; ctx.fillText(value, textPoint.x, textPoint.y); setTextOpen(false); setSaved(''); }
  function undo() { const previous = history[history.length - 1]; if (!previous) return; const current = currentAnnotation(); if (current) setFuture(items => [...items, current]); setHistory(items => items.slice(0, -1)); restoreAnnotation(previous); setSaved(''); }
  function redo() { const next = future[future.length - 1]; if (!next) return; const current = currentAnnotation(); if (current) setHistory(items => [...items, current]); setFuture(items => items.slice(0, -1)); restoreAnnotation(next); setSaved(''); }
  function compositeCanvas() { const base = baseCanvasRef.current; const annotation = annotationCanvasRef.current; if (!base || !annotation || !loaded) return null; const output = document.createElement('canvas'); output.width = base.width; output.height = base.height; const ctx = output.getContext('2d'); if (!ctx) return null; ctx.drawImage(base, 0, 0); ctx.drawImage(annotation, 0, 0); return output; }
  function exportImage() { const canvas = compositeCanvas(); if (!canvas) return; const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = safeFilename(sourceName || sourceTitle); link.click(); }
  async function saveVersion() {
    const canvas = compositeCanvas(); if (!canvas || busy || (!canonicalMode && !postId)) return; setBusy(true); setError(''); setSaved('');
    try { const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Canvas export failed.')), 'image/png')); const filename = safeFilename(sourceName || sourceTitle); const file = new File([blob], filename, { type: 'image/png' }); let created: Entity; if (canonicalMode) { created = await marketingAssetsApi.addVersion(Number(assetId), file, 'Annotated in Marketing creative studio'); setVersions(await marketingAssetsApi.versions(Number(assetId))); } else { const form = new FormData(); form.append('filename', filename); form.append('file_url', ''); form.append('note', 'Annotated in Marketing creative studio'); form.append('caption_snapshot', String(selectedPost?.caption || '')); form.append('file', file); created = await api.addVersion(Number(postId), form); setVersions(await api.versions(Number(postId))); } setVersionId(String(created.id)); setSaved('Saved as a new creative version. Original preserved.'); } catch (err: any) { setError(err.message || 'Annotated version could not be saved.'); } finally { setBusy(false); }
  }

  useEffect(() => { function onKeyDown(event: KeyboardEvent) { const target = event.target as HTMLElement | null; if (target && ['INPUT','TEXTAREA','SELECT'].includes(target.tagName)) return; const key = event.key.toLowerCase(); if ((event.metaKey || event.ctrlKey) && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; } if (key === 'p') setTool('pen'); if (key === 'h') setTool('highlighter'); if (key === 'e') setTool('eraser'); if (key === 't') setTool('text'); } window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown); });

  return <main className={styles.page}>
    <header className={styles.hero}><div className={styles.heroCopy}><div className={styles.eyebrow}>Marketing · Creative review</div><h1>Annotation studio</h1><p>Mark up creative assets without touching the original. Draw, highlight, erase, add text, then save the result as a new version for review.</p></div><Link className={styles.back} href="/posts">← Back to Marketing</Link></header>
    {error ? <div className="pill urgent" role="alert">{error}</div> : null}
    <div className={styles.shell}>
      <aside className={styles.rail} aria-label="Annotation controls">
        <section className={styles.section}><div className={styles.sectionTitle}>Creative source</div>{canonicalMode ? <div className={styles.saveState}>{canonicalConcept?.title || `Content concept #${conceptId}`}</div> : <select aria-label="Marketing post" className={styles.select} value={postId} onChange={e => setPostId(e.target.value)}><option value="">Choose marketing post</option>{posts.map(post => <option key={post.id} value={post.id}>{post.title}</option>)}</select>}<select aria-label="Creative image version" className={styles.select} value={versionId} onChange={e => setVersionId(e.target.value)} disabled={(!canonicalMode && !postId) || !imageVersions.length}><option value="">{!imageVersions.length ? 'No image versions yet' : 'Choose image version'}</option>{imageVersions.map(version => <option key={version.id} value={version.id}>v{version.version_no || version.id} · {version.filename || 'Image asset'}</option>)}</select><button className={styles.secondary} onClick={loadSelectedVersion} disabled={!versionId || busy}>{busy ? 'Opening…' : 'Open version'}</button><label className={styles.upload}>Upload image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={localUpload} /></label></section>
        <section className={styles.section}><div className={styles.sectionTitle}>Tools</div><div className={styles.toolGrid}>{(['pen','highlighter','eraser','text'] as Tool[]).map(value => <button key={value} className={`${styles.tool} ${tool === value ? styles.toolActive : ''}`} onClick={() => setTool(value)} aria-pressed={tool === value}>{value === 'pen' ? '✎ Pen' : value === 'highlighter' ? '▰ Highlight' : value === 'eraser' ? '⌫ Eraser' : 'T Text'}</button>)}</div><span className={styles.saveState}>Shortcuts: P · H · E · T</span></section>
        <section className={styles.section}><div className={styles.sectionTitle}>Color</div><div className={styles.swatches}>{swatches.map(value => <button key={value} title={value} aria-label={`Use ${value}`} className={`${styles.swatch} ${color === value ? styles.swatchActive : ''}`} style={{ background: value }} onClick={() => setColor(value)} />)}</div><input aria-label="Custom annotation color" type="color" className={styles.colorInput} value={color} onChange={e => setColor(e.target.value)} /></section>
        <section className={styles.section}><div className={styles.sectionTitle}>Stroke · {size}px</div><input aria-label="Annotation stroke size" className={styles.range} type="range" min="2" max="24" value={size} onChange={e => setSize(Number(e.target.value))} /></section>
        <section className={styles.section}><div className={styles.sectionTitle}>History</div><div className={styles.miniRow}><button className={styles.secondary} onClick={undo} disabled={!history.length}>↶ Undo</button><button className={styles.secondary} onClick={redo} disabled={!future.length}>↷ Redo</button></div><span className={styles.saveState}>⌘/Ctrl Z · Shift ⌘/Ctrl Z</span></section>
      </aside>
      <section className={styles.workspace}>
        <div className={styles.topbar}><div className={styles.status}><span className={styles.dot} />{loaded ? sourceName || 'Creative loaded' : 'No creative loaded'}</div><div className={styles.topActions}><button className={styles.secondary} disabled={!loaded} onClick={() => setZoom(value => Math.max(.35, value - .15))}>−</button><button className={styles.secondary} disabled={!loaded} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button className={styles.secondary} disabled={!loaded} onClick={() => setZoom(value => Math.min(2.5, value + .15))}>+</button></div></div>
        <div className={styles.stageWrap} tabIndex={0} role="region" aria-label="Creative annotation canvas"><div className={styles.canvasFrame} style={{ transform: `scale(${zoom})`, visibility: loaded ? 'visible' : 'hidden', position: loaded ? 'relative' : 'absolute' }}><canvas ref={baseCanvasRef} className={styles.baseCanvas} /><canvas ref={annotationCanvasRef} className={styles.canvas} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} /></div>{!loaded ? <div className={styles.empty}><strong>Open a creative to start annotating</strong><span>Select an existing image version, or upload a PNG, JPEG, or WebP from your computer.</span><label className={styles.upload}>Choose image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={localUpload} /></label></div> : null}{textOpen ? <div className={styles.textDialog} role="dialog" aria-modal="true" aria-label="Add text annotation"><div className={styles.textCard}><h3>Add text</h3><input autoFocus className={styles.input} value={textValue} onChange={e => setTextValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addText(); if (e.key === 'Escape') setTextOpen(false); }} placeholder="Type annotation…" /><div className={styles.miniRow}><button className={styles.secondary} onClick={() => setTextOpen(false)}>Cancel</button><button className={styles.primary} onClick={addText} disabled={!textValue.trim()}>Add text</button></div></div></div> : null}</div>
        <div className={styles.footer}><div><div className={styles.footerHint}>Your original creative is locked underneath. The eraser removes annotations only.</div>{saved ? <div className={styles.saveState}>{saved}</div> : null}</div><div className={styles.topActions}><button className={styles.secondary} disabled={!loaded} onClick={exportImage}>Export PNG</button><button className={styles.primary} disabled={!loaded || (!canonicalMode && !postId) || busy} onClick={saveVersion}>{busy ? 'Saving…' : 'Save annotated version'}</button></div></div>
      </section>
    </div>
  </main>;
}