import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import bcrypt from 'bcryptjs';

const dbFile = path.join(os.tmpdir(), `arro-test-phase3-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
process.env.JWT_SECRET = 'test-secret';

const { default: db } = await import('../db/index.js');
const { createApp } = await import('../app.js');

let server;
let baseUrl;
let tokens = {};

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
  return (await res.json()).token;
}

async function createReadyProperty(werkbonnummer, monteurEmailForAssignment = 'monteur@test.nl') {
  const createRes = await fetch(`${baseUrl}/api/properties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ opdrachtgever: 'Eigen Haard', werkbonnummer, address: 'Teststraat 1', geplande_opleverdatum: '2026-12-01' }),
  });
  const property = await createRes.json();

  const monteur = db.prepare('SELECT id FROM users WHERE email = ?').get(monteurEmailForAssignment);
  await fetch(`${baseUrl}/api/properties/${property.id}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ user_id: monteur.id, role_in_property: 'monteur' }),
  });

  await fetch(`${baseUrl}/api/properties/${property.id}/status`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ status: 'GEPLAND' }),
  });
  await fetch(`${baseUrl}/api/properties/${property.id}/start-werk`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.monteur}` },
  });

  // Checklist, werkzaamheid, meting en foto compleet maken, dan gereedmelden.
  const checklist = await (await fetch(`${baseUrl}/api/properties/${property.id}/checklist`, { headers: { Authorization: `Bearer ${tokens.monteur}` } })).json();
  for (const item of checklist.items) {
    await fetch(`${baseUrl}/api/properties/${property.id}/checklist/${item.checklist_item_id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.monteur}` },
      body: JSON.stringify({ answer: 'akkoord' }),
    });
  }
  await fetch(`${baseUrl}/api/properties/${property.id}/work-items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.monteur}` },
    body: JSON.stringify({ category: 'Groepenkast', description: 'Vervangen' }),
  }).then((r) => r.json()).then((item) =>
    fetch(`${baseUrl}/api/properties/${property.id}/work-items/${item.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.monteur}` },
      body: JSON.stringify({ status: 'afgerond' }),
    })
  );
  await fetch(`${baseUrl}/api/properties/${property.id}/measurements`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.monteur}` },
    body: JSON.stringify({ type: 'Isolatieweerstand', value: '500', unit: 'MOhm' }),
  });
  const form = new FormData();
  form.set('category', 'na_werkzaamheden');
  form.set('file', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'test.png');
  await fetch(`${baseUrl}/api/properties/${property.id}/attachments`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.monteur}` }, body: form,
  });

  await fetch(`${baseUrl}/api/properties/${property.id}/gereedmelding`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.monteur}` },
  });

  return property.id;
}

before(async () => {
  insertUser('Manager Test', 'manager@test.nl', 'manager');
  insertUser('Monteur Test', 'monteur@test.nl', 'monteur');
  insertUser('Controleur Test', 'controleur@test.nl', 'controleur');
  insertUser('Controleur Twee', 'controleur2@test.nl', 'controleur');

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });

  tokens.manager = await login('manager@test.nl');
  tokens.monteur = await login('monteur@test.nl');
  tokens.controleur = await login('controleur@test.nl');
  tokens.controleur2 = await login('controleur2@test.nl');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dbFile, { force: true });
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
});

test('de monteur die het werk uitvoerde mag niet zelf de tweede controle doen (vierogenprincipe)', async () => {
  const propertyId = await createReadyProperty('WB-P3-1');
  // monteur@test.nl heeft geen controleur-rol, dus deze test simuleert de situatie
  // waarin een controleur toevallig ook als monteur op de woning staat.
  await fetch(`${baseUrl}/api/properties/${propertyId}/assignments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ user_id: db.prepare('SELECT id FROM users WHERE email = ?').get('controleur@test.nl').id, role_in_property: 'monteur' }),
  });

  const res = await fetch(`${baseUrl}/api/properties/${propertyId}/technical-reviews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.controleur}` },
    body: JSON.stringify({ result: 'goedgekeurd' }),
  });
  assert.equal(res.status, 403);
});

