import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { assertValidTransition } from '../lib/statusRules.js';

const router = Router();
router.use(requireAuth);

function withAssignments(property) {
  const assignments = db
    .prepare(
      `SELECT pa.*, u.name AS user_name FROM property_assignments pa
       JOIN users u ON u.id = pa.user_id WHERE pa.property_id = ? AND pa.active = 1`
    )
    .all(property.id);
  const openFindings = db
    .prepare(
      `SELECT COUNT(*) AS n FROM findings WHERE property_id = ? AND status != 'afgesloten'`
    )
    .get(property.id).n;
  return { ...property, assignments, openFindings };
}

// Gebruikers zien alle woningen (rolgebaseerde beperking van ACTIES gebeurt per
// endpoint, niet door de lijst te verbergen — anders kan een monteur zijn eigen
// toegewezen werk niet terugvinden).
router.get('/', (req, res) => {
  const { status, q } = req.query;
  let sql = 'SELECT * FROM properties WHERE 1=1';
  const params = [];
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (q) {
    sql += ` AND (address LIKE ? OR postcode LIKE ? OR werkbonnummer LIKE ? OR id IN (
      SELECT property_id FROM property_assignments pa JOIN users u ON u.id = pa.user_id WHERE u.name LIKE ?
    ))`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY geplande_opleverdatum ASC';
  const rows = db.prepare(sql).all(...params).map(withAssignments);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });
  const planningChanges = db
    .prepare('SELECT pc.*, u.name AS changed_by_name FROM planning_changes pc LEFT JOIN users u ON u.id = pc.changed_by WHERE property_id = ? ORDER BY changed_at DESC')
    .all(req.params.id);
  const auditEvents = db
    .prepare('SELECT ae.*, u.name AS user_name FROM audit_events ae LEFT JOIN users u ON u.id = ae.user_id WHERE property_id = ? ORDER BY created_at DESC')
    .all(req.params.id);
  res.json({ ...withAssignments(property), planningChanges, auditEvents });
});

router.post('/', requireRole('beheerder', 'manager'), (req, res) => {
  const {
    opdrachtgever, project, werkbonnummer, address, huisnummer, toevoeging, postcode, plaats,
    datum_opdracht, startdatum, geplande_opleverdatum, omschrijving, bijzonderheden,
  } = req.body;

  if (!opdrachtgever || !werkbonnummer || !address || !geplande_opleverdatum) {
    return res.status(400).json({ error: 'Opdrachtgever, werkbonnummer, adres en geplande opleverdatum zijn verplicht' });
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO properties (
          opdrachtgever, project, werkbonnummer, address, huisnummer, toevoeging, postcode, plaats,
          datum_opdracht, startdatum, geplande_opleverdatum, actuele_opleverdatum, omschrijving, bijzonderheden, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        opdrachtgever, project || null, werkbonnummer, address, huisnummer || null, toevoeging || null,
        postcode || null, plaats || null, datum_opdracht || null, startdatum || null,
        geplande_opleverdatum, geplande_opleverdatum, omschrijving || null, bijzonderheden || null, req.user.id
      );
    const propertyId = result.lastInsertRowid;
    logAudit({ propertyId, userId: req.user.id, action: 'WONING_AANGEMAAKT', toStatus: 'NIEUW' });
    res.status(201).json(withAssignments(db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId)));
  } catch (err) {
    res.status(400).json({ error: 'Kon woning niet aanmaken (werkbonnummer mogelijk al in gebruik)' });
  }
});

