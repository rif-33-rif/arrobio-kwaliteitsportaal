import { Router } from 'express';
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { uploadsRoot } from '../lib/paths.js';

const router = Router();
router.use(requireAuth);

function drawHeading(doc, text) {
  doc.moveDown(0.6).fontSize(13).fillColor('#0f3d2e').text(text, { underline: false });
  doc.fillColor('#000').fontSize(10);
}

// PDFKit's ingebouwde standaardlettertypen ondersteunen alleen WinAnsi-tekens;
// Griekse/wetenschappelijke symbolen die monteurs bij metingen gebruiken (Ω, µ, °)
// worden anders onleesbaar. Zet ze om naar een veilig ASCII-equivalent.
function pdfSafe(value) {
  if (value === null || value === undefined) return value;
  return String(value)
    .replace(/Ω/g, 'Ohm')
    .replace(/[µμ]/g, 'u')
    .replace(/°/g, 'gr')
    .replace(/±/g, '+/-');
}

router.get('/properties/:id/report', (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });

  const workItems = db
    .prepare(`SELECT wi.*, u.name AS executor_name FROM work_items wi LEFT JOIN users u ON u.id = wi.executor_id WHERE wi.property_id = ?`)
    .all(property.id);
  const materialUsage = db
    .prepare(
      `SELECT wim.*, wi.description AS work_item_description, m.name AS material_name, m.unit AS material_unit
       FROM work_item_materials wim
       JOIN work_items wi ON wi.id = wim.work_item_id
       JOIN materials m ON m.id = wim.material_id
       WHERE wi.property_id = ?`
    )
    .all(property.id);
  const checklist = db
    .prepare(
      `SELECT ci.text, cr.answer, cr.description FROM checklist_items ci
       LEFT JOIN checklist_results cr ON cr.checklist_item_id = ci.id AND cr.property_id = ?
       JOIN checklists c ON c.id = ci.checklist_id WHERE c.active = 1 ORDER BY ci.sort_order`
    )
    .all(property.id);
  const measurements = db.prepare('SELECT * FROM measurements WHERE property_id = ?').all(property.id);
  const attachments = db.prepare('SELECT * FROM attachments WHERE property_id = ? ORDER BY created_at').all(property.id);
  const findings = db.prepare('SELECT * FROM findings WHERE property_id = ? ORDER BY finding_number').all(property.id);
  const repairs = db
    .prepare(`SELECT r.*, f.finding_number FROM repairs r JOIN findings f ON f.id = r.finding_id WHERE f.property_id = ?`)
    .all(property.id);
  const technicalReviews = db
    .prepare(`SELECT tr.*, u.name AS reviewer_name FROM technical_reviews tr JOIN users u ON u.id = tr.reviewer_id WHERE tr.property_id = ? AND tr.invalidated = 0 ORDER BY tr.created_at`)
    .all(property.id);
  const managerReviews = db
    .prepare(`SELECT mr.*, u.name AS manager_name FROM manager_reviews mr JOIN users u ON u.id = mr.manager_id WHERE mr.property_id = ? ORDER BY mr.created_at`)
    .all(property.id);
  const assignments = db
    .prepare(`SELECT pa.*, u.name AS user_name FROM property_assignments pa JOIN users u ON u.id = pa.user_id WHERE pa.property_id = ? AND pa.active = 1`)
    .all(property.id);

  const existingVersions = db.prepare('SELECT COALESCE(MAX(version), 0) AS n FROM report_versions WHERE property_id = ?').get(property.id).n;
  const version = existingVersions + 1;
  const filename = `opleverrapport-${property.werkbonnummer}-v${version}.pdf`;
  db.prepare('INSERT INTO report_versions (property_id, version, filename, generated_by) VALUES (?, ?, ?, ?)').run(property.id, version, filename, req.user.id);
  logAudit({ propertyId: property.id, userId: req.user.id, action: 'RAPPORT_GEGENEREERD', details: { version, filename } });

  const doc = new PDFDocument({ margin: 50 });
  const originalText = doc.text.bind(doc);
  doc.text = (text, ...args) => originalText(pdfSafe(text), ...args);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  doc.fontSize(20).fillColor('#0f3d2e').text('Arrobio Kwaliteitsportaal', { align: 'left' });
  doc.fontSize(9).fillColor('#666').text('Digitale kwaliteitsborging mutatiewoningen');
  doc.moveDown(1);
  doc.fillColor('#000').fontSize(16).text(`Opleverrapport: ${property.address} ${property.huisnummer || ''}`);
  doc.fontSize(10).fillColor('#333').text(`${property.postcode || ''} ${property.plaats || ''}`);
  doc.moveDown(0.3);
  doc.text(`Werkbonnummer: ${property.werkbonnummer}`);
  doc.text(`Opdrachtgever: ${property.opdrachtgever}${property.project ? ' — ' + property.project : ''}`);
  doc.text(`Document-ID: RPT-${property.id}-${version}    Versienummer: ${version}    Dossierversie: ${property.dossier_version}`);
  doc.text(`Status: ${property.status}`);

  drawHeading(doc, 'Planning');
  doc.text(`Datum opdracht: ${property.datum_opdracht || '-'}`);
  doc.text(`Startdatum: ${property.startdatum || '-'}`);
  doc.text(`Oorspronkelijke geplande opleverdatum: ${property.geplande_opleverdatum}`);
  doc.text(`Actuele opleverdatum: ${property.actuele_opleverdatum}`);
  doc.text(`Werkelijke opleverdatum: ${property.werkelijke_opleverdatum || '-'}`);

  drawHeading(doc, 'Toegewezen medewerkers');
  if (assignments.length === 0) doc.text('Geen toewijzingen bekend.');
  assignments.forEach((a) => doc.text(`${a.role_in_property}: ${a.user_name}`));

  drawHeading(doc, 'Uitgevoerde werkzaamheden');
  if (workItems.length === 0) doc.text('Geen werkzaamheden geregistreerd.');
  workItems.forEach((w) => doc.text(`- [${w.category}${w.ruimte ? ' — ' + w.ruimte : ''}] ${w.description}: ${w.aantal} ${w.eenheid} (${w.status}, ${w.date}, ${w.executor_name || 'onbekend'})`));

  drawHeading(doc, 'Gebruikt materiaal');
  if (materialUsage.length === 0) doc.text('Geen materiaal geregistreerd.');
  materialUsage.forEach((m) => doc.text(`- ${m.material_name}: ${m.quantity} ${m.material_unit} — bij "${m.work_item_description}"`));

  drawHeading(doc, 'Checklist');
  if (checklist.length === 0) doc.text('Geen checklist beschikbaar.');
  checklist.forEach((c) => doc.text(`- ${c.text}: ${c.answer || 'niet ingevuld'}${c.description ? ' — ' + c.description : ''}`));

  drawHeading(doc, 'Meetgegevens');
  if (measurements.length === 0) doc.text('Geen metingen geregistreerd.');
  measurements.forEach((m) => doc.text(`- ${m.type}: ${m.value} ${m.unit || ''} (${m.result || 'geen oordeel'}) — ${m.measured_at}`));

  drawHeading(doc, 'Bevindingen');
  if (findings.length === 0) doc.text('Geen bevindingen geregistreerd.');
  findings.forEach((f) => {
    doc.text(`#${f.finding_number} [${f.severity}] ${f.description} — status: ${f.status}`);
    const relatedRepairs = repairs.filter((r) => r.finding_number === f.finding_number);
    relatedRepairs.forEach((r) => doc.text(`    Herstel: ${r.action} (${r.date})`, { indent: 10 }));
  });

  drawHeading(doc, 'Tweede controle');
  if (technicalReviews.length === 0) doc.text('Nog geen technische controle uitgevoerd.');
  technicalReviews.forEach((tr) => doc.text(`- ${tr.result} door ${tr.reviewer_name} op ${tr.created_at}${tr.remarks ? ' — ' + tr.remarks : ''}`));

  drawHeading(doc, 'Managercontrole en vrijgave');
  if (managerReviews.length === 0) doc.text('Nog geen managerbeslissing.');
  managerReviews.forEach((mr) => doc.text(`- ${mr.result} door ${mr.manager_name} op ${mr.created_at}${mr.reason ? ' — reden: ' + mr.reason : ''}`));

  drawHeading(doc, "Foto-overzicht");
  const imageAttachments = attachments.filter((a) => /\.(jpe?g|png|webp)$/i.test(a.filename));
  if (attachments.length === 0) {
    doc.text('Geen foto\'s toegevoegd.');
  } else {
    attachments.forEach((a) => doc.text(`- [${a.category}] ${a.original_name || a.filename} — ${a.created_at}${a.description ? ' — ' + a.description : ''}`));
  }
  imageAttachments.slice(0, 12).forEach((a) => {
    const filePath = path.join(uploadsRoot, String(property.id), a.filename);
    if (fs.existsSync(filePath)) {
      try {
        if (doc.y > 620) doc.addPage();
        doc.moveDown(0.3);
        doc.fontSize(8).fillColor('#666').text(`${a.category}${a.description ? ' — ' + a.description : ''}`);
        doc.image(filePath, { width: 220 });
      } catch {
        // Onleesbaar bestand overslaan, rest van het rapport gaat door.
      }
    }
  });

  doc.moveDown(1);
  doc.fontSize(8).fillColor('#888').text(`Gegenereerd op ${new Date().toISOString()} door gebruiker #${req.user.id} (${req.user.name})`);

  doc.end();
});

