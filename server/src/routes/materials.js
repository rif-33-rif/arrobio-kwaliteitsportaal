import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { low_stock } = req.query;
  let sql = 'SELECT * FROM materials WHERE active = 1';
  if (low_stock === 'true') sql += ' AND stock_quantity <= min_stock';
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all());
});

router.post('/', requireRole('beheerder', 'manager'), (req, res) => {
  const { name, sku, unit, stock_quantity, min_stock } = req.body;
  if (!name) return res.status(400).json({ error: 'Naam is verplicht' });
  try {
    const result = db
      .prepare('INSERT INTO materials (name, sku, unit, stock_quantity, min_stock) VALUES (?, ?, ?, ?, ?)')
      .run(name, sku || null, unit || 'stuk', stock_quantity || 0, min_stock || 0);
    logAudit({ userId: req.user.id, action: 'MATERIAAL_AANGEMAAKT', details: { name } });
    res.status(201).json(db.prepare('SELECT * FROM materials WHERE id = ?').get(result.lastInsertRowid));
  } catch {
    res.status(400).json({ error: 'Kon materiaal niet aanmaken (SKU mogelijk al in gebruik)' });
  }
});

router.put('/:id', requireRole('beheerder', 'manager'), (req, res) => {
  const existing = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Materiaal niet gevonden' });
  const { name, sku, unit, min_stock, active } = req.body;
  db.prepare(
    `UPDATE materials SET name=?, sku=?, unit=?, min_stock=?, active=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    name ?? existing.name,
    sku ?? existing.sku,
    unit ?? existing.unit,
    min_stock ?? existing.min_stock,
    active === undefined ? existing.active : active ? 1 : 0,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id));
});

// Handmatige voorraadmutatie: aanvulling (positief) of correctie (negatief), los van werkzaamhedenverbruik.
router.post('/:id/adjustments', requireRole('beheerder', 'manager'), (req, res) => {
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!material) return res.status(404).json({ error: 'Materiaal niet gevonden' });
  const { change, reason } = req.body;
  if (!change || !reason) return res.status(400).json({ error: 'Mutatie (aantal) en reden zijn verplicht' });

  db.prepare('INSERT INTO material_stock_adjustments (material_id, change, reason, adjusted_by) VALUES (?, ?, ?, ?)').run(
    req.params.id, change, reason, req.user.id
  );
  db.prepare('UPDATE materials SET stock_quantity = stock_quantity + ?, updated_at=datetime(\'now\') WHERE id=?').run(
    change, req.params.id
  );
  logAudit({ userId: req.user.id, action: 'VOORRAAD_AANGEPAST', details: { materialId: material.id, name: material.name, change, reason } });

  res.status(201).json(db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id));
});

router.get('/:id/adjustments', requireRole('beheerder', 'manager'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT msa.*, u.name AS adjusted_by_name FROM material_stock_adjustments msa
       LEFT JOIN users u ON u.id = msa.adjusted_by WHERE msa.material_id = ? ORDER BY msa.created_at DESC`
    )
    .all(req.params.id);
  res.json(rows);
});

export default router;
