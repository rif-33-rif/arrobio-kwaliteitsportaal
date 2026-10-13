import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import bcrypt from 'bcryptjs';

const dbFile = path.join(os.tmpdir(), `arro-test-opnames-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
process.env.JWT_SECRET = 'test-secret';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `arro-test-opnames-uploads-${Date.now()}`);

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
  const res = await call('POST', `/${opnameId}/extra-lines`, tokens.monteur, { description: 'Vlonder verplaatsen', unit: 'p/st', room: 'zolder', aantal: 2 });
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

test('Excel-export heeft alle regels als rijen en alle ruimtes als kolommen, zoals het papieren formulier', async () => {
  // extra regel zodat ook die sectie wordt getest
  await call('POST', `/${opnameId}/extra-lines`, tokens.monteur, { description: 'Vlonder verplaatsen', unit: 'p/st', room: 'zolder', aantal: 2 });

  const res = await call('GET', `/${opnameId}/xlsx`, tokens.monteur);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);

  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const ws = wb.getWorksheet('Opname');

  const rows = [];
  ws.eachRow((row) => rows.push(row.values.slice(1)));
  const header = rows.find((r) => r[0] === 'Omschrijving');
  assert.deepEqual(header.slice(0, 2), ['Omschrijving', 'Eenheid']);
  assert.equal(header.length, 2 + 13 + 1); // 13 ruimtes + totaal
  assert.equal(header[8], 'K');

  // Alle actieve standaardregels staan erin, ook zonder aantal.
  const productRows = rows.filter((r) => products.some((p) => p.description === r[0]));
  assert.ok(productRows.length >= 45);

  const bedrading = rows.find((r) => r[0] === 'Bedrading vervangen / aanbrengen');
  assert.equal(bedrading[8], 12); // keuken
  assert.equal(bedrading[15], 12); // totaal

  const extra = rows.find((r) => r[0] === 'Vlonder verplaatsen');
  assert.equal(extra[14], 2); // zolder
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

// ---------- Excel-sjabloon van de opdrachtgever ----------

async function buildTemplate({ withElectra = true } = {}) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Blad1');
  const roomHeaders = ['Alg.', 'Wnk', 'Slp 1', 'Slp 2', 'Slp 3', 'Slp 4', 'K', 'Bdk', 'T', 'Hal', 'Berg.', 'Overl.', 'Zolder', 'Tot.'];
  const header = (row, title) => {
    ws.getCell(row, 1).value = title;
    ws.getCell(row, 4).value = 'OA prijs 2025';
    roomHeaders.forEach((h, i) => { ws.getCell(row, 5 + i).value = h; });
  };
  const product = (row, description, unit, price) => {
    ws.getCell(row, 1).value = description;
    ws.getCell(row, 2).value = unit;
    ws.getCell(row, 4).value = price;
    ws.getCell(row, 18).value = { formula: `SUM(E${row}:Q${row})`, result: 0 };
  };
  ws.getCell('A7').value = 'Opname datum:';
  ws.getCell('A8').value = 'Aannemer:'; ws.getCell('D8').value = 'Aannemer BV';
  ws.getCell('A9').value = 'Uitvoerder:';
  ws.getCell('A10').value = 'Adres:'; ws.getCell('D10').value = 'oud adres';
  ws.getCell('A11').value = 'Opdracht nummer:';
  header(51, 'Schoonmaak werkzaamheden');
  product(52, 'Schoonmaken woning', 'p/won', 58);
  ws.getCell('E52').value = 3; // voorbeeldaantal dat gewist moet worden
  if (withElectra) {
    header(53, 'Electra');
    product(54, 'Bedrading vervangen / aanbrengen', ' /m1', 4.55);
    product(55, 'WCD /schakelmateriaal vervangen', ' p/st', 29.04);
    ws.getCell('G55').value = 9; // voorbeeldaantal
    product(56, 'Nieuwe regel uit sjabloon', ' p/st', 10);
    header(57, 'Vrije Sector');
    product(58, 'Iets anders', 'p/st', 5);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function uploadTemplate(token, buffer, filename = 'sjabloon.xlsx') {
  const form = new FormData();
  form.set('file', new Blob([buffer]), filename);
  return fetch(`${baseUrl}/api/opnames/template`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
}

test('sjabloon uploaden mag alleen manager/beheerder en moet elektraregels bevatten', async () => {
  const good = await buildTemplate();
  assert.equal((await uploadTemplate(tokens.monteur, good)).status, 403);
  assert.equal((await uploadTemplate(tokens.manager, await buildTemplate({ withElectra: false }))).status, 400);
  assert.equal((await uploadTemplate(tokens.manager, good, 'sjabloon.txt')).status, 400);
  assert.equal((await call('GET', '/template', tokens.monteur).then((r) => r.json())).exists, false);
});

test('sjabloon uploaden zet de opnamelijst gelijk met hun regels (alleen elektra)', async () => {
  const res = await uploadTemplate(tokens.manager, await buildTemplate());
  assert.equal(res.status, 200);
  const stats = await res.json();
  assert.equal(stats.rows, 3); // Vrije Sector en Schoonmaak horen er niet bij
  assert.equal(stats.updated, 2); // 'Bedrading...' en 'WCD schakelmateriaal vervangen' herkend uit de standaardlijst
  assert.equal(stats.created, 1);

  const info = await (await call('GET', '/template', tokens.monteur)).json();
  assert.equal(info.exists, true);
  assert.equal(info.linked_products, 3);

  const active = await (await call('GET', '/products', tokens.monteur)).json();
  assert.deepEqual(active.map((p) => p.description), [
    'Bedrading vervangen / aanbrengen',
    'WCD /schakelmateriaal vervangen',
    'Nieuwe regel uit sjabloon',
  ]);
  assert.equal(active[0].unit, '/m1'); // eenheid zonder spaties uit hun bestand
});

test('Excel-export vult het sjabloon van de opdrachtgever in en laat hun formules staan', async () => {
  const products = await (await call('GET', '/products', tokens.monteur)).json();
  const bedrading = products.find((p) => p.description.startsWith('Bedrading'));
  const wcd = products.find((p) => p.description.startsWith('WCD'));

  const created = await (await call('POST', '/', tokens.monteur, { project: 'P1', address: 'Nieuwe straat 1' })).json();
  const id = created.id;
  await call('PUT', `/${id}/lines`, tokens.monteur, { product_id: bedrading.id, room: 'keuken', aantal: 12.5 });
  // alleen opmerking wijzigen laat het aantal staan
  await call('PUT', `/${id}/lines`, tokens.monteur, { product_id: bedrading.id, room: 'keuken', remark: 'tbv intercom' });
  await call('PUT', `/${id}/lines`, tokens.monteur, { product_id: wcd.id, room: 'slp1', aantal: 2 });
  await call('POST', `/${id}/extra-lines`, tokens.monteur, { description: 'Los ding', unit: 'p/st', room: 'zolder', aantal: 1, remark: 'achter de kast' });

  const detail = await (await call('GET', `/${id}`, tokens.monteur)).json();
  const line = detail.lines.find((l) => l.product_id === bedrading.id);
  assert.equal(line.aantal, 12.5);
  assert.equal(line.remark, 'tbv intercom');

  const res = await call('GET', `/${id}/xlsx`, tokens.monteur);
  assert.equal(res.status, 200);
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const ws = wb.worksheets[0];

  assert.equal(ws.getCell('K54').value, 12.5); // keuken = kolom K
  assert.equal(ws.getCell('G55').value, 2); // slaapkamer 1 = kolom G, voorbeeldaantal 9 is vervangen
  assert.equal(ws.getCell('E52').value, null); // voorbeeldaantal gewist
  assert.equal(ws.getCell('D10').value, 'Nieuwe straat 1');
  assert.equal(ws.getCell('D11').value, 'P1');
  assert.equal(ws.getCell('D8').value, 'Aannemer BV'); // hun aannemer blijft staan
  assert.match(ws.getCell('D7').value, /^\d{2}-\d{2}-\d{4}$/);
  assert.equal(ws.getCell('R54').value.formula, 'SUM(E54:Q54)'); // formule intact

  const extra = wb.getWorksheet('Extra regels en opmerkingen');
  const rows = [];
  extra.eachRow((r) => rows.push(r.values.slice(1)));
  assert.ok(rows.some((r) => r[1] === 'Los ding' && r[4] === 'achter de kast'));
  assert.ok(rows.some((r) => r[1] === 'Bedrading vervangen / aanbrengen' && r[4] === 'tbv intercom'));
});
