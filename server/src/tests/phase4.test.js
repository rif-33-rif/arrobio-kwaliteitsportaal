import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import bcrypt from 'bcryptjs';

const dbFile = path.join(os.tmpdir(), `arro-test-phase4-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;
process.env.JWT_SECRET = 'test-secret';

const { default: db } = await import('../db/index.js');
const { createApp } = await import('../app.js');

let server;
let baseUrl;
let tokens = {};
let propertyId;

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
  insertUser('Beheerder Test', 'beheerder@test.nl', 'beheerder');
  insertUser('Manager Test', 'manager@test.nl', 'manager');
  insertUser('Monteur Test', 'monteur@test.nl', 'monteur');

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });

  tokens.beheerder = await login('beheerder@test.nl');
  tokens.manager = await login('manager@test.nl');
  tokens.monteur = await login('monteur@test.nl');

  const createRes = await fetch(`${baseUrl}/api/properties`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ opdrachtgever: 'Eigen Haard', werkbonnummer: 'WB-P4-1', address: 'Teststraat 1', geplande_opleverdatum: '2026-12-01' }),
  });
  propertyId = (await createRes.json()).id;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dbFile, { force: true });
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
});

test('alleen beheerder mag de systeembrede audittrail bekijken', async () => {
  const forbidden = await fetch(`${baseUrl}/api/audit-events`, { headers: { Authorization: `Bearer ${tokens.manager}` } });
  assert.equal(forbidden.status, 403);

  const allowed = await fetch(`${baseUrl}/api/audit-events`, { headers: { Authorization: `Bearer ${tokens.beheerder}` } });
  assert.equal(allowed.status, 200);
  const events = await allowed.json();
  assert.ok(events.some((e) => e.action === 'WONING_AANGEMAAKT'));
});

test('PDF-opleverrapport wordt gegenereerd met versieregistratie', async () => {
  const res = await fetch(`${baseUrl}/api/reports/properties/${propertyId}/report`, { headers: { Authorization: `Bearer ${tokens.manager}` } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const buffer = Buffer.from(await res.arrayBuffer());
  assert.ok(buffer.length > 500, 'PDF moet daadwerkelijk inhoud bevatten');
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');

  const versionRow = db.prepare('SELECT * FROM report_versions WHERE property_id = ?').get(propertyId);
  assert.equal(versionRow.version, 1);

  const secondRes = await fetch(`${baseUrl}/api/reports/properties/${propertyId}/report`, { headers: { Authorization: `Bearer ${tokens.manager}` } });
  await secondRes.arrayBuffer();
  const versions = db.prepare('SELECT * FROM report_versions WHERE property_id = ? ORDER BY version').all(propertyId);
  assert.equal(versions.length, 2);
  assert.equal(versions[1].version, 2);
});

test('managementrapportage toont teller/noemer, nooit een kaal percentage', async () => {
  const res = await fetch(`${baseUrl}/api/reports/management`, { headers: { Authorization: `Bearer ${tokens.manager}` } });
  assert.equal(res.status, 200);
  const report = await res.json();
  assert.equal(report.aantalWoningen, 1);
  assert.ok('teller' in report.opTijdOpgeleverd && 'noemer' in report.opTijdOpgeleverd);
  assert.ok('teller' in report.percentageCompleteDossiers && 'noemer' in report.percentageCompleteDossiers);

  const forbidden = await fetch(`${baseUrl}/api/reports/management`, { headers: { Authorization: `Bearer ${tokens.monteur}` } });
  assert.equal(forbidden.status, 403);
});

test('externe keuring vastleggen en interne bevindingen erlangs vergelijken', async () => {
  const res = await fetch(`${baseUrl}/api/properties/${propertyId}/external-inspections`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ organisation: 'Kiwa', date: '2026-10-01', findings_count: 2, conclusion: 'Voldoet met opmerkingen' }),
  });
  assert.equal(res.status, 201);

  const listRes = await fetch(`${baseUrl}/api/properties/${propertyId}/external-inspections`, { headers: { Authorization: `Bearer ${tokens.monteur}` } });
  const body = await listRes.json();
  assert.equal(body.inspections.length, 1);
  assert.equal(body.inspections[0].organisation, 'Kiwa');
  assert.equal(typeof body.internalFindingsCount, 'number');
});

test('verbeterplan-metingen: aanmaken, filteren op periode/thema, en alleen beheerder/manager mogen schrijven', async () => {
  const forbidden = await fetch(`${baseUrl}/api/improvement-metrics`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.monteur}` },
    body: JSON.stringify({ period: '2026-Q4', theme: 'planning', metric_label: 'Niet tijdig gecommuniceerde afwijkingen', numerator: 1, denominator: 10 }),
  });
  assert.equal(forbidden.status, 403);

  const created = await fetch(`${baseUrl}/api/improvement-metrics`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.manager}` },
    body: JSON.stringify({ period: '2026-Q4', theme: 'planning', metric_label: 'Niet tijdig gecommuniceerde afwijkingen', numerator: 1, denominator: 10 }),
  });
  assert.equal(created.status, 201);

  const listRes = await fetch(`${baseUrl}/api/improvement-metrics?period=2026-Q4&theme=planning`, { headers: { Authorization: `Bearer ${tokens.monteur}` } });
  const list = await listRes.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].numerator, 1);
  assert.equal(list[0].denominator, 10);
});
