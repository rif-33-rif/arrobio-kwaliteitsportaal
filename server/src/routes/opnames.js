import { Router } from 'express';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { OPNAME_ROOMS } from '../db/opnameDefaults.js';
import { templatePath, templateExists, parseTemplate, reconcileProducts, fillTemplate } from '../lib/opnameTemplate.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const router = Router();
router.use(requireAuth);

const ROOM_KEYS = new Set(OPNAME_ROOMS.map((r) => r.key));

function getOpname(id) {
  return db
    .prepare(
      `SELECT o.*, u.name AS created_by_name,
              (SELECT COUNT(*) FROM opname_lines l WHERE l.opname_id = o.id) AS line_count
       FROM opnames o LEFT JOIN users u ON u.id = o.created_by WHERE o.id = ?`
    )
    .get(id);
}

function loadOpname(req, res) {
  const opname = getOpname(req.params.id);
  if (!opname) {
    res.status(404).json({ error: 'Opname niet gevonden' });
    return null;
  }
  return opname;
}

// Een afgeronde opname is vergrendeld totdat iemand hem expliciet heropent.
function ensureEditable(opname, res) {
  if (opname.status === 'afgerond') {
    res.status(409).json({ error: 'Deze opname is afgerond. Heropen hem om te wijzigen.' });
    return false;
  }
  return true;
}

function touch(id) {
  db.prepare("UPDATE opnames SET updated_at = datetime('now') WHERE id = ?").run(id);
}

// Regels samengevoegd met productgegevens. Losse regels hebben zelf omschrijving/eenheid.
function loadLines(opnameId) {
  return db
    .prepare(
      `SELECT l.id, l.product_id, l.room, l.aantal, l.remark,
              COALESCE(p.description, l.description) AS description,
              COALESCE(p.unit, l.unit) AS unit,
              p.sort_order
       FROM opname_lines l LEFT JOIN opname_products p ON p.id = l.product_id
       WHERE l.opname_id = ?
       ORDER BY (l.product_id IS NULL), p.sort_order, l.id`
    )
    .all(opnameId);
}

// ---------- Productlijst (de standaardregels van het formulier) ----------

router.get('/products', (req, res) => {
  const all = req.query.all === '1';
  const rows = db
    .prepare(`SELECT * FROM opname_products ${all ? '' : 'WHERE active = 1'} ORDER BY sort_order, id`)
    .all();
  res.json(rows);
});

