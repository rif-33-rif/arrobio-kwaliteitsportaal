import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import db from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { q } = req.query;
  let sql = 'SELECT * FROM work_item_catalog WHERE active = 1';
  const params = [];
  if (q) {
    sql += ' AND (description LIKE ? OR code LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY description LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requireRole('beheerder', 'manager'), (req, res) => {
  const { code, discipline, description, unit, unit_price, unit_price_2026, note } = req.body;
  if (!description) return res.status(400).json({ error: 'Omschrijving is verplicht' });
  const result = db
    .prepare(
      `INSERT INTO work_item_catalog (code, discipline, description, unit, unit_price, unit_price_2026, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(code || null, discipline || null, description, unit || 'stu', unit_price || null, unit_price_2026 || null, note || null);
  res.status(201).json(db.prepare('SELECT * FROM work_item_catalog WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', requireRole('beheerder', 'manager'), (req, res) => {
  const existing = db.prepare('SELECT * FROM work_item_catalog WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Catalogusitem niet gevonden' });
  const { description, unit, unit_price, unit_price_2026, note, active } = req.body;
  db.prepare(
    `UPDATE work_item_catalog SET description=?, unit=?, unit_price=?, unit_price_2026=?, note=?, active=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    description ?? existing.description,
    unit ?? existing.unit,
    unit_price === undefined ? existing.unit_price : unit_price,
    unit_price_2026 === undefined ? existing.unit_price_2026 : unit_price_2026,
    note ?? existing.note,
    active === undefined ? existing.active : active ? 1 : 0,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM work_item_catalog WHERE id = ?').get(req.params.id));
});

// Kolomnamen worden losjes herkend (hoofdletterongevoelig, spaties genegeerd) zodat
// kleine verschillen in het Excel-sjabloon geen probleem zijn.
function normalizeHeader(h) {
  return String(h ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

const HEADER_MAP = {
  'CODERING DATABASE': 'code',
  CODE: 'code',
  DISCIPLINE: 'discipline',
  OMSCHRIJVING: 'description',
  EENHEID: 'unit',
  EENHEIDSPRIJS: 'unit_price',
  'EENHEIDSPRIJS 2026': 'unit_price_2026',
  'EXTRA TOELICHTING': 'note',
  TOELICHTING: 'note',
};

function cellText(cell) {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'object' && 'text' in cell) return cell.text;
  if (typeof cell === 'object' && 'result' in cell) return cell.result;
  return cell;
}

router.post('/import', requireRole('beheerder', 'manager'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Excel-bestand ontbreekt' });

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.file.buffer);
  } catch {
    return res.status(400).json({ error: 'Kon het Excel-bestand niet lezen' });
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount < 2) {
    return res.status(400).json({ error: 'Bestand bevat geen datarijen' });
  }

  const headerValues = worksheet.getRow(1).values; // 1-indexed, index 0 is empty
  const columnIndex = {};
  headerValues.forEach((h, i) => {
    const normalized = normalizeHeader(cellText(h));
    if (HEADER_MAP[normalized]) columnIndex[HEADER_MAP[normalized]] = i;
  });
  if (columnIndex.description === undefined) {
    return res.status(400).json({ error: 'Kolom "OMSCHRIJVING" niet gevonden in het bestand' });
  }

  const upsert = db.prepare(
    `INSERT INTO work_item_catalog (code, discipline, description, unit, unit_price, unit_price_2026, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const findByCode = db.prepare(`SELECT id FROM work_item_catalog WHERE code = ? AND code IS NOT NULL AND code != 'eigen regel'`);
  // "eigen regel" is geen echte unieke code (meerdere rijen delen deze placeholder),
  // dus die rijen dedupliceren we op omschrijving om ze niet bij elke import te verdubbelen.
  const findByDescription = db.prepare(`SELECT id FROM work_item_catalog WHERE description = ? AND (code IS NULL OR code = 'eigen regel')`);
  const updateByCode = db.prepare(
    `UPDATE work_item_catalog SET discipline=?, description=?, unit=?, unit_price=?, unit_price_2026=?, note=?, updated_at=datetime('now') WHERE id=?`
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    rows.push(row.values);
  });

  const importRows = (dataRows) => {
    db.exec('BEGIN');
    try {
    for (const row of dataRows) {
      const description = cellText(row[columnIndex.description]);
      if (!description || !String(description).trim()) { skipped++; continue; }

      const code = columnIndex.code !== undefined ? cellText(row[columnIndex.code]) : null;
      const discipline = columnIndex.discipline !== undefined ? cellText(row[columnIndex.discipline]) : null;
      const unitRaw = columnIndex.unit !== undefined ? cellText(row[columnIndex.unit]) : 'stu';
      const unit = String(unitRaw || 'stu').trim();
      const unitPriceRaw = columnIndex.unit_price !== undefined ? cellText(row[columnIndex.unit_price]) : null;
      const unitPrice = unitPriceRaw !== null && unitPriceRaw !== '' ? Number(unitPriceRaw) : null;
      const unitPrice2026Raw = columnIndex.unit_price_2026 !== undefined ? cellText(row[columnIndex.unit_price_2026]) : null;
      const unitPrice2026 = unitPrice2026Raw !== null && unitPrice2026Raw !== '' ? Number(unitPrice2026Raw) : null;
      const note = columnIndex.note !== undefined ? cellText(row[columnIndex.note]) : null;

      const codeStr = code ? String(code).trim() : null;
      const trimmedDescription = String(description).trim();
      const existing = codeStr && codeStr !== 'eigen regel'
        ? findByCode.get(codeStr)
        : findByDescription.get(trimmedDescription);

      if (existing) {
        updateByCode.run(discipline || null, String(description).trim(), unit, unitPrice, unitPrice2026, note || null, existing.id);
        updated++;
      } else {
        upsert.run(codeStr, discipline || null, String(description).trim(), unit, unitPrice, unitPrice2026, note || null);
        created++;
      }
    }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  importRows(rows);

  logAudit({ userId: req.user.id, action: 'WERKZAAMHEDENCATALOGUS_GEIMPORTEERD', details: { created, updated, skipped, filename: req.file.originalname } });

  res.json({ created, updated, skipped });
});

export default router;
