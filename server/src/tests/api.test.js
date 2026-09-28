import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import bcrypt from 'bcryptjs';

const dbFile = path.join(os.tmpdir(), `arro-test-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
process.env.JWT_SECRET = 'test-secret';

const { default: db } = await import('../db/index.js');
const { createApp } = await import('../app.js');

let server;
let baseUrl;

function insertUser(name, email, role_code, active = 1) {
  const hash = bcrypt.hashSync('welkom123', 10);
  const result = db
    .prepare('INSERT INTO users (name, email, password_hash, role_code, active) VALUES (?, ?, ?, ?, ?)')
    .run(name, email, hash, role_code, active);
  return result.lastInsertRowid;
}

async function login(email) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'welkom123' }),
  });
  return res.json();
}

before(async () => {
  insertUser('Manager Test', 'manager@test.nl', 'manager');
  insertUser('Monteur Test', 'monteur@test.nl', 'monteur');
  insertUser('Geblokkeerd Test', 'geblokkeerd@test.nl', 'monteur', 0);

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dbFile, { force: true });
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
});

test('geblokkeerde gebruiker kan niet inloggen', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'geblokkeerd@test.nl', password: 'welkom123' }),
  });
  assert.equal(res.status, 401);
});

test('onbevoegde gebruiker (monteur) kan geen woning aanmaken', async () => {
  const { token } = await login('monteur@test.nl');
  const res = await fetch(`${baseUrl}/api/properties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      opdrachtgever: 'Eigen Haard', werkbonnummer: 'WB-TEST-1', address: 'Teststraat',
      geplande_opleverdatum: '2026-12-01',
    }),
  });
  assert.equal(res.status, 403);
});

test('manager kan woning aanmaken en dit wordt gelogd in de audittrail', async () => {
  const { token } = await login('manager@test.nl');
  const createRes = await fetch(`${baseUrl}/api/properties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      opdrachtgever: 'Eigen Haard', werkbonnummer: 'WB-TEST-2', address: 'Teststraat',
      geplande_opleverdatum: '2026-12-01',
    }),
  });
  assert.equal(createRes.status, 201);
  const property = await createRes.json();
  assert.equal(property.status, 'NIEUW');

  const detailRes = await fetch(`${baseUrl}/api/properties/${property.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const detail = await detailRes.json();
  assert.ok(detail.auditEvents.some((e) => e.action === 'WONING_AANGEMAAKT'));
});

test('oorspronkelijke geplande opleverdatum blijft behouden bij planningswijziging', async () => {
  const { token } = await login('manager@test.nl');
  const createRes = await fetch(`${baseUrl}/api/properties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      opdrachtgever: 'Eigen Haard', werkbonnummer: 'WB-TEST-3', address: 'Teststraat 2',
      geplande_opleverdatum: '2026-11-01',
    }),
  });
  const property = await createRes.json();

  await fetch(`${baseUrl}/api/properties/${property.id}/planning`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ field: 'actuele_opleverdatum', new_value: '2026-11-10', reason: 'Bewoner niet aanwezig' }),
  });

  const detailRes = await fetch(`${baseUrl}/api/properties/${property.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const detail = await detailRes.json();
  assert.equal(detail.geplande_opleverdatum, '2026-11-01');
  assert.equal(detail.actuele_opleverdatum, '2026-11-10');
  assert.equal(detail.planningChanges.length, 1);
  assert.equal(detail.planningChanges[0].reason, 'Bewoner niet aanwezig');
});

test('ongeldige statusovergang wordt geweigerd (statusmodel mag niet worden overgeslagen)', async () => {
  const { token } = await login('manager@test.nl');
  const createRes = await fetch(`${baseUrl}/api/properties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      opdrachtgever: 'Eigen Haard', werkbonnummer: 'WB-TEST-4', address: 'Teststraat 3',
      geplande_opleverdatum: '2026-11-01',
    }),
  });
  const property = await createRes.json();

  const res = await fetch(`${baseUrl}/api/properties/${property.id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: 'VRIJGEGEVEN' }),
  });
  assert.equal(res.status, 400);
});
