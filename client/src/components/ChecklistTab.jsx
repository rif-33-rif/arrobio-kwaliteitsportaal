import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const ANSWER_LABELS = { akkoord: 'Akkoord', niet_akkoord: 'Niet akkoord', nvt: 'N.v.t.' };

export default function ChecklistTab({ propertyId }) {
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');

  function load() {
    api.get(`/properties/${propertyId}/checklist`).then((d) => {
      setData(d);
      const initialDrafts = {};
      d.items.forEach((i) => {
        initialDrafts[i.checklist_item_id] = {
          answer: i.answer || '',
          description: i.description || '',
          herstelactie: i.herstelactie || '',
        };
      });
      setDrafts(initialDrafts);
    }).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [propertyId]);

  function updateDraft(itemId, field, value) {
    setDrafts({ ...drafts, [itemId]: { ...drafts[itemId], [field]: value } });
  }

  async function handleSave(itemId) {
    setError('');
    try {
      const saved = await api.put(`/properties/${propertyId}/checklist/${itemId}`, drafts[itemId]);
      setData((prev) => ({
        ...prev,
        items: prev.items.map((i) => (i.checklist_item_id === itemId ? { ...i, ...saved } : i)),
      }));
    } catch (err) {
      setError(err.message);
    }
  }

  if (error) return <div className="alert-error">{error}</div>;
  if (!data) return <p>Laden...</p>;
  if (!data.checklist) return <p className="muted">Geen actieve checklist geconfigureerd.</p>;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{data.checklist.name}</h2>
      <ul className="checklist">
        {data.items.map((item) => {
          const draft = drafts[item.checklist_item_id] || { answer: '', description: '', herstelactie: '' };
          const isSaved = item.answer === draft.answer && (draft.answer !== 'niet_akkoord' || (item.description === draft.description && item.herstelactie === draft.herstelactie));
          return (
            <li key={item.checklist_item_id} className="checklist-item">
              <div className="checklist-item-text">{item.text}</div>
              <div className="checklist-answers">
                {['akkoord', 'niet_akkoord', 'nvt'].map((a) => (
                  <button
                    key={a}
                    className={`pill answer-pill answer-${a} ${draft.answer === a ? 'pill-active' : ''}`}
                    onClick={() => updateDraft(item.checklist_item_id, 'answer', a)}
                    type="button"
                  >
                    {ANSWER_LABELS[a]}
                  </button>
                ))}
              </div>
              {draft.answer === 'niet_akkoord' && (
                <div className="checklist-details">
                  <label>Omschrijving (verplicht)
                    <input value={draft.description} onChange={(e) => updateDraft(item.checklist_item_id, 'description', e.target.value)} />
                  </label>
                  <label>Herstelactie (verplicht)
                    <input value={draft.herstelactie} onChange={(e) => updateDraft(item.checklist_item_id, 'herstelactie', e.target.value)} />
                  </label>
                </div>
              )}
              {draft.answer && (
                <button className="btn-secondary" disabled={isSaved} onClick={() => handleSave(item.checklist_item_id)}>
                  {isSaved ? 'Opgeslagen' : 'Opslaan'}
                </button>
              )}
              {item.filled_by_name && (
                <div className="muted small">Laatst ingevuld door {item.filled_by_name} op {item.filled_at}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
