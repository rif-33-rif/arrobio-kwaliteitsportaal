import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import db from '../db/index.js';
import { signToken, signMfaPendingToken, verifyMfaPendingToken, requireAuth } from '../middleware/auth.js';
import { logAudit } from '../lib/audit.js';
import { generateSecret, verifyTOTP, buildOtpauthUrl } from '../lib/totp.js';

const router = Router();

// Beperkt brute-force pogingen op het loginformulier (sectie 27: beveiliging).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Te veel inlogpogingen. Probeer het over enkele minuten opnieuw.' },
});

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role_code, function: user.function, mfaEnabled: !!user.mfa_enabled };
}

router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'E-mail en wachtwoord zijn verplicht' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Onjuiste inloggegevens of geblokkeerd account' });
  }

  if (user.mfa_enabled) {
    return res.json({ mfaRequired: true, mfaToken: signMfaPendingToken(user) });
  }

  const token = signToken(user);
  logAudit({ userId: user.id, action: 'INLOG' });
  res.json({ token, user: publicUser(user) });
});

router.post('/mfa/verify', loginLimiter, (req, res) => {
  const { mfaToken, code } = req.body;
  if (!mfaToken || !code) return res.status(400).json({ error: 'Token en code zijn verplicht' });

  let payload;
  try {
    payload = verifyMfaPendingToken(mfaToken);
  } catch {
    return res.status(401).json({ error: 'MFA-sessie verlopen, log opnieuw in' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
  if (!user || !user.active || !user.mfa_enabled || !user.mfa_secret) {
    return res.status(401).json({ error: 'MFA niet beschikbaar voor dit account' });
  }
  if (!verifyTOTP(user.mfa_secret, code)) {
    return res.status(401).json({ error: 'Ongeldige verificatiecode' });
  }

  const token = signToken(user);
  logAudit({ userId: user.id, action: 'INLOG' });
  res.json({ token, user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Eigen MFA aan-/uitzetten (elke gebruiker beheert dit voor zichzelf).
router.post('/mfa/setup', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const secret = generateSecret();
  db.prepare('UPDATE users SET mfa_secret = ? WHERE id = ?').run(secret, user.id);
  res.json({ secret, otpauthUrl: buildOtpauthUrl({ secret, accountName: user.email }) });
});

router.post('/mfa/enable', requireAuth, (req, res) => {
  const { code } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user.mfa_secret) return res.status(400).json({ error: 'Start eerst MFA-setup' });
  if (!verifyTOTP(user.mfa_secret, code)) {
    return res.status(400).json({ error: 'Ongeldige verificatiecode' });
  }
  db.prepare('UPDATE users SET mfa_enabled = 1 WHERE id = ?').run(user.id);
  logAudit({ userId: user.id, action: 'MFA_INGESCHAKELD' });
  res.json({ ok: true });
});

router.post('/mfa/disable', requireAuth, (req, res) => {
  const { password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!password || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Wachtwoord onjuist' });
  }
  db.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').run(user.id);
  logAudit({ userId: user.id, action: 'MFA_UITGESCHAKELD' });
  res.json({ ok: true });
});

export default router;
