import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const CATEGORIES = [
  'Groepenkast', 'Wandcontactdozen', 'Schakelaars', 'Verlichting', 'Bedrading', 'Aarding',
  'Keuken', 'Badkamer', 'CV/technische ruimte', 'Rookmelders', 'Herstelwerk', 'Overig',
];

// Ruimtes zoals op het papieren opdrachtformulier van Arrobio Techniek.
const RUIMTES = [
  ['alg', 'Algemeen'], ['wnk', 'Woonkamer'], ['slp1', 'Slaapkamer 1'], ['slp2', 'Slaapkamer 2'],
  ['slp3', 'Slaapkamer 3'], ['slp4', 'Slaapkamer 4'], ['K', 'Keuken'], ['bdk', 'Badkamer'],
  ['t', 'Toilet'], ['hal', 'Hal'], ['ber', 'Berging'], ['overl', 'Overloop'], ['zold', 'Zolder'], ['tuin', 'Tuin'],
];

const EENHEDEN = ['stu', 'p/st', 'm1', 'm2', 'p/u', 'won', '/won'];

const emptyForm = () => ({ category: CATEGORIES[0], description: '', remark: '', ruimte: RUIMTES[0][0], aantal: 1, eenheid: 'stu' });

function ruimteLabel(code) {
  return RUIMTES.find(([c]) => c === code)?.[1] || code;
}

