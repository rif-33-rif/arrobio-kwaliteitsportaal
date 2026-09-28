import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import bcrypt from 'bcryptjs';

const dbFile = path.join(os.tmpdir(), `arro-test-phase2-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
process.env.JWT_SECRET = 'test-secret';

const { default: db } = await import('../db/index.js');
const { createApp } = await import('../app.js');

let server;
let baseUrl;
let managerToken;
let monteurToken;
let propertyId;
let checklistItemIds;

function insertUser(name, email, role_code) {
  const hash = bcrypt.hashSync('welkom123', 10);
  return db
    .prepare('INSERT INTO users (name, email, password_hash, role_code) VALUES (?, ?, ?, ?)')
    .run(name, email, hash, role_code).lastInsertRowid;
}

async function login(email) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'welkom123' }),
  });
  const data = await res.json();
  return data.token;
}

before(async () => {
  insertUser('Manager Test', 'manager@test.nl', 'manager');
  insertUser('Monteur Test', 'monteur@test.nl', 'monteur');

  const checklistId = db.prepare('INSERT INTO checklists (name) VALUES (?)').run('Testchecklist').lastInsertRowid;
  const insertItem = db.prepare('INSERT INTO checklist_items (checklist_id, text, sort_order) VALUES (?, ?, ?)');
  checklistItemIds = [
    insertItem.run(checklistId, 'Visuele controle', 0).lastInsertRowid,
    insertItem.run(checklistId, 'Aarding gecontroleerd', 1).lastInsertRowid,
  ];

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });

  managerToken = await login('manager@test.nl');
  monteurToken = await login('monteur@test.nl');

  const createRes = await fetch(`${baseUrl}/api/properties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
    body: JSON.stringify({
      opdrachtgever: 'Eigen Haard', werkbonnummer: 'WB-P2-1', address: 'Teststraat 10',
      geplande_opleverdatum: '2026-12-01',
    }),
  });
  const property = await createRes.json();
  propertyId = property.id;
  await fetch(`${baseUrl}/api/properties/${propertyId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
    body: JSON.stringify({ status: 'GEPLAND' }),
  });
  await fetch(`${baseUrl}/api/properties/${propertyId}/start-werk`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${managerToken}` },
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dbFile, { force: true });
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
});

test('werkzaamheid registreren en afronden', async () => {
  const createRes = await fetch(`${baseUrl}/api/properties/${propertyId}/work-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${monteurToken}` },
    body: JSON.stringify({ category: 'Groepenkast', description: 'Groepenkast vervangen' }),
  });
  assert.equal(createRes.status, 201);
  const item = await createRes.json();
  assert.equal(item.status, 'open');

  const updateRes = await fetch(`${baseUrl}/api/properties/${propertyId}/work-items/${item.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${monteurToken}` },
    body: JSON.stringify({ status: 'afgerond' }),
  });
  const updated = await updateRes.json();
  assert.equal(updated.status, 'afgerond');
});

test('checklistitem met "niet akkoord" vereist omschrijving en herstelactie', async () => {
  const res = await fetch(`${baseUrl}/api/properties/${propertyId}/checklist/${checklistItemIds[1]}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${monteurToken}` },
    body: JSON.stringify({ answer: 'niet_akkoord' }),
  });
  assert.equal(res.status, 400);
});

test('gereedmelding weigert zolang checklist, foto\'s en metingen ontbreken, en toont exact wat ontbreekt', async () => {
  const res = await fetch(`${baseUrl}/api/properties/${propertyId}/gereedmelding`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${monteurToken}` },
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.missing.some((m) => m.includes('Checklist onvolledig')));
  assert.ok(body.missing.some((m) => m.includes('foto')));
  assert.ok(body.missing.some((m) => m.includes('meetgegevens')));
});

test('volledige gereedmelding: checklist invullen, meting en foto toevoegen, dan gereedmelden', async () => {
  for (const itemId of checklistItemIds) {
    const res = await fetch(`${baseUrl}/api/properties/${propertyId}/checklist/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${monteurToken}` },
      body: JSON.stringify({ answer: 'akkoord' }),
    });
    assert.equal(res.status, 200);
  }

  const measurementRes = await fetch(`${baseUrl}/api/properties/${propertyId}/measurements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${monteurToken}` },
    body: JSON.stringify({ type: 'Isolatieweerstand', value: '500', unit: 'MOhm', result: 'goed' }),
  });
  assert.equal(measurementRes.status, 201);

  const form = new FormData();
  form.set('category', 'na_werkzaamheden');
  form.set('file', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'test.png');
  const attachmentRes = await fetch(`${baseUrl}/api/properties/${propertyId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${monteurToken}` },
    body: form,
  });
  assert.equal(attachmentRes.status, 201);

  const gereedRes = await fetch(`${baseUrl}/api/properties/${propertyId}/gereedmelding`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${monteurToken}` },
  });
  assert.equal(gereedRes.status, 200);
  const property = await gereedRes.json();
  assert.equal(property.status, 'GEREED_VOOR_CONTROLE');
});
