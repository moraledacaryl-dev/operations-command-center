'use client';

import Link from 'next/link';
import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import { Entity } from '@/lib/api';
import { marketingAssetsApi } from '@/lib/marketing-assets-api';

const annotatable = (version: Entity) => Boolean(version.annotatable) || /\.(png|jpe?g|webp)$/i.test(String(version.filename || ''));

export function ConceptCreativeAssets({ conceptId, canManage }: { conceptId: number; canManage: boolean }) {
  const [assets, setAssets] = useState<Entity[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setAssets(await marketingAssetsApi.list(conceptId));
    } catch (err: any) {
      setError(err.message || 'Creative assets could not be loaded.');
    }
  }, [conceptId]);

  useEffect(() => { void load(); }, [load]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    setBusy(true); setError('');
    try {
      await marketingAssetsApi.upload(conceptId, file, file.name, 'Uploaded from canonical Marketing content');
      await load();
    } catch (err: any) {
      setError(err.message || 'Creative could not be uploaded.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel">
    <div className="topbar"><div><p className="eyebrow">Creative</p><h3>Creative versions</h3></div>{canManage ? <label className="btn small secondary">{busy ? 'Uploading…' : 'Upload creative'}<input hidden type="file" accept="image/png,image/jpeg,image/webp,application/pdf,video/mp4,video/quicktime" onChange={upload} disabled={busy} /></label> : null}</div>
    {error ? <div className="pill urgent" role="alert">{error}</div> : null}
    {!assets.length ? <p className="muted">No creative has been attached to this content yet.</p> : <div className="grid">{assets.map(asset => <div className="card" key={asset.id}><strong>{asset.title || 'Creative asset'}</strong>{(asset.versions || []).map((version: Entity) => <div className="card-line" key={version.id}><span>v{version.version_no} · {version.filename}</span><a className="btn small secondary" href={version.file_url} target="_blank" rel="noreferrer">Open</a>{annotatable(version) ? <Link className="btn small" href={`/posts/editor?conceptId=${conceptId}&assetId=${asset.id}&versionId=${version.id}`}>Annotate</Link> : null}</div>)}</div>)}</div>}
  </section>;
}
