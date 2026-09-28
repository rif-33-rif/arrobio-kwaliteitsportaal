import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const ROLES = ['beheerder', 'manager', 'controleur', 'monteur', 'leerling'];

export default function Users() {
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role_code: 'monteur', function: '', vakbekwaam: true });
  const [error, setError] = useState('');

  function load() {
    api.get('/users').then(setUsers).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/users', form);
      setForm({ name: '', email: '', password: '', role_code: 'monteur', function: '', vakbekwaam: true });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleActive(u) {
    try {
      await api.put(`/users/${u.id}`, { active: !u.active });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Gebruikers</h1>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Annuleren' : '+ Nieuwe gebruiker'}
        </button>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {showForm && (
        <form className="inline-form" onSubmit={handleAdd}>
          <div className="form-row">
            <label>Naam
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>Functie
              <input value={form.function} onChange={(e) => setForm({ ...form, function: e.target.value })} />
            </label>
          </div>
          <div className="form-row">
            <label>E-mail
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </label>
            <label>Wachtwoord
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </label>
          </div>
          <div className="form-row">
            <label>Rol
              <select value={form.role_code} onChange={(e) => setForm({ ...form, role_code: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label>Vakbekwaam
              <select value={form.vakbekwaam ? 'ja' : 'nee'} onChange={(e) => setForm({ ...form, vakbekwaam: e.target.value === 'ja' })}>
                <option value="ja">Ja</option>
                <option value="nee">Nee</option>
              </select>
            </label>
          </div>
          <button type="submit" className="btn-primary">Opslaan</button>
        </form>
      )}

      <table className="data-table">
        <thead><tr><th>Naam</th><th>E-mail</th><th>Rol</th><th>Functie</th><th>Vakbekwaam</th><th>Actief</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.role_code}</td>
              <td>{u.function || '—'}</td>
              <td>{u.vakbekwaam ? 'Ja' : 'Nee'}</td>
              <td>
                <button className="btn-link" onClick={() => toggleActive(u)}>
                  {u.active ? 'Ja — blokkeren' : 'Nee — deblokkeren'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