function WorkItemCard({ propertyId, item, onChange, catalog }) {
  const [expanded, setExpanded] = useState(false);
  const [usage, setUsage] = useState([]);
  const [materialId, setMaterialId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState('');

  function loadUsage() {
    api.get(`/properties/${propertyId}/work-items/${item.id}/materials`).then(setUsage).catch((e) => setError(e.message));
  }

  useEffect(() => { if (expanded) loadUsage(); }, [expanded]);

  async function toggleStatus() {
    try {
      await api.put(`/properties/${propertyId}/work-items/${item.id}`, {
        status: item.status === 'afgerond' ? 'open' : 'afgerond',
      });
      onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddMaterial(e) {
    e.preventDefault();
    setError('');
    if (!materialId || !quantity) return;
    try {
      await api.post(`/properties/${propertyId}/work-items/${item.id}/materials`, { material_id: Number(materialId), quantity: Number(quantity) });
      setMaterialId('');
      setQuantity(1);
      loadUsage();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemoveMaterial(usageId) {
    setError('');
    try {
      await api.del(`/properties/${propertyId}/work-items/${item.id}/materials/${usageId}`);
      loadUsage();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <li className="list-item-row-wrap">
      <div className="list-item-row" onClick={() => setExpanded((v) => !v)} style={{ cursor: 'pointer' }}>
        <div>
          <strong>{item.category}</strong>
          {item.ruimte && <span className="badge">{ruimteLabel(item.ruimte)}</span>}
          {' — '}{item.description} ({item.aantal} {item.eenheid})
          {item.remark && <div className="muted">{item.remark}</div>}
          <div className="muted">{item.date} {item.executor_name && `— ${item.executor_name}`}</div>
        </div>
        <button
          className={`btn-secondary ${item.status === 'afgerond' ? 'btn-done' : ''}`}
          onClick={(e) => { e.stopPropagation(); toggleStatus(); }}
        >
          {item.status === 'afgerond' ? 'Afgerond ✓' : 'Markeer afgerond'}
        </button>
      </div>

      {expanded && (
        <div className="finding-details" onClick={(e) => e.stopPropagation()}>
          {error && <div className="alert-error">{error}</div>}
          <h4>Gebruikt materiaal</h4>
          <ul className="simple-list">
            {usage.map((u) => (
              <li key={u.id} className="list-item-row">
                <span>{u.name}: {u.quantity} {u.unit}</span>
                <button className="btn-link" onClick={() => handleRemoveMaterial(u.id)}>Verwijderen</button>
              </li>
            ))}
            {usage.length === 0 && <li className="muted">Nog geen materiaal geregistreerd.</li>}
          </ul>
          <form className="form-row" onSubmit={handleAddMaterial}>
            <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} required>
              <option value="">Kies materiaal...</option>
              {catalog.map((m) => <option key={m.id} value={m.id}>{m.name} (voorraad: {m.stock_quantity} {m.unit})</option>)}
            </select>
            <input type="number" step="0.1" min="0.1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            <button type="submit" className="btn-secondary">Toevoegen</button>
          </form>
        </div>
      )}
    </li>
  );
}

export default function WorkItemsTab({ propertyId }) {
  const [items, setItems] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [taskResults, setTaskResults] = useState([]);
  const [searching, setSearching] = useState(false);

  function load() {
    api.get(`/properties/${propertyId}/work-items`).then(setItems).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [propertyId]);
  useEffect(() => { api.get('/materials').then(setCatalog).catch(() => {}); }, []);

  useEffect(() => {
    if (!showForm || taskSearch.trim().length < 2) { setTaskResults([]); return; }
    setSearching(true);
    const timeout = setTimeout(() => {
      api.get(`/work-item-catalog?q=${encodeURIComponent(taskSearch)}`)
        .then(setTaskResults)
        .catch(() => setTaskResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [taskSearch, showForm]);

  function pickTask(task) {
    setForm({ ...form, description: task.description, eenheid: task.unit || form.eenheid });
    setTaskSearch('');
    setTaskResults([]);
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/properties/${propertyId}/work-items`, { ...form, aantal: Number(form.aantal) || 1 });
      setForm(emptyForm());
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2 style={{ marginTop: 0 }}>Werkzaamheden</h2>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Annuleren' : '+ Werkzaamheid'}
        </button>
      </div>

      {error && <div className="alert-error">{error}</div>}
      <p className="muted small">Klik op een werkzaamheid om gebruikt materiaal te registreren.</p>

      {showForm && (
        <form className="inline-form" onSubmit={handleAdd}>
          <label>Zoek in werkzaamhedencatalogus (optioneel, vult omschrijving + eenheid automatisch in)
            <input
              value={taskSearch}
              onChange={(e) => setTaskSearch(e.target.value)}
              placeholder="bv. aardlekschakelaar, wcd, groepenkast..."
            />
          </label>
          {searching && <p className="muted small">Zoeken...</p>}
          {taskResults.length > 0 && (
            <ul className="simple-list catalog-suggestions">
              {taskResults.slice(0, 8).map((t) => (
                <li key={t.id} className="list-item-row" style={{ cursor: 'pointer' }} onClick={() => pickTask(t)}>
                  <span>{t.code && <span className="muted small">[{t.code}] </span>}{t.description}</span>
                  <span className="muted small">{t.unit}{t.unit_price ? ` — €${t.unit_price.toFixed(2)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="form-row">
            <label>Categorie
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>Ruimte
              <select value={form.ruimte} onChange={(e) => setForm({ ...form, ruimte: e.target.value })}>
                {RUIMTES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </label>
          </div>
          <label>Omschrijving
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
          </label>
          <div className="form-row">
            <label>Aantal
              <input type="number" step="0.1" min="0" value={form.aantal} onChange={(e) => setForm({ ...form, aantal: e.target.value })} />
            </label>
            <label>Eenheid
              <input list="eenheden-opties" value={form.eenheid} onChange={(e) => setForm({ ...form, eenheid: e.target.value })} />
              <datalist id="eenheden-opties">
                {EENHEDEN.map((u) => <option key={u} value={u} />)}
              </datalist>
            </label>
          </div>
          <label>Opmerking
            <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
          </label>
          <button type="submit" className="btn-primary">Opslaan</button>
        </form>
      )}

      <ul className="simple-list">
        {items.map((item) => (
          <WorkItemCard key={item.id} propertyId={propertyId} item={item} onChange={load} catalog={catalog} />
        ))}
        {items.length === 0 && <li className="muted">Nog geen werkzaamheden geregistreerd.</li>}
      </ul>
    </div>
  );
}
