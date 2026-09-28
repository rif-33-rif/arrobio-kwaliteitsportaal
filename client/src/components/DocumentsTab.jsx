import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function DocumentsTab({ propertyId }) {
  const { user } = useAuth();
  const [inspections, setInspections] = useState([]);
  const [internalCount, setInternalCount] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ organisation: '', inspector: '', date: '', report_number: '', findings_count: 0, conclusion: '', remarks: '' });
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);

  function load() {
    api.get(`/properties/${propertyId}/external-inspections`).then((d) => {
      setInspections(d.inspections);
      setInternalCount(d.internalFindingsCount);
    }).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [propertyId]);

  async function handleGenerate() {
    setError('');
    setGenerating(true);
    try {
      await api.download(`/reports/properties/${propertyId}/report`);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/properties/${propertyId}/external-inspections`, { ...form, findings_count: Number(form.findings_count) || 0 });
      setForm({ organisation: '', inspector: '', date: '', report_number: '', findings_count: 0, conclusion: '', remarks: '' });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const canManage = user?.role === 'beheerder' || user?.role === 'manager';

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Opleverrapport</h2>
      {error && <div className="alert-error">{error}</div>}
      <button className="btn-primary" onClick={handleGenerate} disabled={generating}>
        {generating ? 'Bezig met genereren...' : 'PDF-opleverrapport genereren'}
      </button>

      <h2>Onafhankelijke keuring</h2>
      <p className="muted">Interne controle: {internalCount} bevinding(en) geregistreerd.</p>

      {canManage && (
        <button className="btn-secondary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Annuleren' : '+ Externe keuring vastleggen'}
        </button>
      )}

      {showForm && (
        <form className="inline-form" onSubmit={handleAdd}>
          <div className="form-row">
            <label>Keuringsorganisatie
              <input value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} required />
            </label>
            <label>Inspecteur
              <input value={form.inspector} onChange={(e) => setForm({ ...form, inspector: e.target.value })} />
            </label>
            <label>Datum
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </label>
          </div>
          <div className="form-row">
            <label>Rapportnummer
              <input value={form.report_number} onChange={(e) => setForm({ ...form, report_number: e.target.value })} />
            </label>
            <label>Aantal bevindingen (extern)
              <input type="number" value={form.findings_count} onChange={(e) => setForm({ ...form, findings_count: e.target.value })} />
            </label>
          </div>
          <label>Conclusie
            <input value={form.conclusion} onChange={(e) => setForm({ ...form, conclusion: e.target.value })} />
          </label>
          <label>Opmerkingen
            <input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </label>
          <button type="submit" className="btn-primary">Opslaan</button>
        </form>
      )}

      <table className="data-table">
        <thead><tr><th>Organisatie</th><th>Datum</th><th>Bevindingen (extern)</th><th>Bevindingen (intern)</th><th>Conclusie</th></tr></thead>
        <tbody>
          {inspections.map((i) => (
            <tr key={i.id} className={i.findings_count !== internalCount ? 'row-warning' : ''}>
              <td>{i.organisation}{i.inspector && ` (${i.inspector})`}</td>
              <td>{i.date}</td>
              <td>{i.findings_count}</td>
              <td>{internalCount}</td>
              <td>{i.conclusion || '—'}</td>
            </tr>
          ))}
          {inspections.length === 0 && <tr><td colSpan={5} className="muted">Nog geen externe keuringen vastgelegd.</td></tr>}
        </tbody>
      </table>
      {inspections.some((i) => i.findings_count !== internalCount) && (
        <p className="alert-warning">Er is een afwijking tussen het aantal interne en externe bevindingen.</p>
      )}
    </div>
  );
}
