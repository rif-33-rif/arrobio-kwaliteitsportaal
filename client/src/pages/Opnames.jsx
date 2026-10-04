import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const today = () => new Date().toISOString().slice(0, 10);

function ProductAdmin() {
  const [products, setProducts] = useState([]);
  const [draft, setDraft] = useState({ description: '', unit: 'p/st' });
  const [error, setError] = useState('');

  const load = () => api.get('/opnames/products?all=1').then(setProducts).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/opnames/products', draft);
      setDraft({ description: '', unit: 'p/st' });
      load();
    } catch (err) { setError(err.message); }
  }

  async function save(product, changes) {
    setError('');
    try {
      await api.put(`/opnames/products/${product.id}`, changes);
      load();
    } catch (err) { setError(err.message); }
  }

  return (
    <div>
      <p className="muted">Dit zijn de regels die in de opname aanvinkbaar zijn. Uitgeschakelde regels verdwijnen uit nieuwe opnames; bestaande opnames houden ze.</p>
      {error && <div className="alert-error">{error}</div>}
      <form className="inline-form" onSubmit={add}>
        <div className="form-row">
          <label>Nieuwe regel
            <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} required />
          </label>
          <label style={{ maxWidth: 120 }}>Eenheid
            <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} required />
          </label>
        </div>
        <button type="submit" className="btn-primary">Regel toevoegen</button>
      </form>
      <ul className="simple-list">
        {products.map((p) => (
          <li key={p.id} className={p.active ? '' : 'product-inactive'}>
            <div className="list-item-row">
              <input
                defaultValue={p.description}
                style={{ flex: 1, minWidth: 220 }}
                onBlur={(e) => e.target.value.trim() && e.target.value !== p.description && save(p, { description: e.target.value })}
              />
              <input
                defaultValue={p.unit}
                style={{ width: 80 }}
                onBlur={(e) => e.target.value.trim() && e.target.value !== p.unit && save(p, { unit: e.target.value })}
              />
              <button type="button" className="btn-secondary" onClick={() => save(p, { active: !p.active })}>
                {p.active ? 'Uitschakelen' : 'Inschakelen'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Opnames() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [opnames, setOpnames] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showProducts, setShowProducts] = useState(false);
  const [form, setForm] = useState({ project: '', address: '', datum: today() });
  const [error, setError] = useState('');

  const canManage = user?.role === 'beheerder' || user?.role === 'manager';

  useEffect(() => {
    api.get('/opnames').then(setOpnames).catch((e) => setError(e.message));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      const created = await api.post('/opnames', form);
      navigate(`/opnames/${created.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Woningopnames</h1>
          <p className="muted">Loop een woning door, vul per ruimte de aantallen in en deel de opname.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Annuleren' : '+ Nieuwe opname'}
        </button>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {showForm && (
        <form className="inline-form" onSubmit={handleCreate}>
          <div className="form-row">
            <label>Project
              <input value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} required />
            </label>
            <label>Adres
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required />
            </label>
            <label>Datum
              <input type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value })} required />
            </label>
          </div>
          <button type="submit" className="btn-primary btn-large">Opname starten</button>
        </form>
      )}

      {opnames.length === 0 ? (
        <p className="muted">Nog geen opnames.</p>
      ) : (
        <ul className="simple-list">
          {opnames.map((o) => (
            <li key={o.id}>
              <Link to={`/opnames/${o.id}`} className="opname-link">
                <div className="list-item-row">
                  <div>
                    <strong>{o.address}</strong>
                    <div className="muted small">{o.project} &middot; {o.datum} &middot; {o.created_by_name || 'onbekend'}</div>
                  </div>
                  <div>
                    <span className="badge">{o.line_count} regels</span>
                    <span className={`badge ${o.status === 'afgerond' ? 'badge-done' : 'badge-warning'}`}>
                      {o.status === 'afgerond' ? 'Afgerond' : 'Concept'}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div style={{ marginTop: '2rem' }}>
          <button className="btn-secondary" onClick={() => setShowProducts((v) => !v)}>
            {showProducts ? 'Opnamelijst verbergen' : 'Opnamelijst beheren'}
          </button>
          {showProducts && <ProductAdmin />}
        </div>
      )}
    </div>
  );
}
