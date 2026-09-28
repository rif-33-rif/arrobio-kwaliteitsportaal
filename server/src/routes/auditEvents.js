import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Alleen de Beheerder ziet de volledige, systeembrede audittrail (sectie 3, 21).
router.get('/', requireRole('beheerder'), (req, res) => {
  const { property_id, user_id, action, date_from, date_to } = req.query;
  let sql = `SELECT ae.*, u.name AS user_name, p.address, p.huisnummer, p.werkbonnummer
             FROM audit_events ae
             LEFT JOIN users u ON u.id = ae.user_id
             LEFT JOIN properties p ON p.id = ae.property_id
             WHERE 1=1`;
  const params = [];
  if (property_id) { sql += ' AND ae.property_id = ?'; params.push(property_id); }
  if (user_id) { sql += ' AND ae.user_id = ?'; params.push(user_id); }
  if (action) { sql += ' AND ae.action = ?'; params.push(action); }
  if (date_from) { sql += ' AND date(ae.created_at) >= date(?)'; params.push(date_from); }
  if (date_to) { sql += ' AND date(ae.created_at) <= date(?)'; params.push(date_to); }
  sql += ' ORDER BY ae.created_at DESC LIMIT 500';

  res.json(db.prepare(sql).all(...params));
});

router.get('/actions', requireRole('beheerder'), (req, res) => {
  res.json(db.prepare('SELECT DISTINCT action FROM audit_events ORDER BY action').all().map((r) => r.action));
});

export default router;
