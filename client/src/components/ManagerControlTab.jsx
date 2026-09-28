import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function ManagerControlTab({ propertyId, propertyStatus, onChanged }) {
  const { user } = useAuth();
  const [reviews, setReviews] = useState([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api.get(`/properties/${propertyId}/manager-reviews`).then(setReviews).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [propertyId]);

  const canManage = user?.role === 'manager' || user?.role === 'beheerder';

  async function handleStart() {
    setError('');
    setBusy(true);
    try {
      await api.post(`/properties/${propertyId}/managercontrole-starten`, {});
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDecision(result) {
    setError('');
    if (result === 'teruggestuurd' && !reason) {
      setError('Reden is verplicht bij terugsturen');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/properties/${propertyId}/manager-reviews`, { result, reason });
      setReason('');
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Managercontrole</h2>
      {error && <div className="alert-error">{error}</div>}

      {!canManage && <p className="muted">Alleen Manager of Beheerder kan de managercontrole uitvoeren.</p>}

      {canManage && propertyStatus === 'TECHNISCH_GOEDGEKEURD' && (
        <button className="btn-big btn-start" disabled={busy} onClick={handleStart}>MANAGERCONTROLE STARTEN</button>
      )}

      {canManage && propertyStatus === 'MANAGERCONTROLE' && (
        <div className="inline-form">
          <label>Reden (verplicht bij terugsturen)
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="form-row">
            <button className="btn-big btn-done" disabled={busy} onClick={() => handleDecision('vrijgegeven')}>VRIJGEVEN</button>
            <button className="btn-big btn-reject" disabled={busy} onClick={() => handleDecision('teruggestuurd')}>TERUGSTUREN</button>
          </div>
        </div>
      )}

      {canManage && !['TECHNISCH_GOEDGEKEURD', 'MANAGERCONTROLE'].includes(propertyStatus) && (
        <p className="muted">Managercontrole is beschikbaar zodra de woning technisch is goedgekeurd (huidige status: {propertyStatus}).</p>
      )}

      <h2>Historie</h2>
      <ul className="simple-list">
        {reviews.map((r) => (
          <li key={r.id}>
            <strong>{r.result}</strong> — {r.manager_name} — {r.created_at} (dossierversie {r.dossier_version})
            {r.reason && <div>Reden: {r.reason}</div>}
          </li>
        ))}
        {reviews.length === 0 && <li className="muted">Nog geen managerbeslissingen.</li>}
      </ul>
    </div>
  );
}
