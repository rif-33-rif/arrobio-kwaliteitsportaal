import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const emptyForm = () => ({ type: '', value: '', unit: '', result: '', instrument: '', remark: '' });

export default function MeasurementsTab({ propertyId }) {
  const [measurements, setMeasurements] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');

  function load() {
    api.get(`/properties/${propertyId}/measurements`).then(setMeasurements).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [propertyId]);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/properties/${propertyId}/measurements`, form);
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
        <h2 style={{ marginTop: 0 }}>Metingen</h2>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Annuleren' : '+ Meting'}
        </button>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {showForm && (
        <form className="inline-form" onSubmit={handleAdd}>
          <div className="form-row">
            <label>Type meting
              <input value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} required placeholder="bv. Isolatieweerstand" />
            </label>
            <label>Meetwaarde
              <input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required />
            </label>
            <label>Eenheid
              <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="bv. MΩ" />
            </label>
          </div>
          <div className="form-row">
            <label>Resultaat
              <input value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} placeholder="bv. goed" />
            </label>
            <label>Meetinstrument
              <input value={form.instrument} onChange={(e) => setForm({ ...form, instrument: e.target.value })} />
            </label>
          </div>
          <label>Opmerking
            <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
          </label>
          <button type="submit" className="btn-primary">Opslaan</button>
        </form>
      )}

      <table className="data-table">
        <thead><tr><th>Type</th><th>Waarde</th><th>Resultaat</th><th>Datum</th><th>Door</th></tr></thead>
        <tbody>
          {measurements.map((m) => (
            <tr key={m.id}>
              <td>{m.type}</td>
              <td>{m.value} {m.unit}</td>
              <td>{m.result || '—'}</td>
              <td>{m.measured_at}</td>
              <td>{m.performed_by_name}</td>
            </tr>
          ))}
          {measurements.length === 0 && <tr><td colSpan={5} className="muted">Nog geen metingen.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
