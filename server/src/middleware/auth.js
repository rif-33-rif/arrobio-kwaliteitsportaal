import jwt from 'jsonwebtoken';
import db from '../db/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-wijzig-in-productie';

if (!process.env.JWT_SECRET) {
  console.warn(
    'WAARSCHUWING: JWT_SECRET is niet ingesteld, er wordt een onveilige ontwikkelwaarde gebruikt. ' +
    'Stel in productie altijd een lange, willekeurige JWT_SECRET in via .env.'
  );
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role_code, type: 'access' },
    JWT_SECRET,
    { expiresIn: '10h' }
  );
}

// Kortlevend token tussen wachtwoordcontrole en MFA-verificatie in. Kan NIET
// gebruikt worden om beveiligde endpoints te benaderen (zie requireAuth).
export function signMfaPendingToken(user) {
  return jwt.sign({ id: user.id, type: 'mfa_pending' }, JWT_SECRET, { expiresIn: '5m' });
}

export function verifyMfaPendingToken(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  if (payload.type !== 'mfa_pending') throw new Error('Ongeldig token');
  return payload;
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Niet ingelogd' });
  }
  try {
    const token = header.slice('Bearer '.length);
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'access') {
      return res.status(401).json({ error: 'Ongeldig token' });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Account is geblokkeerd of bestaat niet meer' });
    }
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role_code };
    next();
  } catch {
    return res.status(401).json({ error: 'Sessie verlopen, log opnieuw in' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Geen toegang voor deze rol' });
    }
    next();
  };
}
