import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import bcrypt from 'bcryptjs';

const dbFile = path.join(os.tmpdir(), `arro-test-opnames-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
process.env.JWT_SECRET = 'test-secret';

const { default: db } = await import('../db/index.js');
const { createApp } = await import('../app.js');

let server;
let baseUrl;
const tokens = {};
let opnameId;
let products;

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

function call(method, url, token, body) {
  return fetch(`${baseUrl}/api/opnames${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

before(async () => {
  insertUser('Manager Test', 'manager@test.nl', 'manager');
  insertUser('Jan Monteur', 'monteur@test.nl', 'monteur');
  insertUser('Andere Monteur', 'monteur2@test.nl', 'monteur');
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });
  tokens.manager = await login('manager@test.nl');
  tokens.monteur = await login('monteur@test.nl');
  tokens.monteur2 = await login('monteur2@test.nl');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbFile}${suffix}`, { force: true });
});

test('de standaardregels van het papieren formulier zijn vooraf ingevuld', async () => {
  const res = await call('GET', '/products', tokens.monteur);
  products = await res.json();
  assert.ok(products.length >= 45);
  assert.equal(products[0].description, 'Bedrading vervangen / aanbrengen');
  assert.equal(products[0].unit, 'm1');
});

test('opname aanmaken vereist project en adres', async () => {
  const bad = await call('POST', '/', tokens.monteur, { project: 'Oke.T' });
  assert.equal(bad.status, 400);
  const res = await call('POST', '/', tokens.monteur, { project: 'Oke.T', address: 'Joke Smitlaan 88' });
  assert.equal(res.status, 201);
  const opname = await res.json();
  opnameId = opname.id;
  assert.equal(opname.status, 'concept');
  assert.equal(opname.created_by_name, 'Jan Monteur');
});

test('aantallen per ruimte opslaan, wijzigen en met 0 weer verwijderen', async () => {
  const bedrading = products[0].id;
  let res = await call('PUT', `/${opnameId}/lines`, tokens.monteur, { product_id: bedrading, room: 'keuken', aantal: 30.3 });
  assert.equal(res.status, 200);
  await call('PUT', `/${opnameId}/lines`, tokens.monteur, { product_id: bedrading, room: 'slp1', aantal: 4 });
  await call('PUT', `/${opnameId}/lines`, tokens.monteur, { product_id: bedrading, room: 'keuken', aantal: 12 });

  let detail = await (await call('GET', `/${opnameId}`, tokens.monteur)).json();
  assert.equal(detail.lines.length, 2);
  assert.equal(detail.lines.find((l) => l.room === 'keuken').aantal, 12);

  await call('PUT', `/${opnameId}/lines`, tokens.monteur, { product_id: bedrading, room: 'slp1', aantal: 0 });
  detail = await (await call('GET', `/${opnameId}`, tokens.monteur)).json();
  assert.equal(detail.lines.length, 1);
});

test('onbekende ruimte, onbekend product en negatief aantal worden geweigerd', async () => {
  const id = products[1].id;
  assert.equal((await call('PUT', `/${opnameId}/lines`, tokens.monteur, { product_id: id, room: 'zolderkamer', aantal: 1 })).status, 400);
  assert.equal((await call('PUT', `/${opnameId}/lines`, tokens.monteur, { product_id: 99999, room: 'keuken', aantal: 1 })).status, 400);
  assert.equal((await call('PUT', `/${opnameId}/lines`, tokens.monteur, { product_id: id, room: 'keuken', aantal: -2 })).status, 400);
});

test('losse extra regel toevoegen, aanpassen en verwijderen', async () => {
  const res = await call('POST', `/${opnameId}/extra-lines`, tokens.monteur, { description: 'Vlonder verplaatsen', unit: 'p/st', room: 'tuin', aantal: 2 });
  assert.equal(res.status, 201);
  const { id } = await res.json();
  let detail = await (await call('GET', `/${opnameId}`, tokens.monteur)).json();
  const extra = detail.lines.find((l) => l.id === id);
  assert.equal(extra.description, 'Vlonder verplaatsen');
  assert.equal(extra.product_id, null);

  await call('PUT', `/${opnameId}/extra-lines/${id}`, tokens.monteur, { aantal: 3 });
  detail = await (await call('GET', `/${opnameId}`, tokens.monteur)).json();
  assert.equal(detail.lines.find((l) => l.id === id).aantal, 3);

  await call('PUT', `/${opnameId}/extra-lines/${id}`, tokens.monteur, { aantal: 0 });
  detail = await (await call('GET', `/${opnameId}`, tokens.monteur)).json();
  assert.equal(detail.lines.find((l) => l.id === id), undefined);
});

test('PDF wordt gegenereerd', async () => {
  const res = await call('GET', `/${opnameId}/pdf`, tokens.monteur);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
});

test('afgeronde opname is vergrendeld totdat hij wordt heropend', async () => {
  let res = await call('PUT', `/${opnameId}`, tokens.monteur, { status: 'afgerond' });
  assert.equal(res.status, 200);
  res = await call('PUT', `/${opnameId}/lines`, tokens.monteur, { product_id: products[1].id, room: 'keuken', aantal: 1 });
  assert.equal(res.status, 409);
  res = await call('PUT', `/${opnameId}`, tokens.monteur, { notities: 'wijziging' });
  assert.equal(res.status, 409);
  res = await call('PUT', `/${opnameId}`, tokens.monteur, { status: 'concept' });
  assert.equal(res.status, 200);
  res = await call('PUT', `/${opnameId}/lines`, tokens.monteur, { product_id: products[1].id, room: 'keuken', aantal: 1 });
  assert.equal(res.status, 200);
});

test('productlijst beheren mag alleen manager/beheerder', async () => {
  const body = { description: 'Nieuwe regel', unit: 'p/st' };
  assert.equal((await call('POST', '/products', tokens.monteur, body)).status, 403);
  const res = await call('POST', '/products', tokens.manager, body);
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal((await call('PUT', `/products/${created.id}`, tokens.manager, { active: false })).status, 200);
  const active = await (await call('GET', '/products', tokens.monteur)).json();
  assert.equal(active.find((p) => p.id === created.id), undefined);
});

test('verwijderen: andere monteur niet, maker (concept) wel', async () => {
  assert.equal((await call('DELETE', `/${opnameId}`, tokens.monteur2)).status, 403);
  assert.equal((await call('DELETE', `/${opnameId}`, tokens.monteur)).status, 204);
  assert.equal((await call('GET', `/${opnameId}`, tokens.monteur)).status, 404);
});
