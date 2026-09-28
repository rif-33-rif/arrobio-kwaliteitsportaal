import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

function Fraction({ label, value }) {
  const pct = value.noemer > 0 ? Math.round((value.teller / value.noemer) * 100) : null;
  return (
    <div className="stat-card">
      <div className="stat-value">{value.teller} / {value.noemer}</div>
      <div className="stat-label">{label}{pct !== null && ` (${pct}%)`}</div>
    </div>
  );
}

export default function ManagementReport() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  function load() {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    api.get(`/reports/management?${params.toString()}`).then(setReport).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [from, to]);

  if (error) return <div className="alert-error">{error}</div>;
  if (!report) return <p>Laden...</p>;

  return (
    <div>
      <h1>Managementrapportage</h1>
      <p className="muted">Periodefilter op basis van geplande opleverdatum. Alle percentages tonen altijd teller/noemer.</p>

      <div className="filter-bar form-row">
        <label>Van (geplande opleverdatum)
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>Tot
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <div className="card-grid">
        <div className="stat-card">
          <div className="stat-value">{report.aantalWoningen}</div>
          <div className="stat-label">Aantal woningen</div>
        </div>
        <Fraction label="Op tijd opgeleverd" value={report.opTijdOpgeleverd} />
        <Fraction label="Te laat opgeleverd" value={report.teLaatOpgeleverd} />
        <div className="stat-card">
          <div className="stat-value">{report.gemiddeldeDoorlooptijdDagen !== null ? report.gemiddeldeDoorlooptijdDagen.toFixed(1) : '—'}</div>
          <div className="stat-label">Gemiddelde doorlooptijd (dagen)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{report.aantalBevindingen}</div>
          <div className="stat-label">Aantal bevindingen</div>
        </div>
        <Fraction label="Bevindingen per woning" value={report.bevindingenPerWoning} />
        <div className="stat-card">
          <div className="stat-value">{report.aantalVeiligheidskritischeBevindingen}</div>
          <div className="stat-label">Veiligheidskritische bevindingen</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{report.herhaaldeBevindingen}</div>
          <div className="stat-label">Herhaalde bevindingen (zelfde categorie)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{report.gemiddeldeHersteltijdDagen !== null ? report.gemiddeldeHersteltijdDagen.toFixed(1) : '—'}</div>
          <div className="stat-label">Gemiddelde hersteltijd (dagen)</div>
        </div>
        <Fraction label="Complete dossiers (vrijgegeven)" value={report.percentageCompleteDossiers} />
        <Fraction label="Correcte tweede controle" value={report.percentageCorrecteTweedeControle} />
      </div>
    </div>
  );
}
