import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OPNAME_PRODUCTS } from './opnameDefaults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data.sqlite');
const schemaPath = path.join(__dirname, 'schema.sql');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);

// Lichte migratie voor bestaande databases: voeg kolommen toe die na de eerste
// release aan work_items zijn toegevoegd (ruimte/aantal/eenheid), zonder de
// bestaande database te hoeven verwijderen.
const workItemColumns = db.prepare("PRAGMA table_info(work_items)").all().map((c) => c.name);
if (!workItemColumns.includes('ruimte')) {
  db.exec("ALTER TABLE work_items ADD COLUMN ruimte TEXT");
}
if (!workItemColumns.includes('aantal')) {
  db.exec("ALTER TABLE work_items ADD COLUMN aantal REAL NOT NULL DEFAULT 1");
}
if (!workItemColumns.includes('eenheid')) {
  db.exec("ALTER TABLE work_items ADD COLUMN eenheid TEXT NOT NULL DEFAULT 'p/st'");
}

// Optionele MFA per gebruiker (sectie 27: "voeg waar mogelijk MFA toe").
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumns.includes('mfa_secret')) {
  db.exec('ALTER TABLE users ADD COLUMN mfa_secret TEXT');
}
if (!userColumns.includes('mfa_enabled')) {
  db.exec('ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0');
}

// Opnamemodule: kolommen die na de eerste release zijn toegevoegd.
const opnameProductColumns = db.prepare('PRAGMA table_info(opname_products)').all().map((c) => c.name);
if (!opnameProductColumns.includes('template_row')) db.exec('ALTER TABLE opname_products ADD COLUMN template_row INTEGER');
if (!opnameProductColumns.includes('template_section')) db.exec('ALTER TABLE opname_products ADD COLUMN template_section TEXT');
const opnameLineColumns = db.prepare('PRAGMA table_info(opname_lines)').all().map((c) => c.name);
if (!opnameLineColumns.includes('remark')) db.exec('ALTER TABLE opname_lines ADD COLUMN remark TEXT');

// Eerste keer: vul de opnamelijst met de regels van het papieren formulier.
if (db.prepare('SELECT COUNT(*) AS c FROM opname_products').get().c === 0) {
  const insert = db.prepare('INSERT INTO opname_products (description, unit, sort_order) VALUES (?, ?, ?)');
  DEFAULT_OPNAME_PRODUCTS.forEach(([description, unit], i) => insert.run(description, unit, (i + 1) * 10));
}

export default db;
