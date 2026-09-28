import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function ChecklistAdmin() {
  const [checklists, setChecklists] = useState([]);
  const [newItemText, setNewItemText] = useState({});
  const [error, setError] = useState('');

  function load() {
    api.get('/checklists').then(setChecklists).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, []);

  async function toggleActive(checklist) {
    try {
      await api.put(`/checklists/${checklist.id}`, { active: !checklist.active });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addItem(checklistId) {
    const text = (newItemText[checklistId] || '').trim();
    if (!text) return;
    try {
      await api.post(`/checklists/${checklistId}/items`, { text });
      setNewItemText({ ...newItemText, [checklistId]: '' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeItem(checklistId, itemId) {
    try {
      await api.del(`/checklists/${checklistId}/items/${itemId}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h1>Checklists beheren</h1>
      {error && <div className="alert-error">{error}</div>}

      {checklists.map((c) => (
        <div key={c.id} className="inline-form">
          <div className="page-header">
            <h2 style={{ marginTop: 0 }}>{c.name}</h2>
            <button className="btn-secondary" onClick={() => toggleActive(c)}>
              {c.active ? 'Actief — deactiveren' : 'Inactief — activeren'}
            </button>
          </div>
          <ul className="simple-list">
            {c.items.map((item) => (
              <li key={item.id} className="list-item-row">
                {item.text}
                <button className="btn-link" onClick={() => removeItem(c.id, item.id)}>Verwijderen</button>
              </li>
            ))}
            {c.items.length === 0 && <li className="muted">Nog geen items.</li>}
          </ul>
          <div className="form-row">
            <input
              placeholder="Nieuw checklistitem..."
              value={newItemText[c.id] || ''}
              onChange={(e) => setNewItemText({ ...newItemText, [c.id]: e.target.value })}
            />
            <button className="btn-primary" onClick={() => addItem(c.id)}>+ Item toevoegen</button>
          </div>
        </div>
      ))}
    </div>
  );
}
