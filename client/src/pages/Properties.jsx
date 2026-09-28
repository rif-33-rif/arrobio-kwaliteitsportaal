import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const STATUS_FILTERS = [
  ['', 'Alle'],
  ['NIEUW', 'Nieuw'],
  ['GEPLAND', 'Gepland'],
  ['IN_UITVOERING', 'In uitvoering'],
  ['GEREED_VOOR_CONTROLE', 'Gereed voor controle'],
  ['HERSTEL_NODIG', 'Herstel nodig'],
  ['GEREED_VOOR_HERCONTROLE', 'Hercontrole'],
  ['TECHNISCH_GOEDGEKEURD', 'Technisch goedgekeurd'],
  ['MANAGERCONTROLE', 'Managercontrole'],
  ['VRIJGEGEVEN', 'Vrijgegeven'],
  ['GEANNULEERD', 'Geannuleerd'],
];

const emptyForm = () => ({
  opdrachtgever: 'Eigen Haard', project: '', werkbonnummer: '', address: '', huisnummer: '', toevoeging: '',
  postcode: '', plaats: '', datum_opdracht: '', startdatum: '', geplande_opleverdatum: '', omschrijving: '', bijzonderheden: '',
});

export default function Properties() {
  const { user } = useAuth();
  const [properties, setProperties] = useState([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');

  function load() {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    api.get(`/properties?${params.toString()}`).then(setProperties).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [status]);

  function handleSearch(e) {
    e.preventDefault();
    load();
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/properties', form);
      setForm(emptyForm());
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const canCreate = user?.role === 'beheerder' || user?.role === 'manager';

  return (
    <div>
      <div className="page-header">
        <h1>Woningen</h1>
        {canCreate && (
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Annuleren' : '+ Nieuwe woning'}
          </button>
        )}
      </div>

      {error && <div className="alert-error">{error}</div>}

      {showForm && (
        <form className="inline-form" onSubmit={handleAdd}>
          <div className="form-row">
            <label>Opdrachtgever
              <input value={form.opdrachtgever} onChange={(e) => setForm({ ...form, opdrachtgever: e.target.value })} required />
            </label>
            <label>Project
              <input value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} />
            </label>
            <label>Werkbonnummer
              <input value={form.werkbonnummer} onChange={(e) => setForm({ ...form, werkbonnummer: e.target.value })} required />
            </label>
          </div>
          <div className="form-row">
            <label>Adres
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required />
            </label>
            <label>Huisnummer
              <input value={form.huisnummer} onChange={(e) => setForm({ ...form, huisnummer: e.target.value })} />
            </label>
            <label>Toevoeging
              <input value={form.toevoeging} onChange={(e) => setForm({ ...form, toevoeging: e.target.value })} />
            </label>
          </div>
          <div className="form-row">
            <label>Postcode
              <input value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })} />
            </label>
            <label>Plaats
              <input value={form.plaats} onChange={(e) => setForm({ ...form, plaats: e.target.value })} />
            </label>
          </div>
          <div className="form-row">
            <label>Datum opdracht
              <input type="date" value={form.datum_opdracht} onChange={(e) => setForm({ ...form, datum_opdracht: e.target.value })} />
            </label>
            <label>Startdatum
              <input type="date" value={form.startdatum} onChange={(e) => setForm({ ...form, startdatum: e.target.value })} />
            </label>
            <label>Geplande opleverdatum
              <input type="date" value={form.geplande_opleverdatum} onChange={(e) => setForm({ ...form, geplande_opleverdatum: e.target.value })} required />
            </label>
          </div>
          <label>Omschrijving werkzaamheden
            <textarea value={form.omschrijving} onChange={(e) => setForm({ ...form, omschrijving: e.target.value })} />
          </label>
          <label>Bijzonderheden
            <textarea value={form.bijzonderheden} onChange={(e) => setForm({ ...form, bijzonderheden: e.target.value })} />
          </label>
          <button type="submit" className="btn-primary">Opslaan</button>
        </form>
      )}

      <form className="search-bar" onSubmit={handleSearch}>
        <input placeholder="Zoek op adres, postcode, werkbonnummer of medewerker..." value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit">Zoeken</button>
      </form>

      <div className="filter-bar filter-pills">
        {STATUS_FILTERS.map(([value, label]) => (
          <button
            key={value}
            className={`pill ${status === value ? 'pill-active' : ''}`}
            onClick={() => setStatus(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Adres</th><th>Werkbon</th><th>Opdrachtgever</th><th>Monteur</th><th>Geplande oplevering</th>
            <th>Bevindingen</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {properties.map((p) => {
            const monteur = p.assignments.find((a) => a.role_in_property === 'monteur');
            return (
              <tr key={p.id}>
                <td><Link to={`/woningen/${p.id}`}>{p.address} {p.huisnummer}</Link><div className="muted">{p.postcode} {p.plaats}</div></td>
                <td>{p.werkbonnummer}</td>
                <td>{p.opdrachtgever}</td>
                <td>{monteur?.user_name || '—'}</td>
                <td>{p.geplande_opleverdatum}</td>
                <td>{p.openFindings > 0 ? <span className="badge badge-warning">{p.openFindings}</span> : '—'}</td>
                <td><span className="badge">{p.status}</span></td>
              </tr>
            );
          })}
          {properties.length === 0 && (
            <tr><td colSpan={7} className="muted">Geen woningen gevonden.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
