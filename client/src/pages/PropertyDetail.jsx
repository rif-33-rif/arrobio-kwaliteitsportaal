import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import WorkItemsTab from '../components/WorkItemsTab.jsx';
import ChecklistTab from '../components/ChecklistTab.jsx';
import MeasurementsTab from '../components/MeasurementsTab.jsx';
import PhotosTab from '../components/PhotosTab.jsx';
import FindingsTab from '../components/FindingsTab.jsx';
import TechnicalReviewTab from '../components/TechnicalReviewTab.jsx';
import ManagerControlTab from '../components/ManagerControlTab.jsx';
import DocumentsTab from '../components/DocumentsTab.jsx';

const TABS = [
  { key: 'overzicht', label: 'Overzicht', phase: 1 },
  { key: 'planning', label: 'Planning', phase: 1 },
  { key: 'toewijzing', label: 'Toewijzing', phase: 1 },
  { key: 'werkzaamheden', label: 'Werkzaamheden', phase: 1 },
  { key: 'checklist', label: 'Checklist', phase: 1 },
  { key: 'metingen', label: 'Metingen', phase: 1 },
  { key: 'fotos', label: "Foto's", phase: 1 },
  { key: 'bevindingen', label: 'Bevindingen', phase: 1 },
  { key: 'herstel', label: 'Herstel', phase: 1 },
  { key: 'tweede_controle', label: 'Tweede controle', phase: 1 },
  { key: 'managercontrole', label: 'Managercontrole', phase: 1 },
  { key: 'documenten', label: 'Documenten', phase: 1 },
  { key: 'audittrail', label: 'Audittrail', phase: 1 },
];

// Deze twee overgangen zijn de enige die een reguliere gebruiker handmatig mag
// kiezen (plannen/annuleren). Alle overgangen die een kwaliteitscontrole
// vertegenwoordigen lopen via de gerichte knoppen/tabs (start werk, gereedmelding,
// tweede controle, hercontrole, managercontrole, vrijgave, heropening).
const STATUS_OPTIONS = {
  NIEUW: ['GEPLAND', 'GEANNULEERD'],
  GEPLAND: ['GEANNULEERD'],
  IN_UITVOERING: ['GEANNULEERD'],
};

const ROLES_FOR_ASSIGNMENT = ['monteur', 'leerling', 'controleur', 'manager'];

