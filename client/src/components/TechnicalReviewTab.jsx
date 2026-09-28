import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function TechnicalReviewTab({ propertyId, propertyStatus, onChanged }) {
  const { user } = useAuth();
  const [reviews, setReviews] = useState([]);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [missing, setMissing] = useState([]);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get(`/properties/${propertyId}/technical-reviews`).then(setReviews).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [propertyId]);

  const canReview = user?.role === 'controleur' && ['GEREED_VOOR_CONTROLE', 'GEREED_VOOR_HERCONTROLE'].includes(propertyStatus);

  async function handleReview(result) {
    setError('');
    setMissing([]);
    setBusy(true);
    try {
      await api.post(`/properties/${propertyId}/technical-reviews`, { remarks, result });
      setRemarks('');
      load();
      onChanged?.();
    } catch (err) {
      if (err.missing) setMissing(err.missing);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Tweede controle</h2>

      {error && <div className="alert-error">{error}</div>}
      {missing.length > 0 && (
        <div className="alert-warning">
          <ul>{missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}

      {canReview && (
        <div className="inline-form">
          <label>Opmerkingen
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </label>
          <div className="form-row">
            <button className="btn-big btn-done" disabled={busy} onClick={() => handleReview('goedgekeurd')}>GOEDGEKEURD</button>
            <button className="btn-big btn-reject" disabled={busy} onClick={() => handleReview('herstel_nodig')}>HERSTEL NODIG</button>
          </div>
        </div>
      )}
      {!canReview && user?.role !== 'controleur' && (
        <p className="muted">Alleen de rol Controleur kan de tweede controle uitvoeren.</p>
      )}
      {!canReview && user?.role === 'controleur' && (
        <p className="muted">Deze woning staat momenteel niet klaar voor controle (status: {propertyStatus}).</p>
      )}

      <h2>Historie</h2>
      <ul className="simple-list">
        {reviews.map((r) => (
          <li key={r.id} className={r.invalidated ? 'row-warning' : ''}>
            <strong>{r.result}</strong> — {r.reviewer_name} — {r.created_at}
            {r.remarks && <div>{r.remarks}</div>}
            {r.invalidated ? <div className="muted small">Ongeldig gemaakt: {r.invalidated_reason}</div> : null}
          </li>
        ))}
        {reviews.length === 0 && <li className="muted">Nog geen controles uitgevoerd.</li>}
      </ul>
    </div>
  );
}