router.get('/management', requireRole('beheerder', 'manager'), (req, res) => {
  const { from, to } = req.query;
  const params = [];
  let where = '1=1';
  if (from) { where += ' AND date(geplande_opleverdatum) >= date(?)'; params.push(from); }
  if (to) { where += ' AND date(geplande_opleverdatum) <= date(?)'; params.push(to); }

  const properties = db.prepare(`SELECT * FROM properties WHERE ${where}`).all(...params);
  const propertyIds = properties.map((p) => p.id);
  const idPlaceholder = propertyIds.length ? propertyIds.map(() => '?').join(',') : 'NULL';

  const totalWoningen = properties.length;
  const vrijgegeven = properties.filter((p) => p.status === 'VRIJGEGEVEN');
  const opTijd = vrijgegeven.filter((p) => p.werkelijke_opleverdatum && p.werkelijke_opleverdatum <= p.geplande_opleverdatum);
  const teLaat = vrijgegeven.filter((p) => p.werkelijke_opleverdatum && p.werkelijke_opleverdatum > p.geplande_opleverdatum);

  const doorlooptijden = vrijgegeven
    .filter((p) => p.startdatum && p.werkelijke_opleverdatum)
    .map((p) => (new Date(p.werkelijke_opleverdatum) - new Date(p.startdatum)) / (1000 * 60 * 60 * 24));
  const gemiddeldeDoorlooptijd = doorlooptijden.length ? doorlooptijden.reduce((a, b) => a + b, 0) / doorlooptijden.length : null;

  const findings = propertyIds.length
    ? db.prepare(`SELECT * FROM findings WHERE property_id IN (${idPlaceholder})`).all(...propertyIds)
    : [];
  const veiligheidskritisch = findings.filter((f) => f.severity === 'veiligheidskritisch');

  const categoryByProperty = new Map();
  let herhaalde = 0;
  for (const f of findings) {
    const key = `${f.property_id}::${f.category || ''}`;
    if (categoryByProperty.has(key)) herhaalde += 1;
    else categoryByProperty.set(key, true);
  }

  const closedFindings = findings.filter((f) => f.status === 'afgesloten');
  const hersteltijden = closedFindings.map((f) => (new Date(f.updated_at) - new Date(f.created_at)) / (1000 * 60 * 60 * 24));
  const gemiddeldeHersteltijd = hersteltijden.length ? hersteltijden.reduce((a, b) => a + b, 0) / hersteltijden.length : null;

  const correcteControleCount = propertyIds.length
    ? db
        .prepare(
          `SELECT COUNT(DISTINCT property_id) AS n FROM technical_reviews WHERE property_id IN (${idPlaceholder}) AND result='goedgekeurd' AND invalidated = 0`
        )
        .get(...propertyIds).n
    : 0;

  res.json({
    periode: { from: from || null, to: to || null },
    aantalWoningen: totalWoningen,
    opTijdOpgeleverd: { teller: opTijd.length, noemer: vrijgegeven.length },
    teLaatOpgeleverd: { teller: teLaat.length, noemer: vrijgegeven.length },
    gemiddeldeDoorlooptijdDagen: gemiddeldeDoorlooptijd,
    aantalBevindingen: findings.length,
    bevindingenPerWoning: { teller: findings.length, noemer: totalWoningen },
    aantalVeiligheidskritischeBevindingen: veiligheidskritisch.length,
    herhaaldeBevindingen: herhaalde,
    gemiddeldeHersteltijdDagen: gemiddeldeHersteltijd,
    percentageCompleteDossiers: { teller: vrijgegeven.length, noemer: totalWoningen },
    percentageCorrecteTweedeControle: { teller: correcteControleCount, noemer: totalWoningen },
  });
});

export default router;