router.put('/:id', requireRole('beheerder', 'manager'), (req, res) => {
  const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Woning niet gevonden' });
  const { opdrachtgever, project, omschrijving, bijzonderheden } = req.body;
  db.prepare(
    `UPDATE properties SET opdrachtgever=?, project=?, omschrijving=?, bijzonderheden=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    opdrachtgever ?? existing.opdrachtgever,
    project ?? existing.project,
    omschrijving ?? existing.omschrijving,
    bijzonderheden ?? existing.bijzonderheden,
    req.params.id
  );
  res.json(withAssignments(db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id)));
});

// Statusovergang: uitsluitend via het centrale statusmodel, nooit een vrije waarde.
// Dit generieke endpoint mag ALLEEN de zuiver administratieve overgangen uitvoeren
// (inplannen, annuleren). Elke overgang die een kwaliteitscontrole vertegenwoordigt
// (gereedmelding, vierogencontrole, hercontrole, managercontrole, vrijgave, heropening)
// loopt uitsluitend via het bijbehorende gevalideerde endpoint — ook voor beheerder/manager —
// zodat die controles nooit via een generieke statuswijziging omzeild kunnen worden
// (sectie 14, 15, 18, 20 en 33 van de bouwopdracht).
const GENERIEK_TOEGESTAAN = new Set([
  'NIEUW->GEPLAND',
  'NIEUW->GEANNULEERD',
  'GEPLAND->GEANNULEERD',
  'IN_UITVOERING->GEANNULEERD',
]);

router.put('/:id/status', requireRole('beheerder', 'manager'), (req, res) => {
  const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Woning niet gevonden' });
  const { status: newStatus } = req.body;

  if (!GENERIEK_TOEGESTAAN.has(`${existing.status}->${newStatus}`)) {
    return res.status(400).json({
      error: 'Deze statusovergang vertegenwoordigt een kwaliteitscontrole en moet via de bijbehorende functie lopen (start werk, gereedmelding, tweede controle, hercontrole, managercontrole, vrijgave of heropening), niet via een directe statuswijziging',
    });
  }
  try {
    assertValidTransition(existing.status, newStatus);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  db.prepare(`UPDATE properties SET status=?, updated_at=datetime('now') WHERE id=?`).run(newStatus, req.params.id);
  logAudit({ propertyId: existing.id, userId: req.user.id, action: 'STATUS_WIJZIGING', fromStatus: existing.status, toStatus: newStatus });
  res.json(withAssignments(db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id)));
});

// Start werk: monteur/leerling mogen dit zelf, geen managerhandeling nodig.
router.post('/:id/start-werk', requireRole('beheerder', 'manager', 'monteur', 'leerling'), (req, res) => {
  const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Woning niet gevonden' });
  try {
    assertValidTransition(existing.status, 'IN_UITVOERING');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  db.prepare(`UPDATE properties SET status='IN_UITVOERING', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  logAudit({ propertyId: existing.id, userId: req.user.id, action: 'WERK_GESTART', fromStatus: existing.status, toStatus: 'IN_UITVOERING' });
  res.json(withAssignments(db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id)));
});

// Planningswijziging: oorspronkelijke geplande_opleverdatum wordt nooit overschreven.
// Alleen actuele_opleverdatum, werkelijke_opleverdatum en startdatum zijn wijzigbaar,
// en uitsluitend met een verplichte reden (sectie 8 van de bouwopdracht).
const PLANNING_FIELDS = ['actuele_opleverdatum', 'werkelijke_opleverdatum', 'startdatum'];

