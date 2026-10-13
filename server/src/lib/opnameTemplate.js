import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { uploadsRoot } from './paths.js';
import { OPNAME_ROOMS } from '../db/opnameDefaults.js';

// Het Excel-sjabloon van de opdrachtgever ("Onderaannemerslijst ... Eigen Haard"):
//  - kolom A omschrijving, B eenheid, D prijs (blijft in het sjabloon, wordt niet in de database bewaard)
//  - kolommen E t/m Q = hoeveelheid per ruimte, in de volgorde van OPNAME_ROOMS
//  - secties beginnen met een kopregel waarin E "Alg." bevat
//  - bovenaan de projectgegevens in kolom D (rijen 7 t/m 13)
// De prijzen staan in dit bestand en horen niet in git; het sjabloon wordt daarom door een
// manager in de app geüpload en op het (permanente) volume bewaard.

export const templatePath = () => path.join(uploadsRoot, '_templates', 'opname-sjabloon.xlsx');
export const templateExists = () => fs.existsSync(templatePath());

const FIRST_ROOM_COLUMN = 5; // E
const LAST_ROOM_COLUMN = FIRST_ROOM_COLUMN + OPNAME_ROOMS.length - 1; // Q
export const roomColumn = (roomKey) => FIRST_ROOM_COLUMN + OPNAME_ROOMS.findIndex((r) => r.key === roomKey);

// Welke secties horen bij de elektrawerkzaamheden die Jan opneemt.
const SECTION_ON = /^\s*e(lek|lec)tra\s*$|aanvullingen e(lek|lec)tra/i;
const SECTION_OFF = /vrije sector|algemene aanvullingen|sloop|schoonmaak/i;

const cellValue = (cell) => {
  let v = cell.value;
  if (v && typeof v === 'object') v = v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : '');
  return v;
};
export const normalize = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function isSectionHeader(ws, r) {
  return clean(cellValue(ws.getCell(r, FIRST_ROOM_COLUMN))) === 'Alg.';
}

// Leest de elektraregels uit het sjabloon.
export function parseTemplate(workbook) {
  const ws = workbook.worksheets[0];
  if (!ws) throw new Error('Het bestand bevat geen werkblad');
  const items = [];
  let on = false;
  let section = '';
  for (let r = 1; r <= ws.rowCount; r++) {
    const a = clean(cellValue(ws.getCell(r, 1)));
    if (isSectionHeader(ws, r)) {
      section = a;
      if (SECTION_ON.test(a)) on = true;
      else if (SECTION_OFF.test(a)) on = false;
      continue;
    }
    if (!on || !a) continue;
    const unit = clean(cellValue(ws.getCell(r, 2))) || 'p/st';
    items.push({ row: r, section, description: a.replace(/:$/, ''), unit });
  }
  return items;
}

// Zet de opnamelijst in de database gelijk met het sjabloon. Bestaande regels worden op
// (genormaliseerde) omschrijving herkend, zodat al ingevulde opnames hun regels houden.
export function reconcileProducts(db, items) {
  const existing = db.prepare('SELECT * FROM opname_products').all();
  const hasLines = db.prepare('SELECT 1 FROM opname_lines WHERE product_id = ? LIMIT 1');
  const claimed = new Set();
  const stats = { created: 0, updated: 0, deactivated: 0, kept: 0 };

  const update = db.prepare(
    'UPDATE opname_products SET description=?, unit=?, sort_order=?, active=1, template_row=?, template_section=? WHERE id=?'
  );
  const insert = db.prepare(
    'INSERT INTO opname_products (description, unit, sort_order, template_row, template_section) VALUES (?, ?, ?, ?, ?)'
  );

  db.exec('BEGIN');
  try {
    for (const item of items) {
      const key = normalize(item.description);
      const match = existing.find((p) => !claimed.has(p.id) && normalize(p.description) === key);
      if (match) {
        claimed.add(match.id);
        update.run(item.description, item.unit, item.row * 10, item.row, item.section, match.id);
        stats.updated += 1;
      } else {
        insert.run(item.description, item.unit, item.row * 10, item.row, item.section);
        stats.created += 1;
      }
    }
    for (const p of existing) {
      if (claimed.has(p.id)) continue;
      if (hasLines.get(p.id)) {
        // Staat al in een opname: laten staan, maar zonder koppeling met een sjabloonrij.
        db.prepare('UPDATE opname_products SET template_row=NULL, template_section=NULL, sort_order=? WHERE id=?').run(1000000 + p.id, p.id);
        stats.kept += 1;
      } else {
        db.prepare('UPDATE opname_products SET active=0, template_row=NULL, template_section=NULL WHERE id=?').run(p.id);
        stats.deactivated += 1;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return stats;
}

const formatDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('-') : iso || '');

// Vult het sjabloon in met de opname. Retourneert { workbook, unplaced } waarbij `unplaced`
// de regels zijn die niet in het sjabloon een plek hebben (extra regels, of een sjabloon dat
// inmiddels anders is) — die komen op een extra werkblad.
export async function fillTemplate({ opname, lines, products }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath());
  const ws = workbook.worksheets[0];

  // Voorbeeldaantallen uit het sjabloon wissen (alleen vaste getallen in de ruimtekolommen,
  // formules blijven staan).
  for (let r = 51; r <= ws.rowCount; r++) {
    if (isSectionHeader(ws, r)) continue;
    for (let c = FIRST_ROOM_COLUMN; c <= LAST_ROOM_COLUMN; c++) {
      const cell = ws.getCell(r, c);
      if (typeof cell.value === 'number') cell.value = null;
    }
  }

  ws.getCell('D7').value = formatDate(opname.datum);
  ws.getCell('D9').value = opname.created_by_name || '';
  ws.getCell('D10').value = opname.address;
  ws.getCell('D11').value = opname.project;

  const productById = new Map(products.map((p) => [p.id, p]));
  const unplaced = [];
  for (const line of lines) {
    const product = line.product_id ? productById.get(line.product_id) : null;
    let placed = false;
    if (product?.template_row) {
      const cell = ws.getCell(product.template_row, roomColumn(line.room));
      // Alleen invullen als de rij in dit bestand nog echt dezelfde regel is.
      if (normalize(cellValue(ws.getCell(product.template_row, 1))) === normalize(product.description)) {
        cell.value = (typeof cell.value === 'number' ? cell.value : 0) + line.aantal;
        placed = true;
      }
    }
    if (!placed) unplaced.push({ ...line, reason: 'Niet in het sjabloon' });
    else if (line.remark) unplaced.push({ ...line, reason: '' });
  }

  if (unplaced.length) {
    const extra = workbook.addWorksheet('Extra regels en opmerkingen');
    extra.addRow(['Ruimte', 'Omschrijving', 'Aantal', 'Eenheid', 'Opmerking', 'Let op']).font = { bold: true };
    const roomLabel = Object.fromEntries(OPNAME_ROOMS.map((r) => [r.key, r.label]));
    for (const l of unplaced) {
      extra.addRow([roomLabel[l.room] || l.room, l.description, l.aantal, l.unit, l.remark || '', l.reason]);
    }
    extra.columns = [{ width: 16 }, { width: 60 }, { width: 10 }, { width: 10 }, { width: 50 }, { width: 24 }];
  }

  // Het sjabloon rekent zelf de prijzen en totalen uit; Excel moet dat bij het openen opnieuw doen.
  workbook.calcProperties.fullCalcOnLoad = true;
  return workbook;
}