router.post('/products', requireRole('beheerder', 'manager'), (req, res) => {
  const description = String(req.body.description || '').trim();
  const unit = String(req.body.unit || 'p/st').trim();
  if (!description) return res.status(400).json({ error: 'Omschrijving is verplicht' });
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM opname_products').get().m;
  const result = db
    .prepare('INSERT INTO opname_products (description, unit, sort_order) VALUES (?, ?, ?)')
    .run(description, unit, max + 10);
  res.status(201).json(db.prepare('SELECT * FROM opname_products WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/products/:productId', requireRole('beheerder', 'manager'), (req, res) => {
  const existing = db.prepare('SELECT * FROM opname_products WHERE id = ?').get(req.params.productId);
  if (!existing) return res.status(404).json({ error: 'Product niet gevonden' });
  const description = String(req.body.description ?? existing.description).trim();
  const unit = String(req.body.unit ?? existing.unit).trim();
  if (!description) return res.status(400).json({ error: 'Omschrijving is verplicht' });
  const active = req.body.active === undefined ? existing.active : req.body.active ? 1 : 0;
  db.prepare('UPDATE opname_products SET description = ?, unit = ?, active = ? WHERE id = ?').run(
    description, unit, active, existing.id
  );
  res.json(db.prepare('SELECT * FROM opname_products WHERE id = ?').get(existing.id));
});

// Ruimtelijst voor de frontend, zodat de lijst op één plek (de server) staat.
router.get('/rooms', (req, res) => res.json(OPNAME_ROOMS));

// ---------- Excel-sjabloon van de opdrachtgever ----------

router.get('/template', (req, res) => {
  const exists = templateExists();
  res.json({
    exists,
    uploaded_at: exists ? fs.statSync(templatePath()).mtime.toISOString() : null,
    linked_products: db.prepare('SELECT COUNT(*) AS c FROM opname_products WHERE template_row IS NOT NULL AND active = 1').get().c,
  });
});

router.post('/template', requireRole('beheerder', 'manager'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Geen bestand ontvangen' });
  if (!/\.xlsx$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Alleen .xlsx-bestanden zijn toegestaan' });

  let items;
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    items = parseTemplate(workbook);
  } catch (err) {
    return res.status(400).json({ error: `Het bestand kon niet worden gelezen: ${err.message}` });
  }
  if (!items.length) {
    return res.status(400).json({ error: 'Geen elektraregels gevonden. Verwacht een sectie "Electra" met ruimtekolommen vanaf kolom E.' });
  }

  fs.mkdirSync(path.dirname(templatePath()), { recursive: true });
  fs.writeFileSync(templatePath(), req.file.buffer);
  const stats = reconcileProducts(db, items);
  logAudit({ userId: req.user.id, action: 'OPNAME_SJABLOON_GEUPLOAD', details: { filename: req.file.originalname, rows: items.length, ...stats } });
  res.json({ rows: items.length, ...stats });
});

// ---------- Opnames ----------

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, u.name AS created_by_name,
              (SELECT COUNT(*) FROM opname_lines l WHERE l.opname_id = o.id) AS line_count
       FROM opnames o LEFT JOIN users u ON u.id = o.created_by
       ORDER BY o.datum DESC, o.id DESC`
    )
    .all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const project = String(req.body.project || '').trim();
  const address = String(req.body.address || '').trim();
  if (!project || !address) return res.status(400).json({ error: 'Project en adres zijn verplicht' });
  const result = db
    .prepare(
      `INSERT INTO opnames (project, address, datum, planning, notities, created_by)
       VALUES (?, ?, COALESCE(?, date('now')), ?, ?, ?)`
    )
    .run(project, address, req.body.datum || null, req.body.planning || null, req.body.notities || null, req.user.id);
  logAudit({ userId: req.user.id, action: 'OPNAME_AANGEMAAKT', details: { opnameId: result.lastInsertRowid, project, address } });
  res.status(201).json(getOpname(result.lastInsertRowid));
});

router.get('/:id', (req, res) => {
  const opname = loadOpname(req, res);
  if (!opname) return;
  res.json({ ...opname, lines: loadLines(opname.id) });
});

router.put('/:id', (req, res) => {
  const opname = loadOpname(req, res);
  if (!opname) return;

  // Statuswissel (afronden / heropenen) mag altijd; andere wijzigingen alleen in concept.
  const { status } = req.body;
  if (status && !['concept', 'afgerond'].includes(status)) {
    return res.status(400).json({ error: 'Ongeldige status' });
  }
  const changesStatus = status && status !== opname.status;
  const touchesFields = ['project', 'address', 'datum', 'planning', 'notities'].some((k) => req.body[k] !== undefined);
  if (touchesFields && !changesStatus && !ensureEditable(opname, res)) return;

  const project = String(req.body.project ?? opname.project).trim();
  const address = String(req.body.address ?? opname.address).trim();
  if (!project || !address) return res.status(400).json({ error: 'Project en adres zijn verplicht' });

  db.prepare(
    `UPDATE opnames SET project=?, address=?, datum=?, planning=?, notities=?, status=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    project, address,
    req.body.datum ?? opname.datum,
    req.body.planning ?? opname.planning,
    req.body.notities ?? opname.notities,
    status ?? opname.status,
    opname.id
  );
  if (changesStatus) {
    logAudit({
      userId: req.user.id,
      action: status === 'afgerond' ? 'OPNAME_AFGEROND' : 'OPNAME_HEROPEND',
      details: { opnameId: opname.id },
    });
  }
  res.json(getOpname(opname.id));
});

router.delete('/:id', (req, res) => {
  const opname = loadOpname(req, res);
  if (!opname) return;
  const privileged = ['beheerder', 'manager'].includes(req.user.role);
  if (!privileged && !(opname.created_by === req.user.id && opname.status === 'concept')) {
    return res.status(403).json({ error: 'Alleen de maker (bij een concept), een manager of beheerder mag een opname verwijderen' });
  }
  db.prepare('DELETE FROM opnames WHERE id = ?').run(opname.id);
  logAudit({ userId: req.user.id, action: 'OPNAME_VERWIJDERD', details: { opnameId: opname.id, project: opname.project, address: opname.address } });
  res.status(204).end();
});