router.put('/:id/planning', requireRole('beheerder', 'manager'), (req, res) => {
  const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Woning niet gevonden' });
  const { field, new_value, reason } = req.body;
  if (!PLANNING_FIELDS.includes(field)) {
    return res.status(400).json({ error: `Veld moet een van de volgende zijn: ${PLANNING_FIELDS.join(', ')}` });
  }
  if (!reason) {
    return res.status(400).json({ error: 'Reden voor wijziging is verplicht' });
  }
  const oldValue = existing[field];

  db.prepare(`UPDATE properties SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`).run(new_value, req.params.id);
  db.prepare(
    `INSERT INTO planning_changes (property_id, field, old_value, new_value, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(req.params.id, field, oldValue, new_value, reason, req.user.id);
  logAudit({
    propertyId: existing.id,
    userId: req.user.id,
    action: 'PLANNING_GEWIJZIGD',
    details: { field, oldValue, newValue: new_value, reason },
  });

  res.json(withAssignments(db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id)));
});

router.post('/:id/assignments', requireRole('beheerder', 'manager'), (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });
  const { user_id, role_in_property } = req.body;
  if (!user_id || !role_in_property) {
    return res.status(400).json({ error: 'Gebruiker en rol zijn verplicht' });
  }
  if (!['monteur', 'leerling', 'controleur', 'manager'].includes(role_in_property)) {
    return res.status(400).json({ error: 'Ongeldige rol voor toewijzing' });
  }

  db.prepare(
    `UPDATE property_assignments SET active = 0 WHERE property_id = ? AND role_in_property = ? AND active = 1`
  ).run(req.params.id, role_in_property);
  db.prepare(
    `INSERT INTO property_assignments (property_id, user_id, role_in_property) VALUES (?, ?, ?)`
  ).run(req.params.id, user_id, role_in_property);

  logAudit({
    propertyId: property.id,
    userId: req.user.id,
    action: 'TOEWIJZING_GEWIJZIGD',
    details: { role_in_property, user_id },
  });

  res.status(201).json(withAssignments(db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id)));
});

// Gereedmelding (sectie 14): controleert automatisch of alles compleet is voordat
// de woning naar GEREED_VOOR_CONTROLE mag. Ontbreekt er iets, dan GEEN gereedmelding
// en wordt exact getoond wat ontbreekt.
router.post('/:id/gereedmelding', requireRole('beheerder', 'manager', 'monteur', 'leerling'), (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });

  if (property.status !== 'IN_UITVOERING') {
    return res.status(400).json({ error: `Gereedmelden kan alleen vanuit status IN_UITVOERING (huidige status: ${property.status})` });
  }

  const missing = [];

  const checklist = db.prepare('SELECT * FROM checklists WHERE active = 1 ORDER BY id LIMIT 1').get();
  if (checklist) {
    const items = db.prepare('SELECT * FROM checklist_items WHERE checklist_id = ?').all(checklist.id);
    const results = db
      .prepare('SELECT * FROM checklist_results WHERE property_id = ?')
      .all(req.params.id);
    const resultByItem = new Map(results.map((r) => [r.checklist_item_id, r]));

    const unanswered = items.filter((i) => !resultByItem.has(i.id));
    if (unanswered.length > 0) {
      missing.push(`Checklist onvolledig: ${unanswered.map((i) => i.text).join(', ')}`);
    }
    const notAkkoord = items.filter((i) => resultByItem.get(i.id)?.answer === 'niet_akkoord');
    if (notAkkoord.length > 0) {
      missing.push(`Checklistpunten met "niet akkoord" moeten eerst opgelost zijn: ${notAkkoord.map((i) => i.text).join(', ')}`);
    }
  }

  const openWorkItems = db
    .prepare(`SELECT COUNT(*) AS n FROM work_items WHERE property_id = ? AND status != 'afgerond'`)
    .get(req.params.id).n;
  const totalWorkItems = db.prepare('SELECT COUNT(*) AS n FROM work_items WHERE property_id = ?').get(req.params.id).n;
  if (totalWorkItems === 0) {
    missing.push('Geen werkzaamheden geregistreerd');
  } else if (openWorkItems > 0) {
    missing.push(`${openWorkItems} werkzaamheid/werkzaamheden nog niet afgerond`);
  }

  const photoCount = db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE property_id = ?').get(req.params.id).n;
  if (photoCount === 0) {
    missing.push('Geen foto\'s aanwezig');
  }

  const measurementCount = db.prepare('SELECT COUNT(*) AS n FROM measurements WHERE property_id = ?').get(req.params.id).n;
  if (measurementCount === 0) {
    missing.push('Geen meetgegevens aanwezig');
  }

  if (missing.length > 0) {
    return res.status(400).json({ error: 'Gereedmelding niet mogelijk', missing });
  }

  assertValidTransition(property.status, 'GEREED_VOOR_CONTROLE');
  db.prepare(`UPDATE properties SET status='GEREED_VOOR_CONTROLE', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  logAudit({
    propertyId: property.id,
    userId: req.user.id,
    action: 'GEREED_GEMELD',
    fromStatus: 'IN_UITVOERING',
    toStatus: 'GEREED_VOOR_CONTROLE',
  });

  res.json(withAssignments(db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id)));
});

// Alle herstelpunten zijn behandeld: vraag hercontrole aan (sectie 17).
router.post('/:id/hercontrole-gereedmelding', requireRole('beheerder', 'manager', 'monteur', 'leerling'), (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });
  if (property.status !== 'HERSTEL_NODIG') {
    return res.status(400).json({ error: `Hercontrole aanvragen kan alleen vanuit HERSTEL_NODIG (huidige status: ${property.status})` });
  }

  const openFindings = db
    .prepare(`SELECT * FROM findings WHERE property_id = ? AND status IN ('open', 'in_behandeling')`)
    .all(req.params.id);
  if (openFindings.length > 0) {
    return res.status(400).json({
      error: 'Niet alle bevindingen zijn hersteld',
      missing: openFindings.map((f) => `#${f.finding_number} ${f.description}`),
    });
  }

  assertValidTransition(property.status, 'GEREED_VOOR_HERCONTROLE');
  db.prepare(`UPDATE properties SET status='GEREED_VOOR_HERCONTROLE', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  logAudit({ propertyId: property.id, userId: req.user.id, action: 'HERCONTROLE_AANGEVRAAGD', fromStatus: 'HERSTEL_NODIG', toStatus: 'GEREED_VOOR_HERCONTROLE' });

  res.json(withAssignments(db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id)));
});

// Manager start de managercontrole na technische goedkeuring (sectie 18).
router.post('/:id/managercontrole-starten', requireRole('beheerder', 'manager'), (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });
  try {
    assertValidTransition(property.status, 'MANAGERCONTROLE');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  db.prepare(`UPDATE properties SET status='MANAGERCONTROLE', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  logAudit({ propertyId: property.id, userId: req.user.id, action: 'MANAGERCONTROLE_GESTART', fromStatus: property.status, toStatus: 'MANAGERCONTROLE' });
  res.json(withAssignments(db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id)));
});

