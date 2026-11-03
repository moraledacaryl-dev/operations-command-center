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
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setAssets(await marketingAssetsApi.list(conceptId));
    } catch (err: any) {
      setError(err.message || 'Could not load the files.');
    }
  }, [conceptId]);

  useEffect(() => { void load(); }, [load]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await marketingAssetsApi.upload(conceptId, file, file.name, 'Uploaded for this post');
      await load();
      const firstVersion = Array.isArray(created.versions) ? created.versions[0] : null;
      setNotice(`Uploaded ${firstVersion?.filename || file.name} successfully.`);
    } catch (err: any) {
      setError(err.message || 'Could not upload the file.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel">
    <div className="topbar"><div><h3>Images and files</h3></div>{canManage ? <label className="btn small secondary">{busy ? 'Uploading…' : 'Add file'}<input hidden type="file" accept="image/png,image/jpeg,image/webp,application/pdf,video/mp4,video/quicktime" onChange={upload} disabled={busy} /></label> : null}</div>
    {error ? <div className="pill urgent" role="alert">{error}</div> : null}
    {notice ? <div className="pill" role="status">{notice}</div> : null}
    {!assets.length ? <p className="muted">No files have been added to this post yet.</p> : <div className="grid">{assets.map(asset => <div className="card" key={asset.id}><strong>{asset.title || 'Image or file'}</strong>{(asset.versions || []).map((version: Entity) => <div className="card-line" key={version.id}><span>v{version.version_no} · {version.filename}</span><a className="btn small secondary" href={version.file_url} target="_blank" rel="noreferrer">Open</a>{annotatable(version) ? <Link className="btn small" href={`/posts/editor?conceptId=${conceptId}&assetId=${asset.id}&versionId=${version.id}`}>Edit image</Link> : null}</div>)}</div>)}</div>}
  </section>;
}