// ---------- Regels ----------

// Zet het aantal van een standaardproduct in een ruimte. Aantal 0 verwijdert de regel.
router.put('/:id/lines', (req, res) => {
  const opname = loadOpname(req, res);
  if (!opname || !ensureEditable(opname, res)) return;

  const { product_id, room } = req.body;
  if (!ROOM_KEYS.has(room)) return res.status(400).json({ error: 'Onbekende ruimte' });
  if (!db.prepare('SELECT 1 FROM opname_products WHERE id = ?').get(product_id)) {
    return res.status(400).json({ error: 'Onbekend product' });
  }

  const existing = db
    .prepare('SELECT id, aantal, remark FROM opname_lines WHERE opname_id = ? AND product_id = ? AND room = ?')
    .get(opname.id, product_id, room);
  // Zonder `aantal` in het verzoek blijft het aantal staan (nodig om alleen een opmerking te wijzigen).
  const aantal = req.body.aantal === undefined ? existing?.aantal : Number(req.body.aantal);
  if (aantal === undefined) return res.status(400).json({ error: 'Aantal ontbreekt' });
  if (!Number.isFinite(aantal) || aantal < 0 || aantal > 100000) return res.status(400).json({ error: 'Ongeldig aantal' });
  const remark = req.body.remark === undefined ? (existing?.remark ?? null) : String(req.body.remark).trim().slice(0, 300) || null;

  if (aantal === 0) {
    if (existing) db.prepare('DELETE FROM opname_lines WHERE id = ?').run(existing.id);
  } else if (existing) {
    db.prepare("UPDATE opname_lines SET aantal = ?, remark = ?, updated_at = datetime('now') WHERE id = ?").run(aantal, remark, existing.id);
  } else {
    db.prepare('INSERT INTO opname_lines (opname_id, product_id, room, aantal, remark) VALUES (?, ?, ?, ?, ?)').run(
      opname.id, product_id, room, aantal, remark
    );
  }
  touch(opname.id);
  res.json({ ok: true });
});

// Losse regel die niet op de standaardlijst staat.
router.post('/:id/extra-lines', (req, res) => {
  const opname = loadOpname(req, res);
  if (!opname || !ensureEditable(opname, res)) return;

  const description = String(req.body.description || '').trim();
  const unit = String(req.body.unit || 'p/st').trim();
  const aantal = Number(req.body.aantal ?? 1);
  if (!description) return res.status(400).json({ error: 'Omschrijving is verplicht' });
  if (!ROOM_KEYS.has(req.body.room)) return res.status(400).json({ error: 'Onbekende ruimte' });
  if (!Number.isFinite(aantal) || aantal <= 0 || aantal > 100000) return res.status(400).json({ error: 'Ongeldig aantal' });

  const remark = String(req.body.remark || '').trim().slice(0, 300) || null;
  const result = db
    .prepare('INSERT INTO opname_lines (opname_id, room, aantal, description, unit, remark) VALUES (?, ?, ?, ?, ?, ?)')
    .run(opname.id, req.body.room, aantal, description, unit, remark);
  touch(opname.id);
  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/:id/extra-lines/:lineId', (req, res) => {
  const opname = loadOpname(req, res);
  if (!opname || !ensureEditable(opname, res)) return;
  const line = db
    .prepare('SELECT * FROM opname_lines WHERE id = ? AND opname_id = ? AND product_id IS NULL')
    .get(req.params.lineId, opname.id);
  if (!line) return res.status(404).json({ error: 'Regel niet gevonden' });
  const aantal = req.body.aantal === undefined ? line.aantal : Number(req.body.aantal);
  if (!Number.isFinite(aantal) || aantal < 0 || aantal > 100000) return res.status(400).json({ error: 'Ongeldig aantal' });
  const remark = req.body.remark === undefined ? line.remark : String(req.body.remark).trim().slice(0, 300) || null;
  if (aantal === 0) db.prepare('DELETE FROM opname_lines WHERE id = ?').run(line.id);
  else db.prepare("UPDATE opname_lines SET aantal = ?, remark = ?, updated_at = datetime('now') WHERE id = ?").run(aantal, remark, line.id);
  touch(opname.id);
  res.json({ ok: true });
});

// ---------- Excel om te delen ----------