router.get('/:id/manager-reviews', (req, res) => {
  const rows = db
    .prepare(
      `SELECT mr.*, u.name AS manager_name FROM manager_reviews mr
       JOIN users u ON u.id = mr.manager_id WHERE mr.property_id = ? ORDER BY mr.created_at DESC`
    )
    .all(req.params.id);
  res.json(rows);
});

// Managerbeslissing: vrijgeven of terugsturen (sectie 18, 19).
router.post('/:id/manager-reviews', requireRole('beheerder', 'manager'), (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });
  if (property.status !== 'MANAGERCONTROLE') {
    return res.status(400).json({ error: `Managerbeslissing kan alleen vanuit status MANAGERCONTROLE (huidige status: ${property.status})` });
  }

  const { result, reason } = req.body;
  if (!['vrijgegeven', 'teruggestuurd'].includes(result)) {
    return res.status(400).json({ error: 'Resultaat moet "vrijgegeven" of "teruggestuurd" zijn' });
  }
  if (result === 'teruggestuurd' && !reason) {
    return res.status(400).json({ error: 'Reden is verplicht bij terugsturen' });
  }

  if (result === 'vrijgegeven') {
    const openCritical = db
      .prepare(`SELECT COUNT(*) AS n FROM findings WHERE property_id = ? AND severity = 'veiligheidskritisch' AND status != 'afgesloten'`)
      .get(req.params.id).n;
    if (openCritical > 0) {
      return res.status(400).json({ error: 'De woning kan niet worden vrijgegeven: er staat nog een veiligheidskritische bevinding open' });
    }
  }

  const newStatus = result === 'vrijgegeven' ? 'VRIJGEGEVEN' : 'HERSTEL_NODIG';
  try {
    assertValidTransition(property.status, newStatus);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  db.prepare(
    `INSERT INTO manager_reviews (property_id, manager_id, result, reason, dossier_version) VALUES (?, ?, ?, ?, ?)`
  ).run(req.params.id, req.user.id, result, reason || null, property.dossier_version);

  if (result === 'vrijgegeven') {
    db.prepare(
      `UPDATE properties SET status='VRIJGEGEVEN', werkelijke_opleverdatum=COALESCE(werkelijke_opleverdatum, date('now')), updated_at=datetime('now') WHERE id=?`
    ).run(req.params.id);
    db.prepare('UPDATE attachments SET locked = 1 WHERE property_id = ?').run(req.params.id);
    logAudit({ propertyId: property.id, userId: req.user.id, action: 'DEFINITIEF_VRIJGEGEVEN', fromStatus: 'MANAGERCONTROLE', toStatus: 'VRIJGEGEVEN', details: { dossierVersion: property.dossier_version } });
  } else {
    db.prepare(`UPDATE properties SET status='HERSTEL_NODIG', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
    logAudit({ propertyId: property.id, userId: req.user.id, action: 'MANAGERCONTROLE_TERUGGESTUURD', fromStatus: 'MANAGERCONTROLE', toStatus: 'HERSTEL_NODIG', details: { reason } });
  }

  res.json(withAssignments(db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id)));
});

// Formele heropening na definitieve vrijgave (sectie 20): geen stille wijziging toegestaan.
router.post('/:id/heropenen', requireRole('beheerder', 'manager'), (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });
  if (property.status !== 'VRIJGEGEVEN') {
    return res.status(400).json({ error: 'Alleen een definitief vrijgegeven woning kan formeel heropend worden' });
  }
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Reden voor heropening is verplicht' });

  db.prepare(
    `UPDATE properties SET status='GEREED_VOOR_CONTROLE', dossier_version=dossier_version+1, updated_at=datetime('now') WHERE id=?`
  ).run(req.params.id);

  logAudit({ propertyId: property.id, userId: req.user.id, action: 'HEROPEND', fromStatus: 'VRIJGEGEVEN', toStatus: 'HEROPEND', details: { reason } });
  logAudit({ propertyId: property.id, userId: req.user.id, action: 'STATUS_WIJZIGING', fromStatus: 'HEROPEND', toStatus: 'GEREED_VOOR_CONTROLE', details: { reason } });

  res.json(withAssignments(db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id)));
});

export default router;
