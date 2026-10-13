-- Arrobio Kwaliteitsportaal - databaseschema
-- Kwaliteitsborging en audittrail voor elektrotechnische mutatiewerkzaamheden

CREATE TABLE IF NOT EXISTS roles (
  code TEXT PRIMARY KEY CHECK (code IN ('beheerder', 'manager', 'controleur', 'monteur', 'leerling')),
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role_code TEXT NOT NULL REFERENCES roles(code),
  function TEXT,
  vakbekwaam INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  mfa_secret TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Woningdossier: één record per opdracht/werkbon voor een mutatiewoning
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opdrachtgever TEXT NOT NULL,
  project TEXT,
  werkbonnummer TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  huisnummer TEXT,
  toevoeging TEXT,
  postcode TEXT,
  plaats TEXT,
  datum_opdracht TEXT,
  startdatum TEXT,
  geplande_opleverdatum TEXT NOT NULL,
  actuele_opleverdatum TEXT NOT NULL,
  werkelijke_opleverdatum TEXT,
  omschrijving TEXT,
  bijzonderheden TEXT,
  status TEXT NOT NULL DEFAULT 'NIEUW' CHECK (status IN (
    'NIEUW', 'GEPLAND', 'IN_UITVOERING', 'GEREED_VOOR_CONTROLE',
    'HERSTEL_NODIG', 'GEREED_VOOR_HERCONTROLE', 'TECHNISCH_GOEDGEKEURD',
    'MANAGERCONTROLE', 'VRIJGEGEVEN', 'HEROPEND', 'GEANNULEERD'
  )),
  dossier_version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Toewijzingen per woning: monteur, leerling, controleur, manager
CREATE TABLE IF NOT EXISTS property_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role_in_property TEXT NOT NULL CHECK (role_in_property IN ('monteur', 'leerling', 'controleur', 'manager')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Werkzaamheden per woning
CREATE TABLE IF NOT EXISTS work_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  ruimte TEXT,
  aantal REAL NOT NULL DEFAULT 1,
  eenheid TEXT NOT NULL DEFAULT 'p/st',
  executor_id INTEGER REFERENCES users(id),
  date TEXT NOT NULL DEFAULT (date('now')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'afgerond')),
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Catalogus van standaard werkzaamheden (normkosten), te importeren vanuit Excel.
-- Puur referentie/gemak bij het invoeren; work_items blijft vrije tekst zodat
-- historische regels nooit wijzigen als de catalogus later wordt bijgewerkt.
CREATE TABLE IF NOT EXISTS work_item_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  discipline TEXT,
  description TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'stu',
  unit_price REAL,
  unit_price_2026 REAL,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Materiaalcatalogus met voorraadbewaking
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  unit TEXT NOT NULL DEFAULT 'stuk',
  stock_quantity REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Materiaalverbruik per werkzaamheid (traceerbaarheid richting opleverdossier)
CREATE TABLE IF NOT EXISTS work_item_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  quantity REAL NOT NULL DEFAULT 1,
  registered_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Handmatige voorraadmutaties (aanvulling, correctie) los van verbruik op een klus
CREATE TABLE IF NOT EXISTS material_stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  change REAL NOT NULL,
  reason TEXT,
  adjusted_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Configureerbare checklists (sjablonen) en items
CREATE TABLE IF NOT EXISTS checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Ingevulde checklist per woning
CREATE TABLE IF NOT EXISTS checklist_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  checklist_item_id INTEGER NOT NULL REFERENCES checklist_items(id),
  answer TEXT NOT NULL CHECK (answer IN ('akkoord', 'niet_akkoord', 'nvt')),
  description TEXT,
  herstelactie TEXT,
  filled_by INTEGER REFERENCES users(id),
  filled_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (property_id, checklist_item_id)
);

