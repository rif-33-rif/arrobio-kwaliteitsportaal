import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

function withItems(checklist) {
  const items = db
    .prepare('SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY sort_order')
    .all(checklist.id);
  return { ...checklist, items };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM checklists ORDER BY active DESC, name').all();
  res.json(rows.map(withItems));
});

router.post('/', requireRole('beheerder'), (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Naam is verplicht' });
  const result = db.prepare('INSERT INTO checklists (name) VALUES (?)').run(name);
  res.status(201).json(withItems(db.prepare('SELECT * FROM checklists WHERE id = ?').get(result.lastInsertRowid)));
});

router.put('/:id', requireRole('beheerder'), (req, res) => {
  const existing = db.prepare('SELECT * FROM checklists WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Checklist niet gevonden' });
  const { name, active } = req.body;
  db.prepare('UPDATE checklists SET name=?, active=? WHERE id=?').run(
    name ?? existing.name,
    active === undefined ? existing.active : active ? 1 : 0,
    req.params.id
  );
  res.json(withItems(db.prepare('SELECT * FROM checklists WHERE id = ?').get(req.params.id)));
});

router.post('/:id/items', requireRole('beheerder'), (req, res) => {
  const checklist = db.prepare('SELECT * FROM checklists WHERE id = ?').get(req.params.id);
  if (!checklist) return res.status(404).json({ error: 'Checklist niet gevonden' });
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Tekst is verplicht' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM checklist_items WHERE checklist_id = ?').get(req.params.id).m;
  const result = db
    .prepare('INSERT INTO checklist_items (checklist_id, text, sort_order) VALUES (?, ?, ?)')
    .run(req.params.id, text, maxOrder + 1);
  res.status(201).json(db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(result.lastInsertRowid));
});

router.delete('/:id/items/:itemId', requireRole('beheerder'), (req, res) => {
  db.prepare('DELETE FROM checklist_items WHERE id = ? AND checklist_id = ?').run(req.params.itemId, req.params.id);
  res.status(204).end();
});

export default router;