// Is het Excel-sjabloon van de opdrachtgever geüpload, dan krijgt de gebruiker hun eigen bestand
// ingevuld terug (hun formules rekenen de prijzen uit). Anders valt dit terug op een eigen,
// simpele indeling: alle regels als rijen (ook lege) en alle ruimtes als kolommen.
router.get('/:id/xlsx', async (req, res) => {
  const opname = loadOpname(req, res);
  if (!opname) return;
  const lines = loadLines(opname.id);

  const downloadName = `opname-${opname.address}`.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').toLowerCase();
  const sendWorkbook = async (workbook) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
    logAudit({ userId: req.user.id, action: 'OPNAME_EXCEL_GEMAAKT', details: { opnameId: opname.id, sjabloon: templateExists() } });
  };

  if (templateExists()) {
    const allProducts = db.prepare('SELECT * FROM opname_products').all();
    return sendWorkbook(await fillTemplate({ opname, lines, products: allProducts }));
  }

  const usedProductIds = new Set(lines.filter((l) => l.product_id).map((l) => l.product_id));
  const products = db
    .prepare('SELECT * FROM opname_products ORDER BY sort_order, id')
    .all()
    .filter((p) => p.active || usedProductIds.has(p.id));

  const qty = new Map(); // `${product_id}|${room}` -> aantal
  for (const l of lines.filter((x) => x.product_id)) qty.set(`${l.product_id}|${l.room}`, l.aantal);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Arrobio Kwaliteitsportaal';
  const ws = wb.addWorksheet('Opname');

  const info = [
    ['Project', opname.project],
    ['Adres', opname.address],
    ['Planning', opname.planning || ''],
    ['Datum', opname.datum],
    ['Opmerkingen', opname.notities || ''],
  ];
  info.forEach(([k, v], i) => {
    ws.getCell(i + 1, 1).value = k;
    ws.getCell(i + 1, 1).font = { bold: true };
    ws.getCell(i + 1, 2).value = v;
  });

  const headerRow = info.length + 2;
  const headers = ['Omschrijving', 'Eenheid', ...OPNAME_ROOMS.map((r) => r.short), 'Totaal'];
  headers.forEach((h, i) => {
    const c = ws.getCell(headerRow, i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF0EC' } };
    c.alignment = { horizontal: i < 2 ? 'left' : 'center' };
  });

  let rowNo = headerRow + 1;
  const writeRow = (description, unit, byRoom) => {
    ws.getCell(rowNo, 1).value = description;
    ws.getCell(rowNo, 2).value = unit;
    let total = 0;
    OPNAME_ROOMS.forEach((r, i) => {
      const v = byRoom[r.key];
      if (v) {
        const c = ws.getCell(rowNo, i + 3);
        c.value = v;
        c.alignment = { horizontal: 'center' };
        total += v;
      }
    });
    if (total) {
      const c = ws.getCell(rowNo, OPNAME_ROOMS.length + 3);
      c.value = Math.round(total * 100) / 100;
      c.font = { bold: true };
      c.alignment = { horizontal: 'center' };
    }
    rowNo += 1;
  };

  for (const p of products) {
    const byRoom = {};
    for (const r of OPNAME_ROOMS) byRoom[r.key] = qty.get(`${p.id}|${r.key}`) || 0;
    writeRow(p.description, p.unit, byRoom);
  }

  // Losse extra regels onderaan, gegroepeerd per omschrijving.
  const extras = new Map();
  for (const l of lines.filter((x) => !x.product_id)) {
    const key = `${l.description}|${l.unit}`;
    if (!extras.has(key)) extras.set(key, { description: l.description, unit: l.unit, byRoom: {} });
    const e = extras.get(key);
    e.byRoom[l.room] = (e.byRoom[l.room] || 0) + l.aantal;
  }
  if (extras.size) {
    rowNo += 1;
    ws.getCell(rowNo, 1).value = 'Extra regels (niet op de standaardlijst)';
    ws.getCell(rowNo, 1).font = { bold: true };
    rowNo += 1;
    for (const e of extras.values()) writeRow(e.description, e.unit, e.byRoom);
  }

  ws.getColumn(1).width = 58;
  ws.getColumn(2).width = 10;
  for (let i = 3; i <= OPNAME_ROOMS.length + 3; i++) ws.getColumn(i).width = 8;
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: headerRow }];

  await sendWorkbook(wb);
});

// ---------- PDF om te delen ----------