test('manager kan de tweede technische controle niet overslaan', async () => {
  const propertyId = await createReadyProperty('WB-P3-2');
  const res = await fetch(`${baseUrl}/api/properties/${propertyId}/managercontrole-starten`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.manager}` },
  });
  assert.equal(res.status, 400);
});

test('volledig gelukt traject: controle -> managercontrole -> vrijgave, met vergrendelde foto en audittrail', async () => {
  const propertyId = await createReadyProperty('WB-P3-3');

  const reviewRes = await fetch(`${baseUrl}/api/properties/${propertyId}/technical-reviews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.controleur2}` },
    body: JSON.stringify({ result: 'goedgekeurd', remarks: 'Ziet er goed uit' }),
  });
  assert.equal(reviewRes.status, 201);

  const detailAfterReview = await (await fetch(`${baseUrl}/api/properties/${propertyId}`, { headers: { Authorization: `Bearer ${tokens.manager}` } })).json();
  assert.equal(detailAfterReview.status, 'TECHNISCH_GOEDGEKEURD');

  const startRes = await fetch(`${baseUrl}/api/properties/${propertyId}/managercontrole-starten`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.manager}` },
  });
  assert.equal(startRes.status, 200);

  const releaseRes = await fetch(`${baseUrl}/api/properties/${propertyId}/manager-reviews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ result: 'vrijgegeven' }),
  });
  assert.equal(releaseRes.status, 200);
  const released = await releaseRes.json();
  assert.equal(released.status, 'VRIJGEGEVEN');
  assert.ok(released.werkelijke_opleverdatum);

  const attachments = await (await fetch(`${baseUrl}/api/properties/${propertyId}/attachments`, { headers: { Authorization: `Bearer ${tokens.manager}` } })).json();
  assert.ok(attachments.every((a) => a.locked === 1));

  const detail = await (await fetch(`${baseUrl}/api/properties/${propertyId}`, { headers: { Authorization: `Bearer ${tokens.manager}` } })).json();
  assert.ok(detail.auditEvents.some((e) => e.action === 'DEFINITIEF_VRIJGEGEVEN'));
});

test('open veiligheidskritische bevinding blokkeert definitieve vrijgave', async () => {
  const propertyId = await createReadyProperty('WB-P3-4');

  await fetch(`${baseUrl}/api/properties/${propertyId}/technical-reviews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.controleur2}` },
    body: JSON.stringify({ result: 'goedgekeurd' }),
  });
  await fetch(`${baseUrl}/api/properties/${propertyId}/managercontrole-starten`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.manager}` },
  });

  // Een veiligheidskritische bevinding komt na de goedkeuring binnen (bv. tijdens managercontrole).
  await fetch(`${baseUrl}/api/properties/${propertyId}/findings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ description: 'Losse aardedraad geconstateerd', severity: 'veiligheidskritisch' }),
  });

  const releaseRes = await fetch(`${baseUrl}/api/properties/${propertyId}/manager-reviews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ result: 'vrijgegeven' }),
  });
  assert.equal(releaseRes.status, 400);
});

