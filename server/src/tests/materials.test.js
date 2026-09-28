import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import bcrypt from 'bcryptjs';

const dbFile = path.join(os.tmpdir(), `arro-test-materials-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
process.env.JWT_SECRET = 'test-secret';

const { default: db } = await import('../db/index.js');
const { createApp } = await import('../app.js');

let server;
let baseUrl;
let tokens = {};
let propertyId;
let materialId;
let workItemId;

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

  const propRes = await fetch(`${baseUrl}/api/properties`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ opdrachtgever: 'Eigen Haard', werkbonnummer: 'WB-MAT-1', address: 'Teststraat 1', geplande_opleverdatum: '2026-12-01' }),
  });
  propertyId = (await propRes.json()).id;

  const itemRes = await fetch(`${baseUrl}/api/properties/${propertyId}/work-items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ category: 'Groepenkast', description: 'Groepenkast vervangen' }),
  });
  workItemId = (await itemRes.json()).id;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dbFile, { force: true });
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
});

test('monteur mag geen materiaal in de catalogus aanmaken (alleen beheerder/manager)', async () => {
  const res = await fetch(`${baseUrl}/api/materials`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.monteur}` },
    body: JSON.stringify({ name: 'Groepenkast NEN1010 4 groepen', unit: 'stuk', stock_quantity: 10, min_stock: 2 }),
  });
  assert.equal(res.status, 403);
});

test('manager maakt materiaal aan met voorraad', async () => {
  const res = await fetch(`${baseUrl}/api/materials`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ name: 'Groepenkast NEN1010 4 groepen', unit: 'stuk', stock_quantity: 10, min_stock: 2 }),
  });
  assert.equal(res.status, 201);
  const material = await res.json();
  materialId = material.id;
  assert.equal(material.stock_quantity, 10);
});

test('monteur registreert materiaalverbruik op een werkzaamheid en de voorraad daalt automatisch', async () => {
  const res = await fetch(`${baseUrl}/api/properties/${propertyId}/work-items/${workItemId}/materials`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.monteur}` },
    body: JSON.stringify({ material_id: materialId, quantity: 3 }),
  });
  assert.equal(res.status, 201);

  const materialsRes = await fetch(`${baseUrl}/api/materials`, { headers: { Authorization: `Bearer ${tokens.monteur}` } });
  const materials = await materialsRes.json();
  const updated = materials.find((m) => m.id === materialId);
  assert.equal(updated.stock_quantity, 7);
});

test('materiaal onder minimumvoorraad wordt gesignaleerd, en verwijderen van verbruik herstelt de voorraad', async () => {
  // Nog 4 verbruiken zodat 7 - 4 = 3, nog niet onder de minimumvoorraad van 2.
  await fetch(`${baseUrl}/api/properties/${propertyId}/work-items/${workItemId}/materials`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.monteur}` },
    body: JSON.stringify({ material_id: materialId, quantity: 4 }),
  });

  let lowStockRes = await fetch(`${baseUrl}/api/materials?low_stock=true`, { headers: { Authorization: `Bearer ${tokens.manager}` } });
  let lowStock = await lowStockRes.json();
  assert.equal(lowStock.length, 0);

  const usageListRes = await fetch(`${baseUrl}/api/properties/${propertyId}/work-items/${workItemId}/materials`, {
    headers: { Authorization: `Bearer ${tokens.monteur}` },
  });
  const usages = await usageListRes.json();
  assert.equal(usages.length, 2);

  // Verbruik nog 2 extra (3 - 2 = 1), nu wel onder minimumvoorraad (min 2).
  const extraRes = await fetch(`${baseUrl}/api/properties/${propertyId}/work-items/${workItemId}/materials`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.monteur}` },
    body: JSON.stringify({ material_id: materialId, quantity: 2 }),
  });
  const extraUsage = await extraRes.json();

  lowStockRes = await fetch(`${baseUrl}/api/materials?low_stock=true`, { headers: { Authorization: `Bearer ${tokens.manager}` } });
  lowStock = await lowStockRes.json();
  assert.equal(lowStock.length, 1);
  assert.equal(lowStock[0].stock_quantity, 1);

  // Verwijder de laatste verbruiksregel: voorraad moet terug naar 3.
  const delRes = await fetch(`${baseUrl}/api/properties/${propertyId}/work-items/${workItemId}/materials/${extraUsage.id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${tokens.monteur}` },
  });
  assert.equal(delRes.status, 204);

  const materialsRes = await fetch(`${baseUrl}/api/materials`, { headers: { Authorization: `Bearer ${tokens.monteur}` } });
  const materials = await materialsRes.json();
  const restored = materials.find((m) => m.id === materialId);
  assert.equal(restored.stock_quantity, 3);
});

test('handmatige voorraadmutatie (aanvulling) werkt en wordt gelogd', async () => {
  const res = await fetch(`${baseUrl}/api/materials/${materialId}/adjustments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ change: 20, reason: 'Nieuwe levering ontvangen' }),
  });
  assert.equal(res.status, 201);
  const material = await res.json();
  assert.equal(material.stock_quantity, 23);

  const historyRes = await fetch(`${baseUrl}/api/materials/${materialId}/adjustments`, { headers: { Authorization: `Bearer ${tokens.manager}` } });
  const history = await historyRes.json();
  assert.equal(history.length, 1);
  assert.equal(history[0].reason, 'Nieuwe levering ontvangen');
});

test('dashboard toont materiaal onder minimumvoorraad', async () => {
  await fetch(`${baseUrl}/api/materials/${materialId}/adjustments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ change: -22, reason: 'Test: terugbrengen onder minimum' }),
  });
  const dashRes = await fetch(`${baseUrl}/api/dashboard`, { headers: { Authorization: `Bearer ${tokens.manager}` } });
  const dash = await dashRes.json();
  assert.equal(dash.kpis.materiaalOnderVoorraad, 1);
  assert.ok(dash.lowStockMaterials.some((m) => m.id === materialId));
});
