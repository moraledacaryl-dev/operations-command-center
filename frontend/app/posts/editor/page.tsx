'use client';

import Link from 'next/link';
import { ChangeEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE, api, Entity } from '@/lib/api';
import { marketingAssetsApi } from '@/lib/marketing-assets-api';
import styles from './editor.module.css';

type Tool = 'select' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'arrow' | 'rect' | 'ellipse' | 'pan';
type Point = { x: number; y: number };
type BaseObject = { id: string; color: string; opacity: number };
type TextObject = BaseObject & { type: 'text'; x: number; y: number; text: string; fontSize: number };
type ImageObject = BaseObject & { type: 'image'; x: number; y: number; width: number; height: number; src: string; name: string };
type ShapeObject = BaseObject & { type: 'rect' | 'ellipse' | 'arrow'; x: number; y: number; width: number; height: number; strokeWidth: number };
type StrokeObject = BaseObject & { type: 'pen' | 'highlighter'; points: Point[]; strokeWidth: number };
type AnnotationObject = TextObject | ImageObject | ShapeObject | StrokeObject;
type Interaction = { id: string; mode: 'move' | 'resize'; startClientX: number; startClientY: number; original: AnnotationObject } | null;

const swatches = ['#ef4444', '#f59e0b', '#22c55e', '#2563eb', '#111827'];
const toolLabels: Record<Tool, string> = { select: '↖ Select', pen: '✎ Pen', highlighter: '▰ Highlight', eraser: '⌫ Eraser', text: 'T Text', arrow: '→ Arrow', rect: '□ Box', ellipse: '○ Circle', pan: '✥ Pan' };

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
function objectId() { return `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function cloneObjects(items: AnnotationObject[]) { return items.map(item => { if (item.type === 'pen' || item.type === 'highlighter') return { ...item, points: item.points.map(point => ({ ...point })) }; return { ...item }; }) as AnnotationObject[]; }
function textBox(item: TextObject) { return { x: item.x, y: item.y, width: Math.max(48, item.text.length * item.fontSize * .62), height: item.fontSize * 1.25 }; }
function bounds(item: AnnotationObject) {
  if (item.type === 'text') return textBox(item);
  if (item.type === 'image' || item.type === 'rect' || item.type === 'ellipse' || item.type === 'arrow') return { x: item.x, y: item.y, width: item.width, height: item.height };
  const stroke = item as StrokeObject; const xs = stroke.points.map(point => point.x); const ys = stroke.points.map(point => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) };
}
function normalizeBox(x: number, y: number, width: number, height: number) {
  return { x: width < 0 ? x + width : x, y: height < 0 ? y + height : y, width: Math.abs(width), height: Math.abs(height) };
}

export default function MarketingAnnotationStudio() {
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const annotationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const requestedVersionRef = useRef('');
  const openVersionRef = useRef<(version: Entity, isCanonical: boolean, currentAssetId: string, currentPostId: string) => Promise<void>>(async () => {});
  const fitCanvasRef = useRef<() => void>(() => {});
  const [posts, setPosts] = useState<Entity[]>([]);
  const [postId, setPostId] = useState('');
  const [conceptId, setConceptId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [canonicalConcept, setCanonicalConcept] = useState<Entity | null>(null);
  const [versions, setVersions] = useState<Entity[]>([]);
  const [versionId, setVersionId] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState(swatches[0]);
  const [size, setSize] = useState(6);
  const [textSize, setTextSize] = useState(48);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [objects, setObjects] = useState<AnnotationObject[]>([]);
  const [history, setHistory] = useState<AnnotationObject[][]>([]);
  const [future, setFuture] = useState<AnnotationObject[][]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [drawingId, setDrawingId] = useState('');
  const [shapeStart, setShapeStart] = useState<Point | null>(null);
  const [interaction, setInteraction] = useState<Interaction>(null);
  const [panning, setPanning] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [textOpen, setTextOpen] = useState(false);
  const [textEditingId, setTextEditingId] = useState('');
  const [textValue, setTextValue] = useState('');
  const [textPoint, setTextPoint] = useState({ x: 0, y: 0 });

  const canonicalMode = Boolean(conceptId && assetId);
  const selectedPost = useMemo(() => posts.find(item => String(item.id) === postId), [postId, posts]);
  const selectedVersion = useMemo(() => versions.find(item => String(item.id) === versionId), [versionId, versions]);
  const imageVersions = useMemo(() => versions.filter(row => Boolean(row.annotatable) || /\.(png|jpe?g|webp)$/i.test(String(row.filename || row.file_url || ''))), [versions]);
  const sourceTitle = canonicalConcept?.title || selectedPost?.title || 'creative';
  const selectedObject = useMemo(() => objects.find(item => item.id === selectedId) || null, [objects, selectedId]);

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
    setLoaded(false); setObjects([]); setHistory([]); setFuture([]); setSelectedId(''); setSaved(''); setTextOpen(false); setPan({ x: 0, y: 0 });
    if (canonicalMode) {
      marketingAssetsApi.versions(Number(assetId)).then(rows => {
        setVersions(rows);
        const requested = rows.find(row => String(row.id) === requestedVersionRef.current && (row.annotatable || /\.(png|jpe?g|webp)$/i.test(String(row.filename || ''))));
        const image = requested || rows.find(row => row.annotatable || /\.(png|jpe?g|webp)$/i.test(String(row.filename || '')));
        setVersionId(image ? String(image.id) : ''); requestedVersionRef.current = '';
        if (requested && image) void openVersionRef.current(image, true, assetId, '');
      }).catch(err => setError(err.message || 'Creative versions could not be loaded.'));
      return;
    }
    if (!postId) { setVersions([]); setVersionId(''); return; }
    api.versions(Number(postId)).then(rows => {
      setVersions(rows);
      const requested = rows.find(row => String(row.id) === requestedVersionRef.current && /\.(png|jpe?g|webp)$/i.test(String(row.filename || row.file_url || '')));
      const image = requested || rows.find(row => /\.(png|jpe?g|webp)$/i.test(String(row.filename || row.file_url || '')));
      setVersionId(image ? String(image.id) : ''); requestedVersionRef.current = '';
      if (requested && image) void openVersionRef.current(image, false, '', postId);
    }).catch(err => setError(err.message || 'Creative versions could not be loaded.'));
  }, [assetId, canonicalMode, postId]);

  fitCanvasRef.current = () => {
    const stage = stageWrapRef.current; const base = baseCanvasRef.current;
    if (!stage || !base || !base.width || !base.height) return;
    const fitted = Math.min(Math.max(1, stage.clientWidth - 56) / base.width, Math.max(1, stage.clientHeight - 56) / base.height);
    setZoom(Math.max(.1, Math.min(4, fitted))); setPan({ x: 0, y: 0 });
  };
  useEffect(() => {
    const stage = stageWrapRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fitCanvasRef.current()); observer.observe(stage); return () => observer.disconnect();
  }, []);

  function checkpoint() { setHistory(items => [...items.slice(-24), cloneObjects(objects)]); setFuture([]); setSaved(''); }
  function loadBlob(blob: Blob, filename: string) {
    const mimeType = imageMime(filename, blob.type); if (!mimeType) { setError('Use a PNG, JPEG, or WebP image.'); return; }
    const sourceBlob = blob.type.toLowerCase() === mimeType ? blob : new Blob([blob], { type: mimeType }); const url = URL.createObjectURL(sourceBlob); const image = new Image();
    image.onload = () => {
      const base = baseCanvasRef.current; const annotation = annotationCanvasRef.current; if (!base || !annotation) return;
      const max = 2400; const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale)); const height = Math.max(1, Math.round(image.naturalHeight * scale));
      base.width = annotation.width = width; base.height = annotation.height = height;
      const ctx = base.getContext('2d'); if (!ctx) return; ctx.clearRect(0, 0, width, height); ctx.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url); setLoaded(true); setSourceName(filename); setObjects([]); setHistory([]); setFuture([]); setSelectedId(''); setSaved(''); setError(''); setTextOpen(false); setPan({ x: 0, y: 0 });
      requestAnimationFrame(() => fitCanvasRef.current());
    };
    image.onerror = () => { URL.revokeObjectURL(url); setError('This image could not be opened.'); }; image.src = url;
  }
  async function openVersion(version: Entity, isCanonical: boolean, currentAssetId: string, currentPostId: string) {
    if (busy) return; setBusy(true); setError('');
    try {
      const path = isCanonical ? marketingAssetsApi.downloadUrl(Number(currentAssetId), Number(version.id)) : `${API_BASE}/posts/${currentPostId}/versions/${version.id}/download`;
      const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' }); if (!res.ok) throw new Error('Creative file could not be downloaded.');
      loadBlob(await res.blob(), String(version.filename || sourceTitle));
    } catch (err: any) { setError(err.message || 'Creative file could not be loaded.'); } finally { setBusy(false); }
  }
  openVersionRef.current = openVersion;
  async function loadSelectedVersion() { if (selectedVersion && !busy && (canonicalMode || postId)) await openVersion(selectedVersion, canonicalMode, assetId, postId); }

  function overlayUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || !loaded) return;
    const mimeType = imageMime(file.name, file.type); if (!mimeType) { setError('Overlay must be a PNG, JPEG, or WebP image.'); return; }
    const reader = new FileReader(); reader.onload = () => {
      const src = String(reader.result || ''); const image = new Image(); image.onload = () => {
        const canvas = annotationCanvasRef.current; if (!canvas) return; checkpoint();
        const scale = Math.min(canvas.width * .8 / image.naturalWidth, canvas.height * .8 / image.naturalHeight, 1);
        const width = Math.max(1, image.naturalWidth * scale); const height = Math.max(1, image.naturalHeight * scale); const id = objectId();
        setObjects(items => [...items, { id, type: 'image', src, name: file.name, x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width, height, color: '#ffffff', opacity: 1 }]);
        setSelectedId(id); setTool('select'); setError(''); setSaved('');
      }; image.onerror = () => setError('This overlay image could not be opened.'); image.src = src;
    }; reader.readAsDataURL(file);
  }

  function canvasPoint(clientX: number, clientY: number) {
    const canvas = annotationCanvasRef.current; if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect(); return { x: (clientX - rect.left) * (canvas.width / Math.max(1, rect.width)), y: (clientY - rect.top) * (canvas.height / Math.max(1, rect.height)) };
  }
  function point(event: ReactPointerEvent<HTMLCanvasElement> | ReactMouseEvent<HTMLCanvasElement>) { return canvasPoint(event.clientX, event.clientY); }
  function hitObject(p: Point) {
    for (let index = objects.length - 1; index >= 0; index -= 1) { const box = bounds(objects[index]); const pad = Math.max(10, size); if (p.x >= box.x - pad && p.x <= box.x + box.width + pad && p.y >= box.y - pad && p.y <= box.y + box.height + pad) return objects[index]; }
    return null;
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!loaded) return; const p = point(event);
    if (tool === 'select') { setSelectedId(''); setTextOpen(false); return; }
    if (tool === 'pan') { setPanning({ x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }); event.currentTarget.setPointerCapture(event.pointerId); return; }
    if (tool === 'eraser') { const target = hitObject(p); if (target) { checkpoint(); setObjects(items => items.filter(item => item.id !== target.id)); if (selectedId === target.id) setSelectedId(''); } return; }
    if (tool === 'text') { setTextEditingId(''); setTextPoint(p); setTextValue(''); setTextOpen(true); return; }
    checkpoint(); event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'pen' || tool === 'highlighter') {
      const id = objectId(); setDrawingId(id); setObjects(items => [...items, { id, type: tool, points: [p], strokeWidth: tool === 'highlighter' ? size * 3 : size, color, opacity: tool === 'highlighter' ? .28 : 1 }]); return;
    }
    if (tool === 'arrow' || tool === 'rect' || tool === 'ellipse') {
      const id = objectId(); setDrawingId(id); setShapeStart(p); setObjects(items => [...items, { id, type: tool, x: p.x, y: p.y, width: 1, height: 1, strokeWidth: size, color, opacity: 1 }]);
    }
  }
  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!loaded) return;
    if (panning) { setPan({ x: panning.panX + event.clientX - panning.x, y: panning.panY + event.clientY - panning.y }); return; }
    if (!drawingId) return; const p = point(event);
    setObjects(items => items.map(item => {
      if (item.id !== drawingId) return item;
      if (item.type === 'pen' || item.type === 'highlighter') return { ...item, points: [...item.points, p] };
      if ((item.type === 'arrow' || item.type === 'rect' || item.type === 'ellipse') && shapeStart) { const box = normalizeBox(shapeStart.x, shapeStart.y, p.x - shapeStart.x, p.y - shapeStart.y); return { ...item, ...box }; }
      return item;
    }));
  }
  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    setDrawingId(''); setShapeStart(null); setPanning(null); try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  }

  function addText() {
    const value = textValue.trim(); if (!value) { setTextOpen(false); setTextEditingId(''); return; }
    checkpoint();
    if (textEditingId) setObjects(items => items.map(item => item.id === textEditingId && item.type === 'text' ? { ...item, text: value, fontSize: textSize, color } : item));
    else { const id = objectId(); setObjects(items => [...items, { id, type: 'text', x: textPoint.x, y: textPoint.y, text: value, fontSize: textSize, color, opacity: 1 }]); setSelectedId(id); }
    setTextOpen(false); setTextEditingId(''); setTextValue(''); setTool('select'); setSaved('');
  }
  function beginEditText(item: TextObject) { setSelectedId(item.id); setTextEditingId(item.id); setTextValue(item.text); setTextPoint({ x: item.x, y: item.y }); setTextSize(item.fontSize); setColor(item.color); setTextOpen(true); }

  function beginObjectInteraction(event: ReactPointerEvent<SVGElement>, item: AnnotationObject, mode: 'move' | 'resize') {
    if (tool !== 'select') return; event.preventDefault(); event.stopPropagation(); checkpoint(); setSelectedId(item.id); setInteraction({ id: item.id, mode, startClientX: event.clientX, startClientY: event.clientY, original: cloneObjects([item])[0] });
  }
  useEffect(() => {
    if (!interaction) return;
    function move(event: PointerEvent) {
      const canvas = annotationCanvasRef.current; if (!canvas) return; const rect = canvas.getBoundingClientRect(); const sx = canvas.width / Math.max(1, rect.width); const sy = canvas.height / Math.max(1, rect.height);
      const dx = (event.clientX - interaction.startClientX) * sx; const dy = (event.clientY - interaction.startClientY) * sy;
      setObjects(items => items.map(item => {
        if (item.id !== interaction.id) return item; const original = interaction.original;
        if (interaction.mode === 'move') {
          if (original.type === 'pen' || original.type === 'highlighter') return { ...item, points: original.points.map(point => ({ x: point.x + dx, y: point.y + dy })) } as AnnotationObject;
          const positioned = original as TextObject | ImageObject | ShapeObject; return { ...item, x: positioned.x + dx, y: positioned.y + dy } as AnnotationObject;
        }
        if (original.type === 'text') { const box = textBox(original); const scale = Math.max(.25, (box.width + dx) / Math.max(1, box.width)); return { ...item, fontSize: Math.max(12, Math.min(240, original.fontSize * scale)) } as AnnotationObject; }
        if (original.type === 'image') { const ratio = original.width / Math.max(1, original.height); const width = Math.max(24, original.width + dx); return { ...item, width, height: width / ratio } as AnnotationObject; }
        if (original.type === 'rect' || original.type === 'ellipse' || original.type === 'arrow') return { ...item, width: Math.max(12, original.width + dx), height: Math.max(12, original.height + dy) } as AnnotationObject;
        return item;
      }));
    }
    function up() { setInteraction(null); }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [interaction]);

  function updateSelected(patch: Partial<AnnotationObject>) { if (!selectedId) return; checkpoint(); setObjects(items => items.map(item => item.id === selectedId ? ({ ...item, ...patch } as AnnotationObject) : item)); }
  function deleteSelected() { if (!selectedId) return; checkpoint(); setObjects(items => items.filter(item => item.id !== selectedId)); setSelectedId(''); }
  function duplicateSelected() {
    if (!selectedObject) return; checkpoint(); const copy = cloneObjects([selectedObject])[0]; const id = objectId(); let shifted: AnnotationObject;
    if (copy.type === 'pen' || copy.type === 'highlighter') shifted = { ...copy, id, points: copy.points.map(point => ({ x: point.x + 20, y: point.y + 20 })) };
    else { const positioned = copy as TextObject | ImageObject | ShapeObject; shifted = { ...positioned, id, x: positioned.x + 20, y: positioned.y + 20 }; }
    setObjects(items => [...items, shifted]); setSelectedId(id);
  }
  function reorderSelected(direction: 'front' | 'back') {
    if (!selectedId) return; checkpoint(); setObjects(items => { const next = [...items]; const index = next.findIndex(item => item.id === selectedId); if (index < 0) return items; const [item] = next.splice(index, 1); if (direction === 'front') next.push(item); else next.unshift(item); return next; });
  }
  function undo() { const previous = history[history.length - 1]; if (!previous) return; setFuture(items => [...items, cloneObjects(objects)]); setHistory(items => items.slice(0, -1)); setObjects(cloneObjects(previous)); setSelectedId(''); setSaved(''); }
  function redo() { const next = future[future.length - 1]; if (!next) return; setHistory(items => [...items, cloneObjects(objects)]); setFuture(items => items.slice(0, -1)); setObjects(cloneObjects(next)); setSelectedId(''); setSaved(''); }

  async function drawObjects(ctx: CanvasRenderingContext2D) {
    for (const item of objects) {
      ctx.save(); ctx.globalAlpha = item.opacity; ctx.strokeStyle = item.color; ctx.fillStyle = item.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (item.type === 'pen' || item.type === 'highlighter') { ctx.lineWidth = item.strokeWidth; ctx.beginPath(); item.points.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); }
      else if (item.type === 'text') { ctx.font = `700 ${item.fontSize}px system-ui, -apple-system, sans-serif`; ctx.textBaseline = 'top'; ctx.fillText(item.text, item.x, item.y); }
      else if (item.type === 'rect') { ctx.lineWidth = item.strokeWidth; ctx.strokeRect(item.x, item.y, item.width, item.height); }
      else if (item.type === 'ellipse') { ctx.lineWidth = item.strokeWidth; ctx.beginPath(); ctx.ellipse(item.x + item.width / 2, item.y + item.height / 2, item.width / 2, item.height / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
      else if (item.type === 'arrow') { ctx.lineWidth = item.strokeWidth; const x2 = item.x + item.width; const y2 = item.y + item.height; ctx.beginPath(); ctx.moveTo(item.x, item.y); ctx.lineTo(x2, y2); ctx.stroke(); const angle = Math.atan2(item.height, item.width); const head = Math.max(12, item.strokeWidth * 3); ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6)); ctx.moveTo(x2, y2); ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6)); ctx.stroke(); }
      else if (item.type === 'image') { const image = new Image(); image.src = item.src; if (!image.complete) await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error(`Overlay ${item.name} could not be rendered.`)); }); ctx.drawImage(image, item.x, item.y, item.width, item.height); }
      ctx.restore();
    }
  }
  async function compositeCanvas() { const base = baseCanvasRef.current; if (!base || !loaded) return null; const output = document.createElement('canvas'); output.width = base.width; output.height = base.height; const ctx = output.getContext('2d'); if (!ctx) return null; ctx.drawImage(base, 0, 0); await drawObjects(ctx); return output; }
  async function exportImage() { try { const canvas = await compositeCanvas(); if (!canvas) return; const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = safeFilename(sourceName || sourceTitle); link.click(); } catch (err: any) { setError(err.message || 'Canvas export failed.'); } }
  async function saveVersion() {
    if (busy || (!canonicalMode && !postId)) return; setBusy(true); setError(''); setSaved('');
    try {
      const canvas = await compositeCanvas(); if (!canvas) return; const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Canvas export failed.')), 'image/png'));
      const filename = safeFilename(sourceName || sourceTitle); const file = new File([blob], filename, { type: 'image/png' }); let created: Entity;
      if (canonicalMode) { created = await marketingAssetsApi.addVersion(Number(assetId), file, 'Annotated in Marketing creative studio'); setVersions(await marketingAssetsApi.versions(Number(assetId))); }
      else { const form = new FormData(); form.append('filename', filename); form.append('file_url', ''); form.append('note', 'Annotated in Marketing creative studio'); form.append('caption_snapshot', String(selectedPost?.caption || '')); form.append('file', file); created = await api.addVersion(Number(postId), form); setVersions(await api.versions(Number(postId))); }
      setVersionId(String(created.id)); setSaved('Saved as a new creative version. Original preserved.');
    } catch (err: any) { setError(err.message || 'Annotated version could not be saved.'); } finally { setBusy(false); }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null; if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if ((event.metaKey || event.ctrlKey) && key === 'd' && selectedId) { event.preventDefault(); duplicateSelected(); return; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) { event.preventDefault(); deleteSelected(); return; }
      if (key === 'v') setTool('select'); if (key === 'p') setTool('pen'); if (key === 'h') setTool('highlighter'); if (key === 'e') setTool('eraser'); if (key === 't') setTool('text'); if (key === 'a') setTool('arrow'); if (key === 'r') setTool('rect'); if (key === 'o') setTool('ellipse');
      if (selectedId && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { event.preventDefault(); const amount = event.shiftKey ? 10 : 1; checkpoint(); setObjects(items => items.map(item => { if (item.id !== selectedId) return item; const dx = key === 'arrowleft' ? -amount : key === 'arrowright' ? amount : 0; const dy = key === 'arrowup' ? -amount : key === 'arrowdown' ? amount : 0; if (item.type === 'pen' || item.type === 'highlighter') return { ...item, points: item.points.map(point => ({ x: point.x + dx, y: point.y + dy })) }; const positioned = item as TextObject | ImageObject | ShapeObject; return { ...positioned, x: positioned.x + dx, y: positioned.y + dy }; })); }
    }
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
  });

  function renderObject(item: AnnotationObject) {
    const selected = item.id === selectedId; const box = bounds(item); const common = { onPointerDown: (event: ReactPointerEvent<SVGElement>) => beginObjectInteraction(event, item, 'move'), onDoubleClick: () => item.type === 'text' && beginEditText(item) };
    return <g key={item.id} data-annotation-object={item.type} aria-label={`${item.type} annotation`} opacity={item.opacity}>
      {item.type === 'pen' || item.type === 'highlighter' ? <polyline points={item.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={item.color} strokeWidth={item.strokeWidth} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" /> : null}
      {item.type === 'text' ? <text x={item.x} y={item.y} fill={item.color} fontSize={item.fontSize} fontWeight="700" dominantBaseline="hanging" pointerEvents="none">{item.text}</text> : null}
      {item.type === 'image' ? <image href={item.src} x={item.x} y={item.y} width={item.width} height={item.height} pointerEvents="none" /> : null}
      {item.type === 'rect' ? <rect x={item.x} y={item.y} width={item.width} height={item.height} fill="none" stroke={item.color} strokeWidth={item.strokeWidth} pointerEvents="none" /> : null}
      {item.type === 'ellipse' ? <ellipse cx={item.x + item.width / 2} cy={item.y + item.height / 2} rx={item.width / 2} ry={item.height / 2} fill="none" stroke={item.color} strokeWidth={item.strokeWidth} pointerEvents="none" /> : null}
      {item.type === 'arrow' ? <line x1={item.x} y1={item.y} x2={item.x + item.width} y2={item.y + item.height} stroke={item.color} strokeWidth={item.strokeWidth} markerEnd="url(#arrowhead)" pointerEvents="none" /> : null}
      <rect {...common} x={box.x - 8} y={box.y - 8} width={box.width + 16} height={box.height + 16} fill="transparent" stroke={selected ? 'var(--accent)' : 'transparent'} strokeWidth={selected ? 3 / zoom : 0} strokeDasharray={selected ? `${8 / zoom} ${6 / zoom}` : undefined} style={{ cursor: tool === 'select' ? 'move' : 'default', pointerEvents: tool === 'select' ? 'all' : 'none' }} />
      {selected ? <circle aria-label="Resize selected annotation" cx={box.x + box.width + 8} cy={box.y + box.height + 8} r={8 / zoom} fill="white" stroke="var(--accent)" strokeWidth={2 / zoom} onPointerDown={event => beginObjectInteraction(event, item, 'resize')} style={{ cursor: 'nwse-resize', pointerEvents: 'all' }} /> : null}
    </g>;
  }

  return <main className={styles.page}>
    <header className={styles.hero}><div className={styles.heroCopy}><div className={styles.eyebrow}>Marketing · Creative review</div><h1>Annotation studio</h1><p>Review creatives with editable text, overlays, shapes, arrows and freehand marks. Select any annotation to move, resize, recolor, duplicate, reorder or delete it before saving a new version.</p></div><Link className={styles.back} href="/posts">← Back to Marketing</Link></header>
    {error ? <div className="pill urgent" role="alert">{error}</div> : null}
    <div className={styles.shell}>
      <aside className={styles.rail} aria-label="Annotation controls">
        <section className={styles.section}><div className={styles.sectionTitle}>Creative source</div>{canonicalMode ? <div className={styles.saveState}>{canonicalConcept?.title || `Content concept #${conceptId}`}</div> : <select aria-label="Marketing post" className={styles.select} value={postId} onChange={e => setPostId(e.target.value)}><option value="">Choose marketing post</option>{posts.map(post => <option key={post.id} value={post.id}>{post.title}</option>)}</select>}<select aria-label="Creative image version" className={styles.select} value={versionId} onChange={e => setVersionId(e.target.value)} disabled={(!canonicalMode && !postId) || !imageVersions.length}><option value="">{!imageVersions.length ? 'No image versions yet' : 'Choose image version'}</option>{imageVersions.map(version => <option key={version.id} value={version.id}>v{version.version_no || version.id} · {version.filename || 'Image asset'}</option>)}</select><button className={styles.secondary} onClick={loadSelectedVersion} disabled={!versionId || busy}>{busy ? 'Opening…' : 'Open version'}</button><label className={`${styles.upload} ${!loaded ? styles.uploadDisabled : ''}`}>Add image overlay<input aria-label="Overlay image" type="file" accept="image/png,image/jpeg,image/webp" onChange={overlayUpload} disabled={!loaded} /></label><span className={styles.saveState}>Uploaded overlays stay editable in the current review session and never replace the base creative.</span></section>
        <section className={styles.section}><div className={styles.sectionTitle}>Tools</div><div className={styles.toolGrid}>{(['select','pen','highlighter','eraser','text','arrow','rect','ellipse','pan'] as Tool[]).map(value => <button key={value} className={`${styles.tool} ${tool === value ? styles.toolActive : ''}`} onClick={() => { setTool(value); if (value !== 'text') setTextOpen(false); }} aria-pressed={tool === value}>{toolLabels[value]}</button>)}</div><span className={styles.saveState}>V Select · P Pen · H Highlight · E Eraser · T Text · A Arrow · R Box · O Circle</span></section>
        <section className={styles.section}><div className={styles.sectionTitle}>Color</div><div className={styles.swatches}>{swatches.map(value => <button key={value} title={value} aria-label={`Use ${value}`} className={`${styles.swatch} ${color === value ? styles.swatchActive : ''}`} style={{ background: value }} onClick={() => { setColor(value); if (selectedObject && selectedObject.type !== 'image') updateSelected({ color: value }); }} />)}</div><input aria-label="Custom annotation color" type="color" className={styles.colorInput} value={color} onChange={e => { setColor(e.target.value); if (selectedObject && selectedObject.type !== 'image') updateSelected({ color: e.target.value }); }} /></section>
        <section className={styles.section}><div className={styles.sectionTitle}>Stroke · {size}px</div><input aria-label="Annotation stroke size" className={styles.range} type="range" min="2" max="24" value={size} onChange={e => setSize(Number(e.target.value))} /></section>
        <section className={styles.section}><div className={styles.sectionTitle}>Text size · {selectedObject?.type === 'text' ? Math.round(selectedObject.fontSize) : textSize}px</div><input aria-label="Text font size" className={styles.range} type="range" min="12" max="160" step="2" value={selectedObject?.type === 'text' ? Math.round(selectedObject.fontSize) : textSize} onChange={e => { const value = Number(e.target.value); setTextSize(value); if (selectedObject?.type === 'text') updateSelected({ fontSize: value }); }} /><span className={styles.saveState}>Double-click selected text to edit its wording again.</span></section>
        <section className={styles.section}><div className={styles.sectionTitle}>Selected object</div><div className={styles.objectActions}><button className={styles.secondary} disabled={!selectedObject} onClick={duplicateSelected}>Duplicate</button><button className={styles.secondary} disabled={!selectedObject} onClick={() => reorderSelected('front')}>Bring front</button><button className={styles.secondary} disabled={!selectedObject} onClick={() => reorderSelected('back')}>Send back</button><button className={styles.secondary} disabled={!selectedObject} onClick={deleteSelected}>Delete</button></div>{selectedObject && selectedObject.type !== 'pen' && selectedObject.type !== 'highlighter' ? <><div className={styles.sectionTitle}>Opacity · {Math.round(selectedObject.opacity * 100)}%</div><input aria-label="Selected annotation opacity" className={styles.range} type="range" min="10" max="100" value={Math.round(selectedObject.opacity * 100)} onChange={e => updateSelected({ opacity: Number(e.target.value) / 100 })} /></> : null}<span className={styles.saveState}>Delete removes selected · ⌘/Ctrl D duplicates · arrows nudge · Shift+arrows nudge 10px.</span></section>
        <section className={styles.section}><div className={styles.sectionTitle}>History</div><div className={styles.miniRow}><button className={styles.secondary} onClick={undo} disabled={!history.length}>↶ Undo</button><button className={styles.secondary} onClick={redo} disabled={!future.length}>↷ Redo</button></div><span className={styles.saveState}>Object edits, drawing, moves, resizes and deletes are undoable.</span></section>
      </aside>
      <section className={styles.workspace}>
        <div className={styles.topbar}><div className={styles.status}><span className={styles.dot} />{loaded ? sourceName || 'Creative loaded' : 'No creative loaded'}</div><div className={styles.topActions}><button className={styles.secondary} disabled={!loaded} onClick={() => setZoom(value => Math.max(.1, value - .15))}>−</button><button className={styles.secondary} disabled={!loaded} onClick={() => fitCanvasRef.current()}>Fit · {Math.round(zoom * 100)}%</button><button className={styles.secondary} disabled={!loaded} onClick={() => setZoom(value => Math.min(4, value + .15))}>+</button></div></div>
        <div ref={stageWrapRef} className={styles.stageWrap} tabIndex={0} role="region" aria-label="Creative annotation canvas"><div className={styles.canvasFrame} style={{ left: `calc(50% + ${pan.x}px)`, top: `calc(50% + ${pan.y}px)`, transform: `scale(${zoom})`, visibility: loaded ? 'visible' : 'hidden' }}><canvas ref={baseCanvasRef} className={styles.baseCanvas} /><canvas ref={annotationCanvasRef} className={`${styles.canvas} ${tool === 'pan' ? styles.panCursor : tool === 'select' ? styles.selectCursor : ''}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} /><svg className={styles.objectLayer} viewBox={`0 0 ${baseCanvasRef.current?.width || 1} ${baseCanvasRef.current?.height || 1}`} aria-label="Editable annotation objects"><defs><marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke" /></marker></defs>{objects.map(renderObject)}</svg>{textOpen ? <input autoFocus aria-label="Text annotation" className={styles.inlineText} value={textValue} onChange={e => setTextValue(e.target.value)} onPointerDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addText(); } if (e.key === 'Escape') { e.preventDefault(); setTextOpen(false); setTextEditingId(''); setTextValue(''); } }} style={{ left: textPoint.x, top: textPoint.y, fontSize: textSize, color }} placeholder="Type…" /> : null}</div>{!loaded ? <div className={styles.empty}><strong>Open a creative to start annotating</strong><span>Select an existing image version first. The studio will automatically fit it to the available workspace.</span></div> : null}</div>
        <div className={styles.footer}><div><div className={styles.footerHint}>The base creative stays locked. New review marks remain editable until you export or save the flattened result as a new creative version.</div>{saved ? <div className={styles.saveState}>{saved}</div> : null}</div><div className={styles.topActions}><button className={styles.secondary} disabled={!loaded} onClick={() => void exportImage()}>Export PNG</button><button className={styles.primary} disabled={!loaded || (!canonicalMode && !postId) || busy} onClick={saveVersion}>{busy ? 'Saving…' : 'Save annotated version'}</button></div></div>
      </section>
    </div>
  </main>;
}
