import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const THEME_LABELS = {
  planning: 'Planning',
  communicatie: 'Communicatie',
  vierogencontrole: 'Vierogencontrole',
  opleverdossier: 'Opleverdossier',
  bevindingen: 'Bevindingen',
  herstel: 'Herstel',
  herhaling: 'Herhaling',
  onafhankelijke_keuringen: 'Onafhankelijke keuringen',
};

export default function ImprovementPlan() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState([]);
  const [themes, setThemes] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ period: '', theme: 'planning', metric_label: '', numerator: '', denominator: '', remark: '' });
  const [error, setError] = useState('');

  function load() {
    api.get('/improvement-metrics').then(setMetrics).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { api.get('/improvement-metrics/themes').then(setThemes).catch(() => {}); }, []);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/improvement-metrics', { ...form, numerator: Number(form.numerator), denominator: Number(form.denominator) });
      setForm({ ...form, metric_label: '', numerator: '', denominator: '', remark: '' });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const canManage = user?.role === 'beheerder' || user?.role === 'manager';
  const grouped = themes.map((t) => ({ theme: t, items: metrics.filter((m) => m.theme === t) }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Kwaliteit &amp; verbeterplan</h1>
          <p className="muted">Meetbare opvolging van de verbetermaatregelen richting Logchies/Eigen Haard.</p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Annuleren' : '+ Meting vastleggen'}
          </button>
        )}
      </div>

      {error && <div className="alert-error">{error}</div>}

      {showForm && (
        <form className="inline-form" onSubmit={handleAdd}>
          <div className="form-row">
            <label>Periode (bv. 2026-Q4)
              <input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} required />
            </label>
            <label>Thema
              <select value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>
                {themes.map((t) => <option key={t} value={t}>{THEME_LABELS[t] || t}</option>)}
              </select>
            </label>
          </div>
          <label>Omschrijving
            <input value={form.metric_label} onChange={(e) => setForm({ ...form, metric_label: e.target.value })} required />
          </label>
          <div className="form-row">
            <label>Teller
              <input type="number" value={form.numerator} onChange={(e) => setForm({ ...form, numerator: e.target.value })} required />
            </label>
            <label>Noemer
              <input type="number" value={form.denominator} onChange={(e) => setForm({ ...form, denominator: e.target.value })} required />
            </label>
          </div>
          <label>Toelichting
            <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
          </label>
          <button type="submit" className="btn-primary">Opslaan</button>
        </form>
      )}

      {grouped.map(({ theme, items }) => (
        <div key={theme}>
          <h2>{THEME_LABELS[theme] || theme}</h2>
          {items.length === 0 && <p className="muted">Nog geen metingen voor dit thema.</p>}
          <ul className="simple-list">
            {items.map((m) => (
              <li key={m.id}>
                <strong>{m.period}</strong> — {m.metric_label}: {m.numerator} / {m.denominator}
                {m.denominator > 0 && ` (${Math.round((m.numerator / m.denominator) * 100)}%)`}
                {m.remark && <div className="muted small">{m.remark}</div>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