router.get('/:id/pdf', (req, res) => {
  const opname = loadOpname(req, res);
  if (!opname) return;
  const lines = loadLines(opname.id);

  // Alleen ruimtes en regels die daadwerkelijk zijn ingevuld, in formulier-volgorde.
  const usedRooms = OPNAME_ROOMS.filter((r) => lines.some((l) => l.room === r.key));
  const rowMap = new Map();
  for (const l of lines) {
    const key = l.product_id ? `p${l.product_id}` : `x${l.id}`;
    if (!rowMap.has(key)) rowMap.set(key, { description: l.description, unit: l.unit, byRoom: {}, total: 0 });
    const row = rowMap.get(key);
    row.byRoom[l.room] = (row.byRoom[l.room] || 0) + l.aantal;
    row.total += l.aantal;
  }
  const rows = [...rowMap.values()];

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  const safeName = `opname-${opname.address}`.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').toLowerCase();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
  doc.pipe(res);

  const left = doc.page.margins.left;
  const usableWidth = doc.page.width - left - doc.page.margins.right;
  const unitW = 38;
  const totalW = 42;
  const roomW = usedRooms.length ? Math.min(46, Math.max(28, (usableWidth - 260 - unitW - totalW) / usedRooms.length)) : 0;
  const descW = usableWidth - unitW - totalW - roomW * usedRooms.length;
  const rowH = 18;

  doc.fontSize(16).fillColor('#1a1a1a').text('Woningopname Electra', left, 36);
  doc.fontSize(10).fillColor('#000');
  doc.text(`Project: ${opname.project}`, left, 60);
  doc.text(`Adres: ${opname.address}`);
  doc.text(`Datum: ${opname.datum}${opname.planning ? `    Planning: ${opname.planning}` : ''}`);
  if (opname.created_by_name) doc.text(`Opgenomen door: ${opname.created_by_name}`);
  if (opname.notities) doc.moveDown(0.3).text(`Opmerkingen: ${opname.notities}`, { width: usableWidth });

  function drawHeader(y) {
    doc.rect(left, y, usableWidth, rowH).fill('#eaf0ec');
    doc.fillColor('#1a1a1a').fontSize(8.5);
    let x = left;
    doc.text('Omschrijving', x + 4, y + 5, { width: descW - 8, lineBreak: false });
    x += descW;
    doc.text('Eenh.', x, y + 5, { width: unitW, align: 'center', lineBreak: false });
    x += unitW;
    for (const r of usedRooms) {
      doc.text(r.short, x, y + 5, { width: roomW, align: 'center', lineBreak: false });
      x += roomW;
    }
    doc.text('Totaal', x, y + 5, { width: totalW, align: 'center', lineBreak: false });
    doc.fillColor('#000');
  }

  const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace('.', ','));

  let y = doc.y + 12;
  if (!rows.length) {
    doc.fontSize(10).text('Er zijn nog geen regels ingevuld.', left, y);
  } else {
    drawHeader(y);
    y += rowH;
    doc.fontSize(8.5);
    rows.forEach((row, i) => {
      if (y + rowH > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader(y);
        y += rowH;
        doc.fontSize(8.5);
      }
      if (i % 2 === 1) doc.rect(left, y, usableWidth, rowH).fill('#f6f8f7').fillColor('#000');
      let x = left;
      doc.text(row.description, x + 4, y + 5, { width: descW - 8, height: rowH - 4, ellipsis: true, lineBreak: false });
      x += descW;
      doc.text(row.unit || '', x, y + 5, { width: unitW, align: 'center', lineBreak: false });
      x += unitW;
      for (const r of usedRooms) {
        doc.text(row.byRoom[r.key] ? fmt(row.byRoom[r.key]) : '', x, y + 5, { width: roomW, align: 'center', lineBreak: false });
        x += roomW;
      }
      doc.font('Helvetica-Bold').text(fmt(row.total), x, y + 5, { width: totalW, align: 'center', lineBreak: false });
      doc.font('Helvetica');
      doc.moveTo(left, y + rowH).lineTo(left + usableWidth, y + rowH).strokeColor('#dde2df').lineWidth(0.5).stroke();
      y += rowH;
    });
  }

  doc.end();
  logAudit({ userId: req.user.id, action: 'OPNAME_PDF_GEMAAKT', details: { opnameId: opname.id } });
});

export default router;
