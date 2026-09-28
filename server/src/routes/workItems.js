import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { guardMutation, DossierLockedError } from '../lib/approvalGuard.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

function ensureProperty(propertyId, res) {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
  if (!property) {
    res.status(404).json({ error: 'Woning niet gevonden' });
    return null;
  }
  return property;
}

router.get('/', (req, res) => {
  if (!ensureProperty(req.params.propertyId, res)) return;
  const items = db
    .prepare(
      `SELECT wi.*, u.name AS executor_name FROM work_items wi
       LEFT JOIN users u ON u.id = wi.executor_id
       WHERE wi.property_id = ? ORDER BY wi.date DESC, wi.id DESC`
    )
    .all(req.params.propertyId);
  res.json(items);
});

router.post('/', (req, res) => {
  const property = ensureProperty(req.params.propertyId, res);
  if (!property) return;
  const { category, description, executor_id, date, remark, ruimte, aantal, eenheid } = req.body;
  if (!category || !description) {
    return res.status(400).json({ error: 'Categorie en omschrijving zijn verplicht' });
  }
  try {
    guardMutation(req.params.propertyId, req.user.id);
  } catch (err) {
    if (err instanceof DossierLockedError) return res.status(403).json({ error: err.message });
    throw err;
  }
  const result = db
    .prepare(
      `INSERT INTO work_items (property_id, category, description, ruimte, aantal, eenheid, executor_id, date, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, date('now')), ?)`
    )
    .run(
      req.params.propertyId, category, description, ruimte || null, aantal || 1, eenheid || 'p/st',
      executor_id || req.user.id, date || null, remark || null
    );

  logAudit({
    propertyId: property.id,
    userId: req.user.id,
    action: 'WERKZAAMHEID_GEREGISTREERD',
    details: { category, description, ruimte, aantal, eenheid },
  });

  res.status(201).json(db.prepare('SELECT * FROM work_items WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:itemId', (req, res) => {
  const existing = db
    .prepare('SELECT * FROM work_items WHERE id = ? AND property_id = ?')
    .get(req.params.itemId, req.params.propertyId);
  if (!existing) return res.status(404).json({ error: 'Werkzaamheid niet gevonden' });

  try {
    guardMutation(req.params.propertyId, req.user.id);
  } catch (err) {
    if (err instanceof DossierLockedError) return res.status(403).json({ error: err.message });
    throw err;
  }

  const { category, description, status, remark, executor_id, date, ruimte, aantal, eenheid } = req.body;
  db.prepare(
    `UPDATE work_items SET category=?, description=?, status=?, remark=?, executor_id=?, date=?, ruimte=?, aantal=?, eenheid=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    category ?? existing.category,
    description ?? existing.description,
    status ?? existing.status,
    remark ?? existing.remark,
    executor_id ?? existing.executor_id,
    date ?? existing.date,
    ruimte ?? existing.ruimte,
    aantal ?? existing.aantal,
    eenheid ?? existing.eenheid,
    req.params.itemId
  );

  if (status && status !== existing.status) {
    logAudit({
      propertyId: Number(req.params.propertyId),
      userId: req.user.id,
      action: 'WERKZAAMHEID_STATUS_GEWIJZIGD',
      details: { itemId: existing.id, from: existing.status, to: status },
    });
  }

  res.json(db.prepare('SELECT * FROM work_items WHERE id = ?').get(req.params.itemId));
});

router.delete('/:itemId', (req, res) => {
  try {
    guardMutation(req.params.propertyId, req.user.id);
  } catch (err) {
    if (err instanceof DossierLockedError) return res.status(403).json({ error: err.message });
    throw err;
  }
  db.prepare('DELETE FROM work_items WHERE id = ? AND property_id = ?').run(req.params.itemId, req.params.propertyId);
  res.status(204).end();
});

export default router;
