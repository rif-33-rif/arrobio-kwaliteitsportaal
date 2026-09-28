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
      `SELECT m.*, u.name AS performed_by_name FROM measurements m
       LEFT JOIN users u ON u.id = m.performed_by
       WHERE m.property_id = ? ORDER BY m.measured_at DESC`
    )
    .all(req.params.propertyId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.propertyId);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });

  const { type, value, unit, result, instrument, remark } = req.body;
  if (!type || value === undefined || value === '') {
    return res.status(400).json({ error: 'Type meting en meetwaarde zijn verplicht' });
  }
  try {
    guardMutation(req.params.propertyId, req.user.id);
  } catch (err) {
    if (err instanceof DossierLockedError) return res.status(403).json({ error: err.message });
    throw err;
  }

  const insertResult = db
    .prepare(
      `INSERT INTO measurements (property_id, type, value, unit, result, performed_by, instrument, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.params.propertyId, type, String(value), unit || null, result || null, req.user.id, instrument || null, remark || null);

  logAudit({
    propertyId: property.id,
    userId: req.user.id,
    action: 'METING_VASTGELEGD',
    details: { type, value, unit },
  });

  res.status(201).json(db.prepare('SELECT * FROM measurements WHERE id = ?').get(insertResult.lastInsertRowid));
});

router.delete('/:measurementId', (req, res) => {
  db.prepare('DELETE FROM measurements WHERE id = ? AND property_id = ?').run(req.params.measurementId, req.params.propertyId);
  res.status(204).end();
});

export default router;
