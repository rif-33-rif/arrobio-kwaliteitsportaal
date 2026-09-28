import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';

const THEMES = [
  'planning', 'communicatie', 'vierogencontrole', 'opleverdossier',
  'bevindingen', 'herstel', 'herhaling', 'onafhankelijke_keuringen',
];

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { period, theme } = req.query;
  let sql = `SELECT im.*, u.name AS created_by_name FROM improvement_metrics im
             LEFT JOIN users u ON u.id = im.created_by WHERE 1=1`;
  const params = [];
  if (period) { sql += ' AND im.period = ?'; params.push(period); }
  if (theme) { sql += ' AND im.theme = ?'; params.push(theme); }
  sql += ' ORDER BY im.period DESC, im.theme';
  res.json(db.prepare(sql).all(...params));
});

router.get('/themes', (req, res) => res.json(THEMES));

router.post('/', requireRole('beheerder', 'manager'), (req, res) => {
  const { period, theme, metric_label, numerator, denominator, remark } = req.body;
  if (!period || !theme || !metric_label || numerator === undefined || denominator === undefined) {
    return res.status(400).json({ error: 'Periode, thema, omschrijving, teller en noemer zijn verplicht' });
  }
  if (!THEMES.includes(theme)) return res.status(400).json({ error: 'Ongeldig thema' });

  const result = db
    .prepare(
      `INSERT INTO improvement_metrics (period, theme, metric_label, numerator, denominator, remark, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(period, theme, metric_label, numerator, denominator, remark || null, req.user.id);

  logAudit({ userId: req.user.id, action: 'VERBETERPLAN_METING_VASTGELEGD', details: { period, theme, metric_label, numerator, denominator } });

  res.status(201).json(db.prepare('SELECT * FROM improvement_metrics WHERE id = ?').get(result.lastInsertRowid));
});

router.delete('/:id', requireRole('beheerder', 'manager'), (req, res) => {
  db.prepare('DELETE FROM improvement_metrics WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

export default router;