-- Elektrotechnische metingen
CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  value TEXT,
  unit TEXT,
  result TEXT,
  measured_at TEXT NOT NULL DEFAULT (datetime('now')),
  performed_by INTEGER REFERENCES users(id),
  instrument TEXT,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Foto's en overige bijlagen
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT,
  description TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bevindingen
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  finding_number INTEGER NOT NULL,
  category TEXT,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('laag', 'middel', 'hoog', 'veiligheidskritisch')),
  attachment_id INTEGER REFERENCES attachments(id),
  reported_by INTEGER REFERENCES users(id),
  assigned_to INTEGER REFERENCES users(id),
  repair_deadline TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_behandeling', 'gereed_voor_hercontrole', 'afgesloten')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (property_id, finding_number)
);

-- Herstelacties op bevindingen
CREATE TABLE IF NOT EXISTS repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id INTEGER NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT (date('now')),
  executor_id INTEGER REFERENCES users(id),
  explanation TEXT,
  after_attachment_id INTEGER REFERENCES attachments(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tweede technische controle (vierogenprincipe)
CREATE TABLE IF NOT EXISTS technical_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  reviewer_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL DEFAULT (datetime('now')),
  remarks TEXT,
  result TEXT NOT NULL CHECK (result IN ('goedgekeurd', 'herstel_nodig')),
  invalidated INTEGER NOT NULL DEFAULT 0,
  invalidated_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Managercontrole en vrijgave/terugsturen
CREATE TABLE IF NOT EXISTS manager_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  manager_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL DEFAULT (datetime('now')),
  result TEXT NOT NULL CHECK (result IN ('vrijgegeven', 'teruggestuurd')),
  reason TEXT,
  dossier_version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Externe/onafhankelijke keuringen
CREATE TABLE IF NOT EXISTS external_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  organisation TEXT NOT NULL,
  inspector TEXT,
  date TEXT NOT NULL,
  report_number TEXT,
  attachment_id INTEGER REFERENCES attachments(id),
  findings_count INTEGER NOT NULL DEFAULT 0,
  conclusion TEXT,
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wijzigingen in planningsdata (oorspronkelijke datum wordt nooit overschreven)
CREATE TABLE IF NOT EXISTS planning_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id),
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audittrail: iedere kritieke actie, niet verwijderbaar door reguliere gebruikers
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- PDF-opleverrapport versies
CREATE TABLE IF NOT EXISTS report_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  filename TEXT NOT NULL,
  generated_by INTEGER REFERENCES users(id),
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Verbeterplan-module: periodieke meting van verbeterthema's richting Logchies/Eigen Haard
CREATE TABLE IF NOT EXISTS improvement_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,
  theme TEXT NOT NULL CHECK (theme IN (
    'planning', 'communicatie', 'vierogencontrole', 'opleverdossier',
    'bevindingen', 'herstel', 'herhaling', 'onafhankelijke_keuringen'
  )),
  metric_label TEXT NOT NULL,
  numerator INTEGER NOT NULL,
  denominator INTEGER NOT NULL,
  remark TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO roles (code, name) VALUES
  ('beheerder', 'Beheerder'),
  ('manager', 'Manager'),
  ('controleur', 'Controleur'),
  ('monteur', 'Monteur'),
  ('leerling', 'Leerling');

-- Woningopname: een monteur loopt een woning door en legt per ruimte vast welke
-- standaardregels (en hoeveel) nodig zijn. Vervangt het papieren opnameformulier.
CREATE TABLE IF NOT EXISTS opname_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'p/st',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  template_row INTEGER,
  template_section TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS opnames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  address TEXT NOT NULL,
  datum TEXT NOT NULL DEFAULT (date('now')),
  planning TEXT,
  notities TEXT,
  status TEXT NOT NULL DEFAULT 'concept' CHECK (status IN ('concept', 'afgerond')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- product_id is NULL voor een losse "extra regel" die ter plekke is toegevoegd;
-- die draagt dan zelf description/unit.
CREATE TABLE IF NOT EXISTS opname_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opname_id INTEGER NOT NULL REFERENCES opnames(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES opname_products(id),
  description TEXT,
  unit TEXT,
  room TEXT NOT NULL,
  aantal REAL NOT NULL,
  remark TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_opname_lines_opname ON opname_lines(opname_id);
