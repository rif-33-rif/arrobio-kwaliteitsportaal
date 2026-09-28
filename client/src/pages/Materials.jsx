import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Materials() {
  const { user } = useAuth();
  const [materials, setMaterials] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', sku: '', unit: 'stuk', stock_quantity: 0, min_stock: 0 });
  const [adjustments, setAdjustments] = useState({});
  const [error, setError] = useState('');

  const canManage = user?.role === 'beheerder' || user?.role === 'manager';

  function load() {
    api.get('/materials').then(setMaterials).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/materials', {
        ...form,
        stock_quantity: Number(form.stock_quantity) || 0,
        min_stock: Number(form.min_stock) || 0,
      });
      setForm({ name: '', sku: '', unit: 'stuk', stock_quantity: 0, min_stock: 0 });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAdjust(materialId) {
    setError('');
    const draft = adjustments[materialId];
    const change = Number(draft?.change);
    if (!change || !draft?.reason) {
      setError('Vul een mutatie (aantal, mag negatief) en een reden in');
      return;
    }
    try {
      await api.post(`/materials/${materialId}/adjustments`, { change, reason: draft.reason });
      setAdjustments({ ...adjustments, [materialId]: { change: '', reason: '' } });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Materiaal</h1>
          <p className="muted">Materiaalcatalogus met voorraadbewaking. Verbruik wordt per werkzaamheid geregistreerd (tabblad Werkzaamheden).</p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Annuleren' : '+ Nieuw materiaal'}
          </button>
        )}
      </div>

      {error && <div className="alert-error">{error}</div>}

      {showForm && (
        <form className="inline-form" onSubmit={handleAdd}>
          <div className="form-row">
            <label>Naam
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>SKU/artikelnr.
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </label>
          </div>
          <div className="form-row">
            <label>Eenheid
              <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </label>
            <label>Startvoorraad
              <input type="number" value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })} />
            </label>
            <label>Minimumvoorraad
              <input type="number" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} />
            </label>
          </div>
          <button type="submit" className="btn-primary">Opslaan</button>
        </form>
      )}

      <table className="data-table">
        <thead>
          <tr><th>Naam</th><th>SKU</th><th>Voorraad</th><th>Minimum</th>{canManage && <th>Voorraad aanpassen</th>}</tr>
        </thead>
        <tbody>
          {materials.map((m) => (
            <tr key={m.id} className={m.stock_quantity <= m.min_stock ? 'row-warning' : ''}>
              <td>{m.name}</td>
              <td>{m.sku || '—'}</td>
              <td>{m.stock_quantity} {m.unit}</td>
              <td>{m.min_stock} {m.unit}</td>
              {canManage && (
                <td>
                  <div className="form-row" style={{ minWidth: 320 }}>
                    <input
                      type="number"
                      placeholder="+/- aantal"
                      value={adjustments[m.id]?.change || ''}
                      onChange={(e) => setAdjustments({ ...adjustments, [m.id]: { ...adjustments[m.id], change: e.target.value } })}
                    />
                    <input
                      placeholder="Reden"
                      value={adjustments[m.id]?.reason || ''}
                      onChange={(e) => setAdjustments({ ...adjustments, [m.id]: { ...adjustments[m.id], reason: e.target.value } })}
                    />
                    <button type="button" className="btn-secondary" onClick={() => handleAdjust(m.id)}>Toepassen</button>
                  </div>
                </td>
              )}
            </tr>
          ))}
          {materials.length === 0 && <tr><td colSpan={canManage ? 5 : 4} className="muted">Nog geen materiaal in de catalogus.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
