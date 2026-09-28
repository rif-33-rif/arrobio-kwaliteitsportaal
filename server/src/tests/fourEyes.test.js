import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dbFile = path.join(os.tmpdir(), `arro-test-foureyes-${Date.now()}.sqlite`);
process.env.DB_PATH = dbFile;

const { default: db } = await import('../db/index.js');
const { assertFourEyes, FourEyesViolationError } = await import('../lib/fourEyes.js');

let propertyId;
let uitvoerderId;
let anderId;

before(() => {
  uitvoerderId = db
    .prepare("INSERT INTO users (name, email, password_hash, role_code) VALUES (?, ?, 'x', 'monteur')")
    .run('Monteur A', 'a@test.nl').lastInsertRowid;
  anderId = db
    .prepare("INSERT INTO users (name, email, password_hash, role_code) VALUES (?, ?, 'x', 'controleur')")
    .run('Controleur B', 'b@test.nl').lastInsertRowid;

  propertyId = db
    .prepare(
      `INSERT INTO properties (opdrachtgever, werkbonnummer, address, geplande_opleverdatum, actuele_opleverdatum)
       VALUES ('Eigen Haard', 'WB-FE-1', 'Teststraat 1', '2026-12-01', '2026-12-01')`
    )
    .run().lastInsertRowid;

  db.prepare(`INSERT INTO property_assignments (property_id, user_id, role_in_property) VALUES (?, ?, 'monteur')`).run(
    propertyId,
    uitvoerderId
  );
});

after(() => {
  db.close();
  fs.rmSync(dbFile, { force: true });
  fs.rmSync(`${dbFile}-wal`, { force: true });
  fs.rmSync(`${dbFile}-shm`, { force: true });
});

test('uitvoerder mag eigen werk niet als controleur goedkeuren', () => {
  assert.throws(() => assertFourEyes(propertyId, uitvoerderId), FourEyesViolationError);
});

test('een andere medewerker mag wel controleren', () => {
  assert.doesNotThrow(() => assertFourEyes(propertyId, anderId));
});