export default function PropertyDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [property, setProperty] = useState(null);
  const [users, setUsers] = useState([]);
  const [tab, setTab] = useState('overzicht');
  const [error, setError] = useState('');
  const [planningForm, setPlanningForm] = useState({ field: 'actuele_opleverdatum', new_value: '', reason: '' });
  const [assignForm, setAssignForm] = useState({ user_id: '', role_in_property: 'monteur' });
  const [missing, setMissing] = useState([]);
  const [busy, setBusy] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  function load() {
    api.get(`/properties/${id}`).then(setProperty).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    if (user?.role === 'beheerder' || user?.role === 'manager') {
      api.get('/users').then(setUsers).catch(() => {});
    }
  }, [user]);

  const canManage = user?.role === 'beheerder' || user?.role === 'manager';
  const canWork = ['beheerder', 'manager', 'monteur', 'leerling'].includes(user?.role);

  async function handleStartWerk() {
    setError('');
    setBusy(true);
    try {
      await api.post(`/properties/${id}/start-werk`, {});
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleGereedmelding() {
    setError('');
    setMissing([]);
    setBusy(true);
    try {
      await api.post(`/properties/${id}/gereedmelding`, {});
      load();
    } catch (err) {
      if (err.missing) {
        setMissing(err.missing);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleHercontroleAanvragen() {
    setError('');
    setMissing([]);
    setBusy(true);
    try {
      await api.post(`/properties/${id}/hercontrole-gereedmelding`, {});
      load();
    } catch (err) {
      if (err.missing) setMissing(err.missing);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleHeropenen(e) {
    e.preventDefault();
    setError('');
    const reason = reopenReason.trim();
    if (!reason) {
      setError('Reden voor heropening is verplicht');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/properties/${id}/heropenen`, { reason });
      setReopenReason('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(newStatus) {
    setError('');
    try {
      await api.put(`/properties/${id}/status`, { status: newStatus });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handlePlanningSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await api.put(`/properties/${id}/planning`, planningForm);
      setPlanningForm({ ...planningForm, new_value: '', reason: '' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAssignSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/properties/${id}/assignments`, assignForm);
      setAssignForm({ user_id: '', role_in_property: 'monteur' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !property) return <div className="alert-error">{error}</div>;
  if (!property) return <p>Laden...</p>;

  return (
    <div>
      <p><Link to="/woningen">&larr; Terug naar woningen</Link></p>
      <div className="page-header">
        <div>
          <h1>{property.address} {property.huisnummer}</h1>
          <p className="muted">{property.postcode} {property.plaats} — {property.werkbonnummer} — {property.opdrachtgever}</p>
        </div>
        <span className="badge badge-large">{property.status}</span>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {missing.length > 0 && (
        <div className="alert-warning">
          <strong>Gereedmelding niet mogelijk — dit ontbreekt nog:</strong>
          <ul>
            {missing.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      {canWork && ['GEPLAND', 'IN_UITVOERING', 'HERSTEL_NODIG'].includes(property.status) && (
        <div className="big-action-bar">
          {property.status === 'GEPLAND' && (
            <button className="btn-big btn-start" onClick={handleStartWerk} disabled={busy}>START WERK</button>
          )}
          {property.status === 'IN_UITVOERING' && (
            <button className="btn-big btn-done" onClick={handleGereedmelding} disabled={busy}>GEREED MELDEN</button>
          )}
          {property.status === 'HERSTEL_NODIG' && (
            <button className="btn-big btn-done" onClick={handleHercontroleAanvragen} disabled={busy}>HERCONTROLE AANVRAGEN</button>
          )}
        </div>
      )}

      {canManage && STATUS_OPTIONS[property.status]?.length > 0 && (
        <div className="status-actions">
          <span className="muted">Status wijzigen naar:</span>
          {STATUS_OPTIONS[property.status].map((s) => (
            <button key={s} className="btn-secondary" onClick={() => handleStatusChange(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? 'tab-active' : ''} ${t.phase > 1 ? 'tab-future' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}{t.phase > 1 && <span className="tab-phase"> (fase {t.phase})</span>}
          </button>
        ))}
      </div>

      {tab === 'overzicht' && (
        <div className="tab-panel">
          <h2>Omschrijving</h2>
          <p>{property.omschrijving || <span className="muted">Geen omschrijving</span>}</p>
          <h2>Bijzonderheden</h2>
          <p>{property.bijzonderheden || <span className="muted">Geen bijzonderheden</span>}</p>
          <h2>Toegewezen medewerkers</h2>
          <ul className="simple-list">
            {property.assignments.map((a) => (
              <li key={a.id}>{a.role_in_property}: {a.user_name}</li>
            ))}
            {property.assignments.length === 0 && <li className="muted">Nog niemand toegewezen.</li>}
          </ul>
          {property.openFindings > 0 && (
            <p className="alert-warning">{property.openFindings} openstaande bevinding(en) — zie tabblad Bevindingen.</p>
          )}
          {canManage && property.status === 'VRIJGEGEVEN' && (
            <form className="inline-form" onSubmit={handleHeropenen}>
              <h3>Formele heropening</h3>
              <p className="muted">Deze woning is definitief vrijgegeven. Wijzigen kan alleen na een formele, verplicht beargumenteerde heropening.</p>
              <label>Reden (verplicht)
                <input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
              </label>
              <button type="submit" className="btn-secondary" disabled={busy}>Heropenen</button>
            </form>
          )}
        </div>
      )}

      {tab === 'planning' && (
        <div className="tab-panel">
          <table className="data-table">
            <tbody>
              <tr><th>Datum opdracht</th><td>{property.datum_opdracht || '—'}</td></tr>
              <tr><th>Startdatum</th><td>{property.startdatum || '—'}</td></tr>
              <tr><th>Oorspronkelijke geplande opleverdatum</th><td><strong>{property.geplande_opleverdatum}</strong> <span className="muted">(onwijzigbaar)</span></td></tr>
              <tr><th>Actuele opleverdatum</th><td>{property.actuele_opleverdatum}</td></tr>
              <tr><th>Werkelijke opleverdatum</th><td>{property.werkelijke_opleverdatum || '—'}</td></tr>
            </tbody>
          </table>

          {canManage && (
            <form className="inline-form" onSubmit={handlePlanningSubmit}>
              <h3>Planning wijzigen</h3>
              <div className="form-row">
                <label>Veld
                  <select value={planningForm.field} onChange={(e) => setPlanningForm({ ...planningForm, field: e.target.value })}>
                    <option value="startdatum">Startdatum</option>
                    <option value="actuele_opleverdatum">Actuele opleverdatum</option>
                    <option value="werkelijke_opleverdatum">Werkelijke opleverdatum</option>
                  </select>
                </label>
                <label>Nieuwe datum
                  <input type="date" value={planningForm.new_value} onChange={(e) => setPlanningForm({ ...planningForm, new_value: e.target.value })} required />
                </label>
              </div>
              <label>Reden van wijziging (verplicht)
                <input value={planningForm.reason} onChange={(e) => setPlanningForm({ ...planningForm, reason: e.target.value })} required />
              </label>
              <button type="submit" className="btn-primary">Wijziging vastleggen</button>
            </form>
          )}

          <h2>Wijzigingshistorie</h2>
          <ul className="simple-list">
            {property.planningChanges.map((c) => (
              <li key={c.id}>
                <strong>{c.field}</strong>: {c.old_value || '—'} &rarr; {c.new_value} — <em>{c.reason}</em>
                <div className="muted">{c.changed_at} door {c.changed_by_name}</div>
              </li>
            ))}
            {property.planningChanges.length === 0 && <li className="muted">Nog geen wijzigingen.</li>}
          </ul>
        </div>
      )}

      {tab === 'toewijzing' && (
        <div className="tab-panel">
          <ul className="simple-list">
            {property.assignments.map((a) => (
              <li key={a.id}>{a.role_in_property}: {a.user_name}</li>
            ))}
          </ul>
          {canManage && (
            <form className="inline-form" onSubmit={handleAssignSubmit}>
              <h3>Toewijzen</h3>
              <div className="form-row">
                <label>Rol
                  <select value={assignForm.role_in_property} onChange={(e) => setAssignForm({ ...assignForm, role_in_property: e.target.value })}>
                    {ROLES_FOR_ASSIGNMENT.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                <label>Medewerker
                  <select value={assignForm.user_id} onChange={(e) => setAssignForm({ ...assignForm, user_id: e.target.value })} required>
                    <option value="">Kies medewerker...</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role_code})</option>)}
                  </select>
                </label>
              </div>
              <button type="submit" className="btn-primary">Toewijzen</button>
            </form>
          )}
        </div>
      )}

      {tab === 'werkzaamheden' && (
        <div className="tab-panel"><WorkItemsTab propertyId={id} /></div>
      )}
      {tab === 'checklist' && (
        <div className="tab-panel"><ChecklistTab propertyId={id} /></div>
      )}
      {tab === 'metingen' && (
        <div className="tab-panel"><MeasurementsTab propertyId={id} /></div>
      )}
      {tab === 'fotos' && (
        <div className="tab-panel"><PhotosTab propertyId={id} /></div>
      )}

      {tab === 'bevindingen' && (
        <div className="tab-panel"><FindingsTab propertyId={id} mode="all" /></div>
      )}
      {tab === 'herstel' && (
        <div className="tab-panel"><FindingsTab propertyId={id} mode="repair-focus" /></div>
      )}
      {tab === 'tweede_controle' && (
        <div className="tab-panel"><TechnicalReviewTab propertyId={id} propertyStatus={property.status} onChanged={load} /></div>
      )}
      {tab === 'managercontrole' && (
        <div className="tab-panel"><ManagerControlTab propertyId={id} propertyStatus={property.status} onChanged={load} /></div>
      )}

      {tab === 'documenten' && (
        <div className="tab-panel"><DocumentsTab propertyId={id} /></div>
      )}

      {tab === 'audittrail' && (
        <div className="tab-panel">
          <ul className="simple-list">
            {property.auditEvents.map((e) => (
              <li key={e.id}>
                <span className="muted">{e.created_at}</span> — <strong>{e.action}</strong>
                {e.from_status && <span> ({e.from_status} &rarr; {e.to_status})</span>}
                {e.user_name && <span className="muted"> door {e.user_name}</span>}
              </li>
            ))}
            {property.auditEvents.length === 0 && <li className="muted">Nog geen gebeurtenissen.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
