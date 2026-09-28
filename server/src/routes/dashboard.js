import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

function count(sql, ...params) {
  return db.prepare(sql).get(...params).n;
}

router.get('/', (req, res) => {
  const kpis = {
    actieveWoningen: count(`SELECT COUNT(*) AS n FROM properties WHERE status NOT IN ('VRIJGEGEVEN', 'GEANNULEERD')`),
    dreigendeOverschrijdingen: count(
      `SELECT COUNT(*) AS n FROM properties
       WHERE status NOT IN ('VRIJGEGEVEN', 'GEANNULEERD') AND date(actuele_opleverdatum) <= date('now', '+3 days')`
    ),
    gereedVoorControle: count(`SELECT COUNT(*) AS n FROM properties WHERE status = 'GEREED_VOOR_CONTROLE'`),
    inTweedeControle: count(
      `SELECT COUNT(*) AS n FROM properties WHERE status IN ('GEREED_VOOR_HERCONTROLE', 'HERSTEL_NODIG')`
    ),
    herstelpuntenOpen: count(`SELECT COUNT(*) AS n FROM findings WHERE status != 'afgesloten'`),
    gereedVoorManagercontrole: count(`SELECT COUNT(*) AS n FROM properties WHERE status = 'MANAGERCONTROLE'`),
    definitiefVrijgegeven: count(`SELECT COUNT(*) AS n FROM properties WHERE status = 'VRIJGEGEVEN'`),
    materiaalOnderVoorraad: count(`SELECT COUNT(*) AS n FROM materials WHERE active = 1 AND stock_quantity <= min_stock`),
  };

  const lowStockMaterials = db
    .prepare('SELECT * FROM materials WHERE active = 1 AND stock_quantity <= min_stock ORDER BY name')
    .all();

  const planningDezeWeek = db
    .prepare(
      `SELECT id, address, huisnummer, werkbonnummer, status, actuele_opleverdatum
       FROM properties
       WHERE status NOT IN ('VRIJGEGEVEN', 'GEANNULEERD') AND date(actuele_opleverdatum) <= date('now', '+7 days')
       ORDER BY actuele_opleverdatum ASC`
    )
    .all();

  const aandachtNodig = db
    .prepare(
      `SELECT id, address, huisnummer, werkbonnummer, status, actuele_opleverdatum
       FROM properties
       WHERE status = 'HERSTEL_NODIG' OR (status NOT IN ('VRIJGEGEVEN','GEANNULEERD') AND date(actuele_opleverdatum) < date('now'))
       ORDER BY actuele_opleverdatum ASC`
    )
    .all();

  const openstaandeBevindingen = db
    .prepare(
      `SELECT f.*, p.address, p.huisnummer, p.werkbonnummer FROM findings f
       JOIN properties p ON p.id = f.property_id
       WHERE f.status != 'afgesloten'
       ORDER BY CASE f.severity WHEN 'veiligheidskritisch' THEN 0 WHEN 'hoog' THEN 1 WHEN 'middel' THEN 2 ELSE 3 END, f.created_at DESC
       LIMIT 20`
    )
    .all();

  const recenteActiviteit = db
    .prepare(
      `SELECT ae.*, u.name AS user_name, p.address, p.huisnummer FROM audit_events ae
       LEFT JOIN users u ON u.id = ae.user_id
       LEFT JOIN properties p ON p.id = ae.property_id
       ORDER BY ae.created_at DESC LIMIT 25`
    )
    .all();

  res.json({ kpis, planningDezeWeek, aandachtNodig, openstaandeBevindingen, recenteActiviteit, lowStockMaterials });
});

export default router;
