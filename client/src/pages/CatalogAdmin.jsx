import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

export default function CatalogAdmin() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

  function load(query) {
    api.get(`/work-item-catalog?q=${encodeURIComponent(query || '')}`).then(setItems).catch((e) => setError(e.message));
  }

  useEffect(() => { load(''); }, []);

  function handleSearch(e) {
    e.preventDefault();
    load(q);
  }

  async function handleImport(e) {
    e.preventDefault();
    setError('');
    setImportResult(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('Kies eerst een Excel-bestand');
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.set('file', file);
      const result = await api.postForm('/work-item-catalog/import', formData);
      setImportResult(result);
      if (fileInputRef.current) fileInputRef.current.value = '';
      load(q);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <h1>Werkzaamhedencatalogus</h1>
      <p className="muted">
        Standaard werkzaamheden met code, eenheid en normprijs, te gebruiken bij het registreren van werkzaamheden per woning.
        Upload een Excel-bestand (kolommen: CODERING DATABASE, DISCIPLINE, OMSCHRIJVING, EENHEID, EENHEIDSPRIJS, EENHEIDSPRIJS 2026, EXTRA TOELICHTING)
        om de catalogus aan te vullen of bij te werken — bestaande codes worden bijgewerkt, niet gedupliceerd.
      </p>

      {error && <div className="alert-error">{error}</div>}
      {importResult && (
        <div className="alert-warning">
          Import voltooid: {importResult.created} nieuw, {importResult.updated} bijgewerkt, {importResult.skipped} overgeslagen (lege omschrijving).
        </div>
      )}

      <form className="inline-form" onSubmit={handleImport}>
        <label>Excel-bestand (.xlsx)
          <input type="file" ref={fileInputRef} accept=".xlsx" />
        </label>
        <button type="submit" className="btn-primary" disabled={importing}>
          {importing ? 'Bezig met importeren...' : 'Catalogus importeren/bijwerken'}
        </button>
      </form>

      <form className="search-bar" onSubmit={handleSearch}>
        <input placeholder="Zoek op omschrijving of code..." value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit">Zoeken</button>
      </form>

      <table className="data-table">
        <thead><tr><th>Code</th><th>Omschrijving</th><th>Eenheid</th><th>Prijs</th><th>Prijs 2026</th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>{i.code || '—'}</td>
              <td>{i.description}{i.note && <div className="muted small">{i.note}</div>}</td>
              <td>{i.unit}</td>
              <td>{i.unit_price !== null ? `€${i.unit_price.toFixed(2)}` : '—'}</td>
              <td>{i.unit_price_2026 !== null ? `€${i.unit_price_2026.toFixed(2)}` : '—'}</td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={5} className="muted">Geen items gevonden. Importeer eerst een Excel-bestand.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