test('herstelpunt vereist hercontrole: HERSTEL_NODIG kan pas naar GEREED_VOOR_HERCONTROLE als alle bevindingen hersteld zijn', async () => {
  const propertyId = await createReadyProperty('WB-P3-5');

  await fetch(`${baseUrl}/api/properties/${propertyId}/findings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.controleur2}` },
    body: JSON.stringify({ description: 'Wandcontactdoos los', severity: 'middel' }),
  });
  const reviewRes = await fetch(`${baseUrl}/api/properties/${propertyId}/technical-reviews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.controleur2}` },
    body: JSON.stringify({ result: 'herstel_nodig', remarks: 'Zie bevinding' }),
  });
  assert.equal(reviewRes.status, 201);

  const blockedRes = await fetch(`${baseUrl}/api/properties/${propertyId}/hercontrole-gereedmelding`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.monteur}` },
  });
  assert.equal(blockedRes.status, 400);
  const blockedBody = await blockedRes.json();
  assert.ok(blockedBody.missing.length > 0);

  const findings = await (await fetch(`${baseUrl}/api/properties/${propertyId}/findings`, { headers: { Authorization: `Bearer ${tokens.monteur}` } })).json();
  const finding = findings[0];
  await fetch(`${baseUrl}/api/properties/${propertyId}/findings/${finding.id}/repairs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.monteur}` },
    body: JSON.stringify({ action: 'Wandcontactdoos vastgezet' }),
  });

  const okRes = await fetch(`${baseUrl}/api/properties/${propertyId}/hercontrole-gereedmelding`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.monteur}` },
  });
  assert.equal(okRes.status, 200);
  const afterHercontrole = await okRes.json();
  assert.equal(afterHercontrole.status, 'GEREED_VOOR_HERCONTROLE');

  const finalReview = await fetch(`${baseUrl}/api/properties/${propertyId}/technical-reviews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.controleur2}` },
    body: JSON.stringify({ result: 'goedgekeurd' }),
  });
  assert.equal(finalReview.status, 201);
  const finalProperty = await finalReview.json();

  const closedFinding = await (await fetch(`${baseUrl}/api/properties/${propertyId}/findings/${finding.id}`, { headers: { Authorization: `Bearer ${tokens.monteur}` } })).json();
  assert.equal(closedFinding.status, 'afgesloten');
});

test('wijziging na technische goedkeuring maakt de goedkeuring ongeldig en zet status terug', async () => {
  const propertyId = await createReadyProperty('WB-P3-6');
  await fetch(`${baseUrl}/api/properties/${propertyId}/technical-reviews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.controleur2}` },
    body: JSON.stringify({ result: 'goedgekeurd' }),
  });

  let detail = await (await fetch(`${baseUrl}/api/properties/${propertyId}`, { headers: { Authorization: `Bearer ${tokens.manager}` } })).json();
  assert.equal(detail.status, 'TECHNISCH_GOEDGEKEURD');

  await fetch(`${baseUrl}/api/properties/${propertyId}/work-items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.monteur}` },
    body: JSON.stringify({ category: 'Overig', description: 'Extra werk ontdekt' }),
  });

  detail = await (await fetch(`${baseUrl}/api/properties/${propertyId}`, { headers: { Authorization: `Bearer ${tokens.manager}` } })).json();
  assert.equal(detail.status, 'GEREED_VOOR_CONTROLE');
  assert.ok(detail.auditEvents.some((e) => e.action === 'GOEDKEURING_ONGELDIG_GEMAAKT'));
});

test('na definitieve vrijgave is stille wijziging niet mogelijk; formele heropening is verplicht', async () => {
  const propertyId = await createReadyProperty('WB-P3-7');
  await fetch(`${baseUrl}/api/properties/${propertyId}/technical-reviews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.controleur2}` },
    body: JSON.stringify({ result: 'goedgekeurd' }),
  });
  await fetch(`${baseUrl}/api/properties/${propertyId}/managercontrole-starten`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.manager}` } });
  await fetch(`${baseUrl}/api/properties/${propertyId}/manager-reviews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ result: 'vrijgegeven' }),
  });

  const blockedRes = await fetch(`${baseUrl}/api/properties/${propertyId}/work-items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.monteur}` },
    body: JSON.stringify({ category: 'Overig', description: 'Stiekeme wijziging' }),
  });
  assert.equal(blockedRes.status, 403);

  const reopenRes = await fetch(`${baseUrl}/api/properties/${propertyId}/heropenen`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ reason: 'Klant meldt achteraf een defect' }),
  });
  assert.equal(reopenRes.status, 200);
  const reopened = await reopenRes.json();
  assert.equal(reopened.status, 'GEREED_VOOR_CONTROLE');
  assert.equal(reopened.dossier_version, 2);

  const allowedRes = await fetch(`${baseUrl}/api/properties/${propertyId}/work-items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.monteur}` },
    body: JSON.stringify({ category: 'Overig', description: 'Nu wel toegestaan' }),
  });
  assert.equal(allowedRes.status, 201);
});
