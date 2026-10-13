import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace('.', ','));

// Stepper met typbaar aantal. Typen wordt pas bij verlaten van het veld (of Enter) opgeslagen;
// de +/- knoppen slaan direct op.
function Qty({ value, disabled, onChange }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? (value ? fmt(value) : '');

  function commit() {
    if (draft === null) return;
    const n = Number(draft.replace(',', '.'));
    setDraft(null);
    if (draft.trim() === '') return value && onChange(0);
    if (Number.isFinite(n) && n >= 0 && n !== value) onChange(n);
  }

  return (
    <div className="qty">
      <button type="button" className="qty-btn" disabled={disabled || !value} onClick={() => onChange(Math.max(0, Math.round((value - 1) * 100) / 100))} aria-label="Minder">&minus;</button>
      <input
        className="qty-input"
        inputMode="decimal"
        placeholder="0"
        disabled={disabled}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" className="qty-btn" disabled={disabled} onClick={() => onChange(Math.round((value + 1) * 100) / 100)} aria-label="Meer">+</button>
    </div>
  );
}

// Opmerking bij een ingevulde regel (bijv. "tbv intercom"); wordt bij verlaten van het veld opgeslagen.
function RemarkInput({ line, disabled, onSave }) {
  return (
    <input
      key={`${line.id}-${line.remark || ''}`}
      className="remark-input"
      placeholder="Opmerking (bijv. tbv intercom)"
      defaultValue={line.remark || ''}
      disabled={disabled}
      maxLength={300}
      onBlur={(e) => onSave(line, e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

export default function OpnameDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [opname, setOpname] = useState(null);
  const [products, setProducts] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [lines, setLines] = useState([]);
  const [room, setRoom] = useState('alg');
  const [view, setView] = useState('ruimte');
  const [q, setQ] = useState('');
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [extra, setExtra] = useState(null);

  const locked = opname?.status === 'afgerond';

  function loadAll() {
    Promise.all([api.get(`/opnames/${id}`), api.get('/opnames/products'), api.get('/opnames/rooms')])
      .then(([detail, prods, rms]) => {
        const { lines: ls, ...meta } = detail;
        setOpname(meta);
        setLines(ls);
        setProducts(prods);
        setRooms(rms);
      })
      .catch((e) => setError(e.message));
  }
  useEffect(loadAll, [id]);

  // Standaardregels die al in deze opname staan maar inmiddels uitgeschakeld zijn, blijven zichtbaar.
  const [allProducts, setAllProducts] = useState([]);
  useEffect(() => {
    api.get('/opnames/products?all=1').then(setAllProducts).catch(() => {});
  }, [id]);
  const visibleProducts = useMemo(() => {
    const used = new Set(lines.filter((l) => l.product_id).map((l) => l.product_id));
    return allProducts.filter((p) => p.active || used.has(p.id));
  }, [allProducts, lines]);

  const qtyOf = (productId, r) => lines.find((l) => l.product_id === productId && l.room === r)?.aantal || 0;
  const roomCount = (r) => lines.filter((l) => l.room === r).length;

  async function setQty(productId, r, aantal) {
    setError('');
    const previous = lines;
    setLines((cur) => {
      const prev = cur.find((l) => l.product_id === productId && l.room === r);
      const rest = cur.filter((l) => l !== prev);
      if (!aantal) return rest;
      const p = allProducts.find((x) => x.id === productId);
      return [...rest, { id: `tmp-${productId}-${r}`, product_id: productId, room: r, aantal, remark: prev?.remark ?? null, description: p.description, unit: p.unit, sort_order: p.sort_order }];
    });
    try {
      await api.put(`/opnames/${id}/lines`, { product_id: productId, room: r, aantal });
    } catch (err) {
      setLines(previous);
      setError(`Niet opgeslagen: ${err.message}`);
    }
  }

  async function setRemark(line, remark) {
    if ((line.remark || '') === remark.trim()) return;
    setError('');
    const previous = lines;
    setLines((cur) => cur.map((l) => (l === line ? { ...l, remark: remark.trim() || null } : l)));
    try {
      if (line.product_id) await api.put(`/opnames/${id}/lines`, { product_id: line.product_id, room: line.room, remark });
      else await api.put(`/opnames/${id}/extra-lines/${line.id}`, { remark });
    } catch (err) {
      setLines(previous);
      setError(`Niet opgeslagen: ${err.message}`);
    }
  }

  async function setExtraQty(line, aantal) {
    setError('');
    const previous = lines;
    setLines((cur) => (aantal ? cur.map((l) => (l.id === line.id ? { ...l, aantal } : l)) : cur.filter((l) => l.id !== line.id)));
    try {
      await api.put(`/opnames/${id}/extra-lines/${line.id}`, { aantal });
    } catch (err) {
      setLines(previous);
      setError(`Niet opgeslagen: ${err.message}`);
    }
  }

  async function addExtra(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/opnames/${id}/extra-lines`, { ...extra, room, aantal: Number(String(extra.aantal).replace(',', '.')) || 1 });
      setExtra(null);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveMeta(changes) {
    setError('');
    try {
      const updated = await api.put(`/opnames/${id}`, changes);
      setOpname((cur) => ({ ...cur, ...updated }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Deze opname definitief verwijderen?')) return;
    try {
      await api.del(`/opnames/${id}`);
      navigate('/opnames');
    } catch (err) {
      setError(err.message);
    }
  }

  // ----- Delen -----

  // Per ruimte een leesbare lijst, bruikbaar in WhatsApp / e-mail / sms.
  const shareText = useMemo(() => {
    if (!opname) return '';
    const out = [`Woningopname Electra`, `Project: ${opname.project}`, `Adres: ${opname.address}`, `Datum: ${opname.datum}`];
    if (opname.notities) out.push(`Opmerkingen: ${opname.notities}`);
    for (const r of rooms) {
      const inRoom = lines.filter((l) => l.room === r.key).sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9));
      if (!inRoom.length) continue;
      out.push('', r.label.toUpperCase());
      for (const l of inRoom) out.push(`- ${l.description}: ${fmt(l.aantal)} ${l.unit}${l.remark ? ` (${l.remark})` : ''}`);
    }
    if (!lines.length) out.push('', 'Nog geen regels ingevuld.');
    return out.join('\n');
  }, [opname, rooms, lines]);

  const shareTitle = opname ? `Opname ${opname.address}` : 'Opname';

  async function fetchFile(kind) {
    const token = localStorage.getItem('arro_token');
    const res = await fetch(`/api/opnames/${id}/${kind}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Bestand maken mislukt');
    const blob = await res.blob();
    const base = `opname-${opname.address}`.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').toLowerCase();
    const type = kind === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf';
    return new File([blob], `${base}.${kind}`, { type });
  }

  // Deelt Excel + PDF als de telefoon dat kan, anders alleen Excel, anders alleen de tekst.
  async function handleShare() {
    setError('');
    setNotice('');
    try {
      if (navigator.share) {
        const [xlsx, pdf] = await Promise.all([fetchFile('xlsx').catch(() => null), fetchFile('pdf').catch(() => null)]);
        const candidates = [[xlsx, pdf], [xlsx], [pdf]].map((set) => set.filter(Boolean)).filter((set) => set.length);
        const files = candidates.find((set) => navigator.canShare?.({ files: set }));
        await navigator.share({ title: shareTitle, text: shareText, ...(files ? { files } : {}) });
        return;
      }
      await navigator.clipboard.writeText(shareText);
      setNotice('Delen wordt door deze browser niet ondersteund; de opname is gekopieerd. Gebruik de knop Excel om het bestand te downloaden.');
    } catch (err) {
      if (err.name !== 'AbortError') setError(`Delen mislukt: ${err.message}`);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareText);
      setNotice('Opname gekopieerd naar het klembord.');
    } catch {
      setError('Kopiëren is niet gelukt.');
    }
  }

  async function handleDownload(kind) {
    setError('');
    try {
      await api.download(`/opnames/${id}/${kind}`, `opname.${kind}`);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!opname) return <div>{error ? <div className="alert-error">{error}</div> : 'Laden...'}</div>;

  const currentRoom = rooms.find((r) => r.key === room);
  const needle = q.trim().toLowerCase();
  const shownProducts = visibleProducts.filter(
    (p) => (!needle || p.description.toLowerCase().includes(needle)) && (!onlyFilled || qtyOf(p.id, room) > 0)
  );
  const roomExtras = lines.filter((l) => l.product_id === null && l.room === room);

  // Overzicht: product x ruimte
  const usedRooms = rooms.filter((r) => lines.some((l) => l.room === r.key));
  const summaryRows = (() => {
    const map = new Map();
    for (const l of lines) {
      const key = l.product_id ? `p${l.product_id}` : `x${l.id}`;
      if (!map.has(key)) map.set(key, { key, description: l.description, unit: l.unit, sort: l.sort_order ?? 1e9, byRoom: {}, total: 0 });
      const row = map.get(key);
      row.byRoom[l.room] = (row.byRoom[l.room] || 0) + l.aantal;
      row.total += l.aantal;
    }
    return [...map.values()].sort((a, b) => a.sort - b.sort);
  })();

  return (
    <div className="opname">
      <p><Link to="/opnames" className="btn-link">&larr; Alle opnames</Link></p>

      <div className="page-header">
        <div>
          <h1>{opname.address}</h1>
          <p className="muted">{opname.project} &middot; {opname.datum} &middot; {opname.created_by_name}</p>
        </div>
        <span className={`badge badge-large ${locked ? 'badge-done' : 'badge-warning'}`}>{locked ? 'Afgerond' : 'Concept'}</span>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {notice && <div className="alert-warning" style={{ margin: '0.75rem 0' }}>{notice}</div>}

      <div className="share-bar">
        <button className="btn-primary" onClick={handleShare}>Delen</button>
        <button className="btn-secondary" onClick={() => handleDownload('xlsx')}>Excel</button>
        <button className="btn-secondary" onClick={() => handleDownload('pdf')}>PDF</button>
        <a className="btn-secondary btn-anchor" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}>WhatsApp</a>
        <a className="btn-secondary btn-anchor" href={`mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(shareText)}`}>E-mail</a>
        <button className="btn-secondary" onClick={handleCopy}>Kopieer</button>
      </div>

      <div className="tab-bar">
        <button className={`tab ${view === 'ruimte' ? 'tab-active' : ''}`} onClick={() => setView('ruimte')}>Per ruimte</button>
        <button className={`tab ${view === 'overzicht' ? 'tab-active' : ''}`} onClick={() => setView('overzicht')}>Overzicht ({summaryRows.length})</button>
        <button className={`tab ${view === 'gegevens' ? 'tab-active' : ''}`} onClick={() => setView('gegevens')}>Gegevens</button>
      </div>

      <div className="tab-panel">
        {view === 'ruimte' && (
          <>
            <div className="room-bar">
              {rooms.map((r) => (
                <button key={r.key} type="button" className={`pill room-pill ${room === r.key ? 'pill-active' : ''}`} onClick={() => setRoom(r.key)}>
                  {r.label}
                  {roomCount(r.key) > 0 && <span className="room-count">{roomCount(r.key)}</span>}
                </button>
              ))}
            </div>

            <h2 style={{ marginTop: '1rem' }}>{currentRoom?.label}</h2>

            <div className="search-bar">
              <input style={{ flex: 1 }} placeholder="Zoek een regel..." value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="button" className={`pill ${onlyFilled ? 'pill-active' : ''}`} onClick={() => setOnlyFilled((v) => !v)}>Alleen ingevuld</button>
            </div>

            <ul className="opname-list">
              {shownProducts.map((p) => {
                const line = lines.find((l) => l.product_id === p.id && l.room === room);
                const value = line?.aantal || 0;
                return (
                  <li key={p.id} className={value ? 'opname-row filled' : 'opname-row'}>
                    <div className="opname-desc">
                      {p.description}
                      <span className="muted small"> &middot; {p.unit}</span>
                      {line && <RemarkInput line={line} disabled={locked} onSave={setRemark} />}
                    </div>
                    <Qty value={value} disabled={locked} onChange={(n) => setQty(p.id, room, n)} />
                  </li>
                );
              })}
              {roomExtras.map((l) => (
                <li key={l.id} className="opname-row filled">
                  <div className="opname-desc">
                    {l.description}
                    <span className="muted small"> &middot; {l.unit} &middot; extra regel</span>
                    <RemarkInput line={l} disabled={locked} onSave={setRemark} />
                  </div>
                  <Qty value={l.aantal} disabled={locked} onChange={(n) => setExtraQty(l, n)} />
                </li>
              ))}
              {shownProducts.length === 0 && roomExtras.length === 0 && <li className="muted">Geen regels gevonden.</li>}
            </ul>

            {!locked && !extra && (
              <button type="button" className="btn-secondary" onClick={() => setExtra({ description: q.trim(), unit: 'p/st', aantal: 1 })}>
                + Regel toevoegen die niet in de lijst staat
              </button>
            )}
            {!locked && extra && (
              <form className="inline-form" onSubmit={addExtra}>
                <strong>Extra regel in {currentRoom?.label}</strong>
                <label>Omschrijving
                  <input value={extra.description} onChange={(e) => setExtra({ ...extra, description: e.target.value })} required autoFocus />
                </label>
                <div className="form-row">
                  <label>Aantal
                    <input inputMode="decimal" value={extra.aantal} onChange={(e) => setExtra({ ...extra, aantal: e.target.value })} required />
                  </label>
                  <label>Eenheid
                    <input value={extra.unit} onChange={(e) => setExtra({ ...extra, unit: e.target.value })} required />
                  </label>
                </div>
                <div>
                  <button type="submit" className="btn-primary">Toevoegen</button>{' '}
                  <button type="button" className="btn-secondary" onClick={() => setExtra(null)}>Annuleren</button>
                </div>
              </form>
            )}
          </>
        )}

        {view === 'overzicht' && (
          summaryRows.length === 0 ? (
            <p className="muted">Nog niets ingevuld. Kies bij "Per ruimte" een ruimte en vul de aantallen in.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table summary-table">
                <thead>
                  <tr>
                    <th>Omschrijving</th>
                    <th>Eenh.</th>
                    {usedRooms.map((r) => <th key={r.key} title={r.label} className="num">{r.short}</th>)}
                    <th className="num">Totaal</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.description}</td>
                      <td>{row.unit}</td>
                      {usedRooms.map((r) => <td key={r.key} className="num">{row.byRoom[r.key] ? fmt(row.byRoom[r.key]) : ''}</td>)}
                      <td className="num"><strong>{fmt(row.total)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {view === 'gegevens' && (
          <div className="inline-form">
            <div className="form-row">
              <label>Project
                <input defaultValue={opname.project} disabled={locked} onBlur={(e) => e.target.value.trim() && e.target.value !== opname.project && saveMeta({ project: e.target.value })} />
              </label>
              <label>Adres
                <input defaultValue={opname.address} disabled={locked} onBlur={(e) => e.target.value.trim() && e.target.value !== opname.address && saveMeta({ address: e.target.value })} />
              </label>
            </div>
            <div className="form-row">
              <label>Datum
                <input type="date" defaultValue={opname.datum} disabled={locked} onBlur={(e) => e.target.value && e.target.value !== opname.datum && saveMeta({ datum: e.target.value })} />
              </label>
              <label>Planning (bijv. DM, RB, AF)
                <input defaultValue={opname.planning || ''} disabled={locked} onBlur={(e) => e.target.value !== (opname.planning || '') && saveMeta({ planning: e.target.value })} />
              </label>
            </div>
            <label>Opmerkingen
              <textarea
                rows={4}
                defaultValue={opname.notities || ''}
                disabled={locked}
                placeholder="Bijv. blok 2,20 meter links keuken; rechts wcd koelkast naar beneden"
                onBlur={(e) => e.target.value !== (opname.notities || '') && saveMeta({ notities: e.target.value })}
              />
            </label>
          </div>
        )}
      </div>

      <div className="status-actions">
        {locked ? (
          <button className="btn-secondary" onClick={() => saveMeta({ status: 'concept' })}>Heropenen</button>
        ) : (
          <button className="btn-primary btn-done" onClick={() => saveMeta({ status: 'afgerond' })}>Opname afronden</button>
        )}
        <button className="btn-link" onClick={handleDelete}>Opname verwijderen</button>
      </div>
    </div>
  );
}
