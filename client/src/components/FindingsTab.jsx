import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const SEVERITIES = ['laag', 'middel', 'hoog', 'veiligheidskritisch'];
const STATUS_LABELS = {
  open: 'Open', in_behandeling: 'In behandeling', gereed_voor_hercontrole: 'Gereed voor hercontrole', afgesloten: 'Afgesloten',
};

function FindingCard({ propertyId, finding, onChange }) {
  const [detail, setDetail] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [repairForm, setRepairForm] = useState({ action: '', explanation: '' });
  const [error, setError] = useState('');

  function loadDetail() {
    api.get(`/properties/${propertyId}/findings/${finding.id}`).then(setDetail).catch((e) => setError(e.message));
  }

  useEffect(() => { if (expanded) loadDetail(); }, [expanded]);

  async function handleRepair(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/properties/${propertyId}/findings/${finding.id}/repairs`, repairForm);
      setRepairForm({ action: '', explanation: '' });
      loadDetail();
      onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <li className={`finding-card severity-${finding.severity}`}>
      <div className="list-item-row" onClick={() => setExpanded((v) => !v)} style={{ cursor: 'pointer' }}>
        <div>
          <strong>#{finding.finding_number}</strong> {finding.description}
          <div className="muted small">{finding.category} — gemeld door {finding.reported_by_name}</div>
        </div>
        <div>
          <span className={`badge severity-badge-${finding.severity}`}>{finding.severity}</span>
          <span className="badge">{STATUS_LABELS[finding.status]}</span>
        </div>
      </div>

      {expanded && (
        <div className="finding-details">
          {error && <div className="alert-error">{error}</div>}
          {detail?.repair_deadline && <p className="muted">Hersteltermijn: {detail.repair_deadline}</p>}
          <h4>Herstelacties</h4>
          <ul className="simple-list">
            {detail?.repairs.map((r) => (
              <li key={r.id}>{r.action} — {r.executor_name} ({r.date}) {r.explanation && `: ${r.explanation}`}</li>
            ))}
            {detail?.repairs.length === 0 && <li className="muted">Nog geen herstelactie geregistreerd.</li>}
          </ul>
          {finding.status !== 'afgesloten' && (
            <form className="inline-form" onSubmit={handleRepair} onClick={(e) => e.stopPropagation()}>
              <label>Herstelactie
                <input value={repairForm.action} onChange={(e) => setRepairForm({ ...repairForm, action: e.target.value })} required />
              </label>
              <label>Toelichting
                <input value={repairForm.explanation} onChange={(e) => setRepairForm({ ...repairForm, explanation: e.target.value })} />
              </label>
              <button type="submit" className="btn-secondary">Herstel registreren</button>
            </form>
          )}
        </div>
      )}
    </li>
  );
}

export default function FindingsTab({ propertyId, mode = 'all' }) {
  const [findings, setFindings] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category: '', description: '', severity: 'middel', repair_deadline: '' });
  const [error, setError] = useState('');

  function load() {
    api.get(`/properties/${propertyId}/findings`).then(setFindings).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [propertyId]);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/properties/${propertyId}/findings`, form);
      setForm({ category: '', description: '', severity: 'middel', repair_deadline: '' });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const visible = mode === 'repair-focus' ? findings.filter((f) => f.status !== 'afgesloten') : findings;

  return (
    <div>
      <div className="page-header">
        <h2 style={{ marginTop: 0 }}>{mode === 'repair-focus' ? 'Herstel' : 'Bevindingen'}</h2>
        {mode === 'all' && (
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Annuleren' : '+ Bevinding'}
          </button>
        )}
      </div>

      {error && <div className="alert-error">{error}</div>}

      {showForm && (
        <form className="inline-form" onSubmit={handleAdd}>
          <div className="form-row">
            <label>Categorie
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </label>
            <label>Ernst
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>Hersteltermijn
              <input type="date" value={form.repair_deadline} onChange={(e) => setForm({ ...form, repair_deadline: e.target.value })} />
            </label>
          </div>
          <label>Omschrijving
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
          </label>
          <button type="submit" className="btn-primary">Opslaan</button>
        </form>
      )}

      <ul className="simple-list">
        {visible.map((f) => (
          <FindingCard key={f.id} propertyId={propertyId} finding={f} onChange={load} />
        ))}
        {visible.length === 0 && <li className="muted">{mode === 'repair-focus' ? 'Geen openstaande herstelpunten.' : 'Nog geen bevindingen.'}</li>}
      </ul>
    </div>
  );
}
