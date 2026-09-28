import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { guardMutation, DossierLockedError } from '../lib/approvalGuard.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

function ensureWorkItem(propertyId, itemId, res) {
  const item = db.prepare('SELECT * FROM work_items WHERE id = ? AND property_id = ?').get(itemId, propertyId);
  if (!item) {
    res.status(404).json({ error: 'Werkzaamheid niet gevonden' });
    return null;
  }
  return item;
}

router.get('/', (req, res) => {
  if (!ensureWorkItem(req.params.propertyId, req.params.itemId, res)) return;
  const rows = db
    .prepare(
      `SELECT wim.*, m.name, m.unit FROM work_item_materials wim
       JOIN materials m ON m.id = wim.material_id WHERE wim.work_item_id = ? ORDER BY wim.created_at`
    )
    .all(req.params.itemId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const item = ensureWorkItem(req.params.propertyId, req.params.itemId, res);
  if (!item) return;

  const { material_id, quantity } = req.body;
  if (!material_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'Materiaal en een positief aantal zijn verplicht' });
  }
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(material_id);
  if (!material) return res.status(404).json({ error: 'Materiaal niet gevonden' });

  try {
    guardMutation(req.params.propertyId, req.user.id);
  } catch (err) {
    if (err instanceof DossierLockedError) return res.status(403).json({ error: err.message });
    throw err;
  }

  const result = db
    .prepare('INSERT INTO work_item_materials (work_item_id, material_id, quantity, registered_by) VALUES (?, ?, ?, ?)')
    .run(req.params.itemId, material_id, quantity, req.user.id);
  db.prepare('UPDATE materials SET stock_quantity = stock_quantity - ?, updated_at=datetime(\'now\') WHERE id=?').run(
    quantity, material_id
  );

  logAudit({
    propertyId: Number(req.params.propertyId),
    userId: req.user.id,
    action: 'MATERIAAL_VERBRUIKT',
    details: { material: material.name, quantity, workItemId: item.id },
  });

  res.status(201).json(db.prepare('SELECT * FROM work_item_materials WHERE id = ?').get(result.lastInsertRowid));
});

router.delete('/:usageId', (req, res) => {
  const usage = db
    .prepare('SELECT * FROM work_item_materials WHERE id = ? AND work_item_id = ?')
    .get(req.params.usageId, req.params.itemId);
  if (!usage) return res.status(404).json({ error: 'Materiaalregel niet gevonden' });

  try {
    guardMutation(req.params.propertyId, req.user.id);
  } catch (err) {
    if (err instanceof DossierLockedError) return res.status(403).json({ error: err.message });
    throw err;
  }

  db.prepare('UPDATE materials SET stock_quantity = stock_quantity + ?, updated_at=datetime(\'now\') WHERE id=?').run(
    usage.quantity, usage.material_id
  );
  db.prepare('DELETE FROM work_item_materials WHERE id = ?').run(usage.id);
  logAudit({
    propertyId: Number(req.params.propertyId),
    userId: req.user.id,
    action: 'MATERIAALVERBRUIK_VERWIJDERD',
    details: { usageId: usage.id },
  });
  res.status(204).end();
});

export default router;
