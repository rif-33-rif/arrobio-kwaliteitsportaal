import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { assertFourEyes, FourEyesViolationError } from '../lib/fourEyes.js';
import { assertValidTransition } from '../lib/statusRules.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT tr.*, u.name AS reviewer_name FROM technical_reviews tr
       JOIN users u ON u.id = tr.reviewer_id
       WHERE tr.property_id = ? ORDER BY tr.created_at DESC`
    )
    .all(req.params.propertyId);
  res.json(rows);
});

// Tweede technische controle / hercontrole. Uitsluitend de rol 'controleur' mag dit
// uitvoeren — dit is de kern van het vierogenprincipe (sectie 2, 15) en mag niet
// worden overgeslagen of uitgevoerd door de uitvoerder zelf.
router.post('/', requireRole('controleur'), (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.propertyId);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });

  if (!['GEREED_VOOR_CONTROLE', 'GEREED_VOOR_HERCONTROLE'].includes(property.status)) {
    return res.status(400).json({ error: `Controle kan alleen worden uitgevoerd vanuit GEREED_VOOR_CONTROLE of GEREED_VOOR_HERCONTROLE (huidige status: ${property.status})` });
  }

  try {
    assertFourEyes(req.params.propertyId, req.user.id);
  } catch (err) {
    if (err instanceof FourEyesViolationError) return res.status(403).json({ error: err.message });
    throw err;
  }

  const { remarks, result } = req.body;
  if (!['goedgekeurd', 'herstel_nodig'].includes(result)) {
    return res.status(400).json({ error: 'Resultaat moet "goedgekeurd" of "herstel_nodig" zijn' });
  }

  const openFindings = db
    .prepare(`SELECT * FROM findings WHERE property_id = ? AND status IN ('open', 'in_behandeling')`)
    .all(req.params.propertyId);
  const readyFindings = db
    .prepare(`SELECT * FROM findings WHERE property_id = ? AND status = 'gereed_voor_hercontrole'`)
    .all(req.params.propertyId);

  if (result === 'goedgekeurd' && openFindings.length > 0) {
    return res.status(400).json({
      error: 'Er staan nog openstaande bevindingen die eerst hersteld moeten worden',
      missing: openFindings.map((f) => `#${f.finding_number} ${f.description}`),
    });
  }
  if (result === 'herstel_nodig' && openFindings.length === 0 && readyFindings.length === 0) {
    return res.status(400).json({ error: 'Registreer eerst minstens één bevinding voordat "herstel nodig" wordt vastgelegd' });
  }

  const newStatus = result === 'goedgekeurd' ? 'TECHNISCH_GOEDGEKEURD' : 'HERSTEL_NODIG';
  try {
    assertValidTransition(property.status, newStatus);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const insertResult = db
    .prepare(
      `INSERT INTO technical_reviews (property_id, reviewer_id, remarks, result) VALUES (?, ?, ?, ?)`
    )
    .run(req.params.propertyId, req.user.id, remarks || null, result);

  if (result === 'goedgekeurd') {
    for (const f of readyFindings) {
      db.prepare(`UPDATE findings SET status='afgesloten', updated_at=datetime('now') WHERE id=?`).run(f.id);
      logAudit({ propertyId: property.id, userId: req.user.id, action: 'BEVINDING_AFGESLOTEN', details: { findingNumber: f.finding_number } });
    }
  } else {
    for (const f of readyFindings) {
      db.prepare(`UPDATE findings SET status='in_behandeling', updated_at=datetime('now') WHERE id=?`).run(f.id);
      logAudit({ propertyId: property.id, userId: req.user.id, action: 'HERCONTROLE_AFGEKEURD', details: { findingNumber: f.finding_number } });
    }
  }

  db.prepare(`UPDATE properties SET status=?, updated_at=datetime('now') WHERE id=?`).run(newStatus, req.params.propertyId);
  logAudit({
    propertyId: property.id,
    userId: req.user.id,
    action: property.status === 'GEREED_VOOR_HERCONTROLE' ? 'HERCONTROLE_UITGEVOERD' : 'TWEEDE_CONTROLE_UITGEVOERD',
    fromStatus: property.status,
    toStatus: newStatus,
    details: { result, remarks },
  });

  res.status(201).json(db.prepare('SELECT * FROM technical_reviews WHERE id = ?').get(insertResult.lastInsertRowid));
});

export default router;
