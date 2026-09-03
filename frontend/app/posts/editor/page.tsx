'use client';

import Link from 'next/link';
import { ChangeEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE, api, Entity } from '@/lib/api';
import styles from './editor.module.css';

type Tool = 'pen' | 'highlighter' | 'eraser' | 'text';
const swatches = ['#ef4444', '#f59e0b', '#22c55e', '#2563eb', '#111827'];

function safeFilename(value?: string) {
  const base = String(value || 'annotated-creative').replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${base || 'annotated-creative'}-annotated.png`;
}

export default function MarketingAnnotationStudio() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [posts, setPosts] = useState<Entity[]>([]);
  const [postId, setPostId] = useState('');
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

  const selectedPost = useMemo(() => posts.find(item => String(item.id) === postId), [postId, posts]);
  const selectedVersion = useMemo(() => versions.find(item => String(item.id) === versionId), [versionId, versions]);

  useEffect(() => {
    api.listAll('posts', { active: true }).then(setPosts).catch(err => setError(err.message || 'Marketing posts could not be loaded.'));
  }, []);

  useEffect(() => {
    if (!postId) { setVersions([]); setVersionId(''); return; }
    api.versions(Number(postId)).then(rows => {
      setVersions(rows);
      const image = rows.find(row => /\.(png|jpe?g|webp)$/i.test(String(row.filename || row.file_url || '')));
      setVersionId(image ? String(image.id) : '');
    }).catch(err => setError(err.message || 'Creative versions could not be loaded.'));
  }, [postId]);

  function currentSnapshot() { return canvasRef.current?.toDataURL('image/png') || ''; }
  function checkpoint() {
    const current = currentSnapshot();
    if (!current) return;
    setHistory(items => [...items.slice(-24), current]);
    setFuture([]);
    setSaved('');
  }
  function restore(dataUrl: string) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const image = new Image();
    image.onload = () => {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      ctx?.drawImage(image, 0, 0);
      setLoaded(true);
    };
    image.src = dataUrl;
  }

  function loadBlob(blob: Blob, filename: string) {
    if (!/^image\/(png|jpeg|webp)$/i.test(blob.type)) { setError('Use a PNG, JPEG, or WebP image.'); return; }
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const max = 2400;
      const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      setLoaded(true); setSourceName(filename); setZoom(1); setHistory([]); setFuture([]); setSaved(''); setError('');
    };
    image.onerror = () => { URL.revokeObjectURL(url); setError('This image could not be opened.'); };
    image.src = url;
  }

  async function loadSelectedVersion() {
    if (!postId || !versionId || busy) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/posts/${postId}/versions/${versionId}/download`, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) throw new Error('Creative file could not be downloaded.');
      loadBlob(await res.blob(), String(selectedVersion?.filename || selectedPost?.title || 'creative'));
    } catch (err: any) { setError(err.message || 'Creative file could not be loaded.'); }
    finally { setBusy(false); }
  }

  function localUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) loadBlob(file, file.name);
    event.target.value = '';
  }

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (event.currentTarget.width / rect.width), y: (event.clientY - rect.top) * (event.currentTarget.height / rect.height) };
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!loaded) return;
    const p = point(event);
    if (tool === 'text') { setTextPoint(p); setTextValue(''); setTextOpen(true); return; }
    checkpoint(); setDrawing(true); event.currentTarget.setPointerCapture(event.pointerId);
    const ctx = event.currentTarget.getContext('2d');
    if (ctx) { ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing || !loaded) return;
    const ctx = event.currentTarget.getContext('2d');
    if (!ctx) return;
    const p = point(event);
    const scale = event.currentTarget.width / Math.max(1, event.currentTarget.getBoundingClientRect().width);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = 1; ctx.strokeStyle = '#000'; ctx.lineWidth = size * 2 * scale;
    } else {
      ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = color; ctx.globalAlpha = tool === 'highlighter' ? .28 : 1; ctx.lineWidth = (tool === 'highlighter' ? size * 3 : size) * scale;
    }
    ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    setDrawing(false);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  }

  function addText() {
    const canvas = canvasRef.current;
    const value = textValue.trim();
    if (!canvas || !value) { setTextOpen(false); return; }
    checkpoint();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.fillStyle = color;
    ctx.font = `700 ${Math.max(16, size * 4) * scale}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'top'; ctx.fillText(value, textPoint.x, textPoint.y);
    setTextOpen(false); setSaved('');
  }

  function undo() {
    const previous = history[history.length - 1];
    if (!previous) return;
    const current = currentSnapshot();
    if (current) setFuture(items => [...items, current]);
    setHistory(items => items.slice(0, -1)); restore(previous); setSaved('');
  }
  function redo() {
    const next = future[future.length - 1];
    if (!next) return;
    const current = currentSnapshot();
    if (current) setHistory(items => [...items, current]);
    setFuture(items => items.slice(0, -1)); restore(next); setSaved('');
  }

  function exportImage() {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = safeFilename(sourceName || selectedPost?.title); link.click();
  }

  async function saveVersion() {
    const canvas = canvasRef.current;
    if (!canvas || !loaded || !postId || busy) return;
    setBusy(true); setError(''); setSaved('');
    try {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Canvas export failed.')), 'image/png'));
      const filename = safeFilename(sourceName || selectedPost?.title);
      const form = new FormData();
      form.append('filename', filename); form.append('file_url', ''); form.append('note', 'Annotated in Marketing creative studio'); form.append('caption_snapshot', String(selectedPost?.caption || '')); form.append('file', new File([blob], filename, { type: 'image/png' }));
      const created = await api.addVersion(Number(postId), form);
      setVersions(await api.versions(Number(postId))); setVersionId(String(created.id)); setSaved('Saved as a new creative version. Original preserved.');
    } catch (err: any) { setError(err.message || 'Annotated version could not be saved.'); }
    finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <header className={styles.hero}><div className={styles.heroCopy}><div className={styles.eyebrow}>Marketing · Creative review</div><h1>Annotation studio</h1><p>Mark up creative assets without touching the original. Draw, highlight, erase, add text, then save the result as a new version for review.</p></div><Link className={styles.back} href="/posts">← Back to Marketing</Link></header>
    {error ? <div className="pill urgent" role="alert">{error}</div> : null}
    <div className={styles.shell}>
      <aside className={styles.rail} aria-label="Annotation controls">
        <section className={styles.section}><div className={styles.sectionTitle}>Creative source</div><select className={styles.select} value={postId} onChange={e => setPostId(e.target.value)}><option value="">Choose marketing post</option>{posts.map(post => <option key={post.id} value={post.id}>{post.title}</option>)}</select><select className={styles.select} value={versionId} onChange={e => setVersionId(e.target.value)} disabled={!postId}><option value="">Choose image version</option>{versions.map(version => <option key={version.id} value={version.id}>v{version.version_no || version.id} · {version.filename || 'Asset'}</option>)}</select><button className={styles.secondary} onClick={loadSelectedVersion} disabled={!versionId || busy}>{busy ? 'Opening…' : 'Open version'}</button><label className={styles.upload}>Upload image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={localUpload} /></label></section>
        <section className={styles.section}><div className={styles.sectionTitle}>Tools</div><div className={styles.toolGrid}>{(['pen','highlighter','eraser','text'] as Tool[]).map(value => <button key={value} className={`${styles.tool} ${tool === value ? styles.toolActive : ''}`} onClick={() => setTool(value)} aria-pressed={tool === value}>{value === 'pen' ? '✎ Pen' : value === 'highlighter' ? '▰ Highlight' : value === 'eraser' ? '⌫ Eraser' : 'T Text'}</button>)}</div></section>
        <section className={styles.section}><div className={styles.sectionTitle}>Color</div><div className={styles.swatches}>{swatches.map(value => <button key={value} title={value} aria-label={`Use ${value}`} className={`${styles.swatch} ${color === value ? styles.swatchActive : ''}`} style={{ background: value }} onClick={() => setColor(value)} />)}</div></section>
        <section className={styles.section}><div className={styles.sectionTitle}>Stroke · {size}px</div><input className={styles.range} type="range" min="2" max="24" value={size} onChange={e => setSize(Number(e.target.value))} /></section>
        <section className={styles.section}><div className={styles.sectionTitle}>History</div><div className={styles.miniRow}><button className={styles.secondary} onClick={undo} disabled={!history.length}>↶ Undo</button><button className={styles.secondary} onClick={redo} disabled={!future.length}>↷ Redo</button></div></section>
      </aside>
      <section className={styles.workspace}>
        <div className={styles.topbar}><div className={styles.status}><span className={styles.dot} />{loaded ? sourceName || 'Creative loaded' : 'No creative loaded'}</div><div className={styles.topActions}><button className={styles.secondary} disabled={!loaded} onClick={() => setZoom(value => Math.max(.35, value - .15))}>−</button><button className={styles.secondary} disabled={!loaded} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button className={styles.secondary} disabled={!loaded} onClick={() => setZoom(value => Math.min(2.5, value + .15))}>+</button></div></div>
        <div className={styles.stageWrap}>
          <div className={styles.canvasFrame} style={{ transform: `scale(${zoom})`, visibility: loaded ? 'visible' : 'hidden', position: loaded ? 'relative' : 'absolute' }}><canvas ref={canvasRef} className={styles.canvas} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} /></div>
          {!loaded ? <div className={styles.empty}><strong>Open a creative to start annotating</strong><span>Select an existing image version from a marketing post, or upload a PNG, JPEG, or WebP from your computer.</span><label className={styles.upload}>Choose image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={localUpload} /></label></div> : null}
          {textOpen ? <div className={styles.textDialog} role="dialog" aria-modal="true" aria-label="Add text annotation"><div className={styles.textCard}><h3>Add text</h3><input autoFocus className={styles.input} value={textValue} onChange={e => setTextValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addText(); if (e.key === 'Escape') setTextOpen(false); }} placeholder="Type annotation…" /><div className={styles.miniRow}><button className={styles.secondary} onClick={() => setTextOpen(false)}>Cancel</button><button className={styles.primary} onClick={addText} disabled={!textValue.trim()}>Add text</button></div></div></div> : null}
        </div>
        <div className={styles.footer}><div><div className={styles.footerHint}>Tip: use <span className={styles.kbd}>Highlighter</span> for review notes and <span className={styles.kbd}>Eraser</span> to remove only your markup.</div>{saved ? <div className={styles.saveState}>{saved}</div> : null}</div><div className={styles.topActions}><button className={styles.secondary} disabled={!loaded} onClick={exportImage}>Export PNG</button><button className={styles.primary} disabled={!loaded || !postId || busy} onClick={saveVersion}>{busy ? 'Saving…' : 'Save annotated version'}</button></div></div>
      </section>
    </div>
  </main>;
}
