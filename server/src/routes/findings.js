import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { guardMutation, DossierLockedError } from '../lib/approvalGuard.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get('/', (req, res) => {
  const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.propertyId);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });

  const rows = db
    .prepare(
      `SELECT f.*, ru.name AS reported_by_name, au.name AS assigned_to_name
       FROM findings f
       LEFT JOIN users ru ON ru.id = f.reported_by
       LEFT JOIN users au ON au.id = f.assigned_to
       WHERE f.property_id = ? ORDER BY f.finding_number`
    )
    .all(req.params.propertyId);
  res.json(rows);
});

router.get('/:findingId', (req, res) => {
  const finding = db
    .prepare('SELECT * FROM findings WHERE id = ? AND property_id = ?')
    .get(req.params.findingId, req.params.propertyId);
  if (!finding) return res.status(404).json({ error: 'Bevinding niet gevonden' });
  const repairs = db
    .prepare(
      `SELECT r.*, u.name AS executor_name FROM repairs r LEFT JOIN users u ON u.id = r.executor_id
       WHERE r.finding_id = ? ORDER BY r.created_at`
    )
    .all(finding.id);
  res.json({ ...finding, repairs });
});

router.post('/', (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.propertyId);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });

  const { category, description, severity, assigned_to, repair_deadline } = req.body;
  if (!description || !severity) {
    return res.status(400).json({ error: 'Omschrijving en ernst zijn verplicht' });
  }
  if (!['laag', 'middel', 'hoog', 'veiligheidskritisch'].includes(severity)) {
    return res.status(400).json({ error: 'Ongeldige ernst' });
  }

  try {
    guardMutation(req.params.propertyId, req.user.id);
  } catch (err) {
    if (err instanceof DossierLockedError) return res.status(403).json({ error: err.message });
    throw err;
  }

  const nextNumber = (db.prepare('SELECT COALESCE(MAX(finding_number), 0) AS n FROM findings WHERE property_id = ?').get(req.params.propertyId).n) + 1;

  const result = db
    .prepare(
      `INSERT INTO findings (property_id, finding_number, category, description, severity, reported_by, assigned_to, repair_deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.params.propertyId, nextNumber, category || null, description, severity, req.user.id, assigned_to || null, repair_deadline || null);

  logAudit({
    propertyId: property.id,
    userId: req.user.id,
    action: 'BEVINDING_AANGEMAAKT',
    details: { findingNumber: nextNumber, description, severity },
  });

  res.status(201).json(db.prepare('SELECT * FROM findings WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:findingId', (req, res) => {
  const existing = db
    .prepare('SELECT * FROM findings WHERE id = ? AND property_id = ?')
    .get(req.params.findingId, req.params.propertyId);
  if (!existing) return res.status(404).json({ error: 'Bevinding niet gevonden' });

  try {
    guardMutation(req.params.propertyId, req.user.id);
  } catch (err) {
    if (err instanceof DossierLockedError) return res.status(403).json({ error: err.message });
    throw err;
  }

  const { category, description, severity, assigned_to, repair_deadline, status } = req.body;
  // Afsluiten (status 'afgesloten') gebeurt uitsluitend via de tweede controle/hercontrole,
  // nooit via een directe handmatige wijziging (bewaart de betekenis van de audittrail).
  if (status === 'afgesloten') {
    return res.status(400).json({ error: 'Een bevinding kan alleen via de (her)controle worden afgesloten' });
  }

  db.prepare(
    `UPDATE findings SET category=?, description=?, severity=?, assigned_to=?, repair_deadline=?, status=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    category ?? existing.category,
    description ?? existing.description,
    severity ?? existing.severity,
    assigned_to ?? existing.assigned_to,
    repair_deadline ?? existing.repair_deadline,
    status && ['open', 'in_behandeling'].includes(status) ? status : existing.status,
    req.params.findingId
  );

  res.json(db.prepare('SELECT * FROM findings WHERE id = ?').get(req.params.findingId));
});

router.post('/:findingId/repairs', (req, res) => {
  const finding = db
    .prepare('SELECT * FROM findings WHERE id = ? AND property_id = ?')
    .get(req.params.findingId, req.params.propertyId);
  if (!finding) return res.status(404).json({ error: 'Bevinding niet gevonden' });

  try {
    guardMutation(req.params.propertyId, req.user.id);
  } catch (err) {
    if (err instanceof DossierLockedError) return res.status(403).json({ error: err.message });
    throw err;
  }

  const { action, date, explanation, after_attachment_id } = req.body;
  if (!action) return res.status(400).json({ error: 'Herstelactie is verplicht' });

  const result = db
    .prepare(
      `INSERT INTO repairs (finding_id, action, date, executor_id, explanation, after_attachment_id)
       VALUES (?, ?, COALESCE(?, date('now')), ?, ?, ?)`
    )
    .run(finding.id, action, date || null, req.user.id, explanation || null, after_attachment_id || null);

  db.prepare(`UPDATE findings SET status='gereed_voor_hercontrole', updated_at=datetime('now') WHERE id=?`).run(finding.id);

  logAudit({
    propertyId: Number(req.params.propertyId),
    userId: req.user.id,
    action: 'HERSTEL_GEREGISTREERD',
    details: { findingNumber: finding.finding_number, herstelactie: action },
  });

  res.status(201).json(db.prepare('SELECT * FROM repairs WHERE id = ?').get(result.lastInsertRowid));
});

export default router;
