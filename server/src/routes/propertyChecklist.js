import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { guardMutation, DossierLockedError } from '../lib/approvalGuard.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

function getActiveChecklist() {
  return db.prepare('SELECT * FROM checklists WHERE active = 1 ORDER BY id LIMIT 1').get();
}

router.get('/', (req, res) => {
  const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.propertyId);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });

  const checklist = getActiveChecklist();
  if (!checklist) return res.json({ checklist: null, items: [] });

  const items = db
    .prepare(
      `SELECT ci.id AS checklist_item_id, ci.text, ci.sort_order,
              cr.answer, cr.description, cr.herstelactie, cr.filled_by, cr.filled_at,
              u.name AS filled_by_name
       FROM checklist_items ci
       LEFT JOIN checklist_results cr ON cr.checklist_item_id = ci.id AND cr.property_id = ?
       LEFT JOIN users u ON u.id = cr.filled_by
       WHERE ci.checklist_id = ?
       ORDER BY ci.sort_order`
    )
    .all(req.params.propertyId, checklist.id);

  res.json({ checklist: { id: checklist.id, name: checklist.name }, items });
});

router.put('/:itemId', (req, res) => {
  const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.propertyId);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });

  const checklistItem = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(req.params.itemId);
  if (!checklistItem) return res.status(404).json({ error: 'Checklistitem niet gevonden' });

  const { answer, description, herstelactie } = req.body;
  if (!['akkoord', 'niet_akkoord', 'nvt'].includes(answer)) {
    return res.status(400).json({ error: 'Ongeldig antwoord' });
  }
  if (answer === 'niet_akkoord' && (!description || !herstelactie)) {
    return res.status(400).json({ error: 'Bij "niet akkoord" zijn omschrijving en herstelactie verplicht' });
  }
  try {
    guardMutation(req.params.propertyId, req.user.id);
  } catch (err) {
    if (err instanceof DossierLockedError) return res.status(403).json({ error: err.message });
    throw err;
  }

  db.prepare(
    `INSERT INTO checklist_results (property_id, checklist_item_id, answer, description, herstelactie, filled_by, filled_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(property_id, checklist_item_id) DO UPDATE SET
       answer = excluded.answer,
       description = excluded.description,
       herstelactie = excluded.herstelactie,
       filled_by = excluded.filled_by,
       filled_at = excluded.filled_at`
  ).run(req.params.propertyId, req.params.itemId, answer, description || null, herstelactie || null, req.user.id);

  logAudit({
    propertyId: Number(req.params.propertyId),
    userId: req.user.id,
    action: 'CHECKLIST_INGEVULD',
    details: { item: checklistItem.text, answer },
  });

  const saved = db
    .prepare(
      `SELECT cr.answer, cr.description, cr.herstelactie, cr.filled_by, cr.filled_at, u.name AS filled_by_name
       FROM checklist_results cr LEFT JOIN users u ON u.id = cr.filled_by
       WHERE cr.property_id = ? AND cr.checklist_item_id = ?`
    )
    .get(req.params.propertyId, req.params.itemId);

  res.json(saved);
});

export default router;
