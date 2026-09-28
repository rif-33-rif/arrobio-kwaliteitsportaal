import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

const CATEGORIES = [
  ['voor_werkzaamheden', 'Voor werkzaamheden'],
  ['tijdens_werkzaamheden', 'Tijdens werkzaamheden'],
  ['na_werkzaamheden', 'Na werkzaamheden'],
  ['groepenkast', 'Groepenkast'],
  ['meetresultaat', 'Meetresultaat'],
  ['gebrek', 'Gebrek'],
  ['herstel', 'Herstel'],
  ['tweede_controle', 'Tweede controle'],
  ['overig', 'Overig'],
];

function Thumbnail({ propertyId, attachment }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let objectUrl;
    api.getBlobUrl(`/properties/${propertyId}/attachments/${attachment.id}/file`).then((u) => {
      objectUrl = u;
      setUrl(u);
    }).catch(() => {});
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [propertyId, attachment.id]);

  return (
    <div className="photo-card">
      {url ? <img src={url} alt={attachment.description || attachment.category} /> : <div className="photo-placeholder">Laden...</div>}
      <div className="photo-meta">
        <span className="badge">{attachment.category}</span>
        {attachment.locked ? <span className="badge badge-warning">Vergrendeld</span> : null}
        <div className="muted small">{attachment.uploaded_by_name} — {attachment.created_at}</div>
      </div>
    </div>
  );
}

export default function PhotosTab({ propertyId }) {
  const [attachments, setAttachments] = useState([]);
  const [category, setCategory] = useState(CATEGORIES[0][0]);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  function load() {
    api.get(`/properties/${propertyId}/attachments`).then(setAttachments).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [propertyId]);

  async function handleUpload(e) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('Kies eerst een bestand');
      return;
    }
    setError('');
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set('category', category);
      formData.set('description', description);
      formData.set('file', file);
      await api.postForm(`/properties/${propertyId}/attachments`, formData);
      setDescription('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Foto's</h2>

      {error && <div className="alert-error">{error}</div>}

      <form className="inline-form" onSubmit={handleUpload}>
        <div className="form-row">
          <label>Categorie
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Omschrijving
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
        <label>Bestand (jpg, png, webp of pdf)
          <input type="file" ref={fileInputRef} accept="image/jpeg,image/png,image/webp,application/pdf" required />
        </label>
        <button type="submit" className="btn-primary btn-large" disabled={uploading}>
          {uploading ? 'Bezig met uploaden...' : 'FOTO TOEVOEGEN'}
        </button>
      </form>

      <div className="photo-grid">
        {attachments.map((a) => (
          <Thumbnail key={a.id} propertyId={propertyId} attachment={a} />
        ))}
        {attachments.length === 0 && <p className="muted">Nog geen foto's toegevoegd.</p>}
      </div>
    </div>
  );
}
