import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(
    db.prepare(
      'SELECT id, name, email, role_code, function, vakbekwaam, active, created_at FROM users ORDER BY name'
    ).all()
  );
});

router.get('/roles', (req, res) => {
  res.json(db.prepare('SELECT * FROM roles').all());
});

router.post('/', requireRole('beheerder'), (req, res) => {
  const { name, email, password, role_code, function: fn, vakbekwaam } = req.body;
  if (!name || !email || !password || !role_code) {
    return res.status(400).json({ error: 'Naam, e-mail, wachtwoord en rol zijn verplicht' });
  }
  const password_hash = bcrypt.hashSync(password, 10);
  try {
    const result = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role_code, function, vakbekwaam) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(name, email, password_hash, role_code, fn || null, vakbekwaam === false ? 0 : 1);
    logAudit({ userId: req.user.id, action: 'GEBRUIKER_AANGEMAAKT', details: { targetUserId: result.lastInsertRowid, email } });
    res.status(201).json(
      db.prepare('SELECT id, name, email, role_code, function, vakbekwaam, active FROM users WHERE id = ?').get(result.lastInsertRowid)
    );
  } catch (err) {
    res.status(400).json({ error: 'Kon gebruiker niet aanmaken (e-mail mogelijk al in gebruik)' });
  }
});

// Beheerder kan blokkeren/deblokkeren, rol en functie wijzigen.
// Gebruikers worden nooit fysiek verwijderd (sectie 26): soft-delete via active=0.
router.put('/:id', requireRole('beheerder'), (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Gebruiker niet gevonden' });
  const { name, role_code, function: fn, vakbekwaam, active, password } = req.body;
  const password_hash = password ? bcrypt.hashSync(password, 10) : existing.password_hash;

  db.prepare(
    `UPDATE users SET name=?, role_code=?, function=?, vakbekwaam=?, active=?, password_hash=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    name ?? existing.name,
    role_code ?? existing.role_code,
    fn ?? existing.function,
    vakbekwaam === undefined ? existing.vakbekwaam : vakbekwaam ? 1 : 0,
    active === undefined ? existing.active : active ? 1 : 0,
    password_hash,
    req.params.id
  );

  if (active !== undefined && Number(active ? 1 : 0) !== existing.active) {
    logAudit({
      userId: req.user.id,
      action: active ? 'GEBRUIKER_GEDEBLOKKEERD' : 'GEBRUIKER_GEBLOKKEERD',
      details: { targetUserId: existing.id },
    });
  }

  res.json(
    db.prepare('SELECT id, name, email, role_code, function, vakbekwaam, active FROM users WHERE id = ?').get(req.params.id)
  );
});

export default router;
