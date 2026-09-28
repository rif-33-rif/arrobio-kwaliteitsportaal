import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const KPI_LABELS = [
  ['actieveWoningen', 'Actieve woningen'],
  ['dreigendeOverschrijdingen', 'Dreigende overschrijdingen'],
  ['gereedVoorControle', 'Gereed voor controle'],
  ['inTweedeControle', 'In (her)controle'],
  ['herstelpuntenOpen', 'Herstelpunten open'],
  ['gereedVoorManagercontrole', 'Gereed voor managercontrole'],
  ['definitiefVrijgegeven', 'Definitief vrijgegeven'],
  ['materiaalOnderVoorraad', 'Materiaal onder voorraad'],
];

function addressOf(p) {
  return `${p.address} ${p.huisnummer || ''}`.trim();
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/dashboard').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert-error">{error}</div>;
  if (!data) return <p>Laden...</p>;

  return (
    <div>
      <h1>Welkom, {user?.name}</h1>

      <div className="card-grid">
        {KPI_LABELS.map(([key, label]) => (
          <div className="stat-card" key={key}>
            <div className="stat-value">{data.kpis[key]}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>

      <div className="dashboard-columns">
        <section>
          <h2>Planning deze week</h2>
          {data.planningDezeWeek.length === 0 && <p className="muted">Geen woningen met opleverdatum binnen 7 dagen.</p>}
          <ul className="simple-list">
            {data.planningDezeWeek.map((p) => (
              <li key={p.id}>
                <Link to={`/woningen/${p.id}`}>{addressOf(p)}</Link>
                <span className="muted"> — {p.werkbonnummer} — {p.actuele_opleverdatum}</span>
                <span className="badge">{p.status}</span>
              </li>
            ))}
          </ul>

          <h2>Woningen die aandacht nodig hebben</h2>
          {data.aandachtNodig.length === 0 && <p className="muted">Geen woningen met achterstand of herstelbehoefte.</p>}
          <ul className="simple-list">
            {data.aandachtNodig.map((p) => (
              <li key={p.id} className="row-warning">
                <Link to={`/woningen/${p.id}`}>{addressOf(p)}</Link>
                <span className="muted"> — {p.werkbonnummer}</span>
                <span className="badge">{p.status}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Openstaande bevindingen</h2>
          {data.openstaandeBevindingen.length === 0 && <p className="muted">Geen openstaande bevindingen.</p>}
          <ul className="simple-list">
            {data.openstaandeBevindingen.map((f) => (
              <li key={f.id} className={f.severity === 'veiligheidskritisch' ? 'row-danger' : ''}>
                <Link to={`/woningen/${f.property_id}`}>{addressOf(f)}</Link> — {f.description}
                <span className="badge">{f.severity}</span>
              </li>
            ))}
          </ul>

          {data.lowStockMaterials.length > 0 && (
            <>
              <h2>Materiaal onder minimumvoorraad</h2>
              <ul className="simple-list">
                {data.lowStockMaterials.map((m) => (
                  <li key={m.id} className="row-warning">
                    <Link to="/materiaal">{m.name}</Link> — nog {m.stock_quantity} {m.unit} (min. {m.min_stock})
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2>Recente activiteit</h2>
          <ul className="simple-list">
            {data.recenteActiviteit.map((a) => (
              <li key={a.id}>
                <span className="muted">{a.created_at}</span> — {a.action}
                {a.address && <span className="muted"> ({addressOf(a)})</span>}
                {a.user_name && <span className="muted"> door {a.user_name}</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
