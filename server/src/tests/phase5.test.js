import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import bcrypt from 'bcryptjs';

const dbFile = path.join(os.tmpdir(), `arro-test-phase5-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
process.env.JWT_SECRET = 'test-secret';

const { default: db } = await import('../db/index.js');
const { createApp } = await import('../app.js');
const { generateTOTP } = await import('../lib/totp.js');

let server;
let baseUrl;
let tokens = {};

function insertUser(name, email, role_code) {
  const hash = bcrypt.hashSync('welkom123', 10);
  return db.prepare('INSERT INTO users (name, email, password_hash, role_code) VALUES (?, ?, ?, ?)').run(name, email, hash, role_code).lastInsertRowid;
}

async function login(email, password = 'welkom123') {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  insertUser('Beheerder Test', 'beheerder@test.nl', 'beheerder');
  insertUser('Manager Test', 'manager@test.nl', 'manager');
  insertUser('Controleur Test', 'controleur@test.nl', 'controleur');
  insertUser('Leerling Test', 'leerling@test.nl', 'leerling');
  insertUser('Monteur Test', 'monteur@test.nl', 'monteur');

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });

  tokens.beheerder = (await login('beheerder@test.nl')).body.token;
  tokens.manager = (await login('manager@test.nl')).body.token;
  tokens.controleur = (await login('controleur@test.nl')).body.token;
  tokens.leerling = (await login('leerling@test.nl')).body.token;
  tokens.monteur = (await login('monteur@test.nl')).body.token;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dbFile, { force: true });
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
});

test('beveiligingsheaders (helmet) staan op elke response', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('onbekend API-endpoint geeft een nette 404, geen onbehandelde crash', async () => {
  const res = await fetch(`${baseUrl}/api/dit-bestaat-niet`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.ok(body.error);
});

test('leerling mag geen tweede controle uitvoeren (alleen rol Controleur)', async () => {
  const createRes = await fetch(`${baseUrl}/api/properties`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ opdrachtgever: 'Eigen Haard', werkbonnummer: 'WB-P5-1', address: 'Teststraat', geplande_opleverdatum: '2026-12-01' }),
  });
  const property = await createRes.json();

  const res = await fetch(`${baseUrl}/api/properties/${property.id}/technical-reviews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leerling}` },
    body: JSON.stringify({ result: 'goedgekeurd' }),
  });
  assert.equal(res.status, 403);
});

test('geblokkeerde gebruiker kan met een bestaand, nog geldig token geen acties meer uitvoeren', async () => {
  const monteurId = db.prepare('SELECT id FROM users WHERE email = ?').get('monteur@test.nl').id;

  // Token is nog geldig en werkt op dit moment.
  const before = await fetch(`${baseUrl}/api/properties`, { headers: { Authorization: `Bearer ${tokens.monteur}` } });
  assert.equal(before.status, 200);

  await fetch(`${baseUrl}/api/users/${monteurId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.beheerder}` },
    body: JSON.stringify({ active: false }),
  });

  const after1 = await fetch(`${baseUrl}/api/properties`, { headers: { Authorization: `Bearer ${tokens.monteur}` } });
  assert.equal(after1.status, 401);
});

test('MFA: setup, verplichte tweede stap bij inloggen, en verkeerde code wordt geweigerd', async () => {
  const setupRes = await fetch(`${baseUrl}/api/auth/mfa/setup`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.controleur}` },
  });
  assert.equal(setupRes.status, 200);
  const { secret } = await setupRes.json();
  assert.ok(secret.length >= 16);

  const wrongEnable = await fetch(`${baseUrl}/api/auth/mfa/enable`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.controleur}` },
    body: JSON.stringify({ code: '000000' }),
  });
  assert.equal(wrongEnable.status, 400);

  const correctCode = generateTOTP(secret);
  const enableRes = await fetch(`${baseUrl}/api/auth/mfa/enable`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.controleur}` },
    body: JSON.stringify({ code: correctCode }),
  });
  assert.equal(enableRes.status, 200);

  const loginResult = await login('controleur@test.nl');
  assert.equal(loginResult.status, 200);
  assert.equal(loginResult.body.mfaRequired, true);
  assert.equal(loginResult.body.token, undefined);

  const badVerify = await fetch(`${baseUrl}/api/auth/mfa/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfaToken: loginResult.body.mfaToken, code: '111111' }),
  });
  assert.equal(badVerify.status, 401);

  const goodVerify = await fetch(`${baseUrl}/api/auth/mfa/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfaToken: loginResult.body.mfaToken, code: generateTOTP(secret) }),
  });
  assert.equal(goodVerify.status, 200);
  const verified = await goodVerify.json();
  assert.ok(verified.token);

  const disableRes = await fetch(`${baseUrl}/api/auth/mfa/disable`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${verified.token}` },
    body: JSON.stringify({ password: 'welkom123' }),
  });
  assert.equal(disableRes.status, 200);
});

test('login-rate-limiting blokkeert na te veel mislukte pogingen', async () => {
  let lastStatus;
  for (let i = 0; i < 21; i++) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'manager@test.nl', password: 'foutwachtwoord' }),
    });
    lastStatus = res.status;
  }
  assert.equal(lastStatus, 429);
});
