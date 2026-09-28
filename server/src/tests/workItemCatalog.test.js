import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import bcrypt from 'bcryptjs';

const dbFile = path.join(os.tmpdir(), `arro-test-catalog-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
process.env.JWT_SECRET = 'test-secret';

const { default: db } = await import('../db/index.js');
const { createApp } = await import('../app.js');

let server;
let baseUrl;
let tokens = {};

function insertUser(name, email, role_code) {
  const hash = bcrypt.hashSync('welkom123', 10);
  return db.prepare('INSERT INTO users (name, email, password_hash, role_code) VALUES (?, ?, ?, ?)').run(name, email, hash, role_code).lastInsertRowid;
}

async function login(email) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'welkom123' }),
  });
  return (await res.json()).token;
}

before(async () => {
  insertUser('Manager Test', 'manager@test.nl', 'manager');
  insertUser('Monteur Test', 'monteur@test.nl', 'monteur');

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });

  tokens.manager = await login('manager@test.nl');
  tokens.monteur = await login('monteur@test.nl');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dbFile, { force: true });
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
});

test('monteur mag geen catalogus importeren (alleen beheerder/manager)', async () => {
  const filePath = path.join(os.homedir(), 'Downloads', 'Elektricien.xlsx');
  if (!fs.existsSync(filePath)) return; // Skip als het brondocument lokaal niet aanwezig is.
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.set('file', new Blob([buffer]), 'Elektricien.xlsx');

  const res = await fetch(`${baseUrl}/api/work-item-catalog/import`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.monteur}` }, body: form,
  });
  assert.equal(res.status, 403);
});

test('manager importeert het echte Elektricien.xlsx-bestand correct', async () => {
  const filePath = path.join(os.homedir(), 'Downloads', 'Elektricien.xlsx');
  if (!fs.existsSync(filePath)) return; // Skip als het brondocument lokaal niet aanwezig is.
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.set('file', new Blob([buffer]), 'Elektricien.xlsx');

  const res = await fetch(`${baseUrl}/api/work-item-catalog/import`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.manager}` }, body: form,
  });
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.ok(result.created > 200, `verwacht >200 nieuwe regels, kreeg ${result.created}`);

  const listRes = await fetch(`${baseUrl}/api/work-item-catalog?q=aardlekschakelaar`, { headers: { Authorization: `Bearer ${tokens.monteur}` } });
  const list = await listRes.json();
  assert.ok(list.length > 0);
  assert.ok(list.some((r) => r.description.toLowerCase().includes('aardlekschakelaar')));
  assert.ok(list.every((r) => r.unit));

  // Opnieuw importeren (bv. bijgewerkte prijzen) mag bestaande codes updaten, niet dupliceren.
  const secondRes = await fetch(`${baseUrl}/api/work-item-catalog/import`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.manager}` },
    body: (() => { const f = new FormData(); f.set('file', new Blob([buffer]), 'Elektricien.xlsx'); return f; })(),
  });
  const secondResult = await secondRes.json();
  assert.equal(secondResult.created, 0);
  assert.ok(secondResult.updated > 200);
});
