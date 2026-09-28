import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get('/', (req, res) => {
  const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.propertyId);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });

  const rows = db
    .prepare('SELECT * FROM external_inspections WHERE property_id = ? ORDER BY date DESC')
    .all(req.params.propertyId);

  // Vergelijk interne controle versus externe keuring (sectie 25): afwijkingen zichtbaar maken.
  const internalFindings = db
    .prepare(`SELECT COUNT(*) AS n FROM findings WHERE property_id = ?`)
    .get(req.params.propertyId).n;

  res.json({ inspections: rows, internalFindingsCount: internalFindings });
});

router.post('/', requireRole('beheerder', 'manager'), (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.propertyId);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });

  const { organisation, inspector, date, report_number, findings_count, conclusion, remarks } = req.body;
  if (!organisation || !date) {
    return res.status(400).json({ error: 'Keuringsorganisatie en datum zijn verplicht' });
  }

  const result = db
    .prepare(
      `INSERT INTO external_inspections (property_id, organisation, inspector, date, report_number, findings_count, conclusion, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.params.propertyId, organisation, inspector || null, date, report_number || null, findings_count || 0, conclusion || null, remarks || null);

  logAudit({
    propertyId: property.id,
    userId: req.user.id,
    action: 'EXTERNE_KEURING_VASTGELEGD',
    details: { organisation, findings_count },
  });

  res.status(201).json(db.prepare('SELECT * FROM external_inspections WHERE id = ?').get(result.lastInsertRowid));
});

export default router;
