import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

export default function AuditTrail() {
  const [events, setEvents] = useState([]);
  const [actions, setActions] = useState([]);
  const [filters, setFilters] = useState({ action: '', date_from: '', date_to: '' });
  const [error, setError] = useState('');

  function load() {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    api.get(`/audit-events?${params.toString()}`).then(setEvents).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [filters]);
  useEffect(() => { api.get('/audit-events/actions').then(setActions).catch(() => {}); }, []);

  return (
    <div>
      <h1>Audittrail</h1>
      <p className="muted">Volledige, systeembrede logging van kritieke acties. Niet verwijderbaar door reguliere gebruikers.</p>

      {error && <div className="alert-error">{error}</div>}

      <div className="filter-bar form-row">
        <label>Actie
          <select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
            <option value="">Alle</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>Vanaf
          <input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
        </label>
        <label>Tot
          <input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
        </label>
      </div>

      <table className="data-table">
        <thead><tr><th>Datum/tijd</th><th>Actie</th><th>Woning</th><th>Gebruiker</th><th>Van → naar</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{e.created_at}</td>
              <td>{e.action}</td>
              <td>{e.property_id ? <Link to={`/woningen/${e.property_id}`}>{e.address} {e.huisnummer} ({e.werkbonnummer})</Link> : '—'}</td>
              <td>{e.user_name || '—'}</td>
              <td>{e.from_status ? `${e.from_status} → ${e.to_status}` : '—'}</td>
            </tr>
          ))}
          {events.length === 0 && <tr><td colSpan={5} className="muted">Geen gebeurtenissen gevonden.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
