import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { guardMutation, DossierLockedError } from '../lib/approvalGuard.js';
import { uploadsRoot } from '../lib/paths.js';

const CATEGORIES = [
  'voor_werkzaamheden', 'tijdens_werkzaamheden', 'na_werkzaamheden', 'groepenkast',
  'meetresultaat', 'gebrek', 'herstel', 'tweede_controle', 'overig',
];

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(uploadsRoot, String(req.params.propertyId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    cb(null, ALLOWED_TYPES.has(file.mimetype));
  },
});

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get('/', (req, res) => {
  const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.propertyId);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });

  const rows = db
    .prepare(
      `SELECT a.*, u.name AS uploaded_by_name FROM attachments a
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.property_id = ? ORDER BY a.created_at DESC`
    )
    .all(req.params.propertyId);
  res.json(rows);
});

router.post('/', upload.single('file'), (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.propertyId);
  if (!property) return res.status(404).json({ error: 'Woning niet gevonden' });
  if (!req.file) return res.status(400).json({ error: 'Bestand ontbreekt of het type wordt niet ondersteund (jpg, png, webp, pdf)' });

  const { category, description } = req.body;
  if (!category || !CATEGORIES.includes(category)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: `Categorie is verplicht en moet een van de volgende zijn: ${CATEGORIES.join(', ')}` });
  }
  try {
    guardMutation(req.params.propertyId, req.user.id);
  } catch (err) {
    fs.unlinkSync(req.file.path);
    if (err instanceof DossierLockedError) return res.status(403).json({ error: err.message });
    throw err;
  }

  const result = db
    .prepare(
      `INSERT INTO attachments (property_id, category, filename, original_name, description, uploaded_by, locked)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    )
    .run(req.params.propertyId, category, req.file.filename, req.file.originalname, description || null, req.user.id);

  logAudit({
    propertyId: property.id,
    userId: req.user.id,
    action: 'FOTO_TOEGEVOEGD',
    details: { category, originalName: req.file.originalname },
  });

  res.status(201).json(db.prepare('SELECT * FROM attachments WHERE id = ?').get(result.lastInsertRowid));
});

router.get('/:attachmentId/file', (req, res) => {
  const attachment = db
    .prepare('SELECT * FROM attachments WHERE id = ? AND property_id = ?')
    .get(req.params.attachmentId, req.params.propertyId);
  if (!attachment) return res.status(404).json({ error: 'Bijlage niet gevonden' });

  const filePath = path.join(uploadsRoot, String(req.params.propertyId), attachment.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Bestand niet gevonden op schijf' });
  res.sendFile(filePath);
});

// Bijlagen mogen na definitieve vrijgave niet ongemerkt verwijderd worden (sectie 13).
router.delete('/:attachmentId', (req, res) => {
  const attachment = db
    .prepare('SELECT * FROM attachments WHERE id = ? AND property_id = ?')
    .get(req.params.attachmentId, req.params.propertyId);
  if (!attachment) return res.status(404).json({ error: 'Bijlage niet gevonden' });
  if (attachment.locked) {
    return res.status(403).json({ error: 'Deze bijlage is vergrendeld na definitieve vrijgave en kan niet worden verwijderd' });
  }
  try {
    guardMutation(req.params.propertyId, req.user.id);
  } catch (err) {
    if (err instanceof DossierLockedError) return res.status(403).json({ error: err.message });
    throw err;
  }

  const filePath = path.join(uploadsRoot, String(req.params.propertyId), attachment.filename);
  fs.rm(filePath, { force: true }, () => {});
  db.prepare('DELETE FROM attachments WHERE id = ?').run(attachment.id);
  logAudit({ propertyId: Number(req.params.propertyId), userId: req.user.id, action: 'FOTO_VERWIJDERD', details: { attachmentId: attachment.id } });
  res.status(204).end();
});

export { CATEGORIES };
export default router;
