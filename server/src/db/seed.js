import bcrypt from 'bcryptjs';
import db from './index.js';

const demoUsers = [
  { name: 'Beheerder Demo', email: 'beheerder@arro-kwaliteit.nl', role_code: 'beheerder', function: 'Systeembeheerder' },
  { name: 'Manager Demo', email: 'manager@arro-kwaliteit.nl', role_code: 'manager', function: 'Projectmanager' },
  { name: 'Controleur Demo', email: 'controleur@arro-kwaliteit.nl', role_code: 'controleur', function: 'Vakbekwaam controleur' },
  { name: 'Monteur Demo A', email: 'monteur@arro-kwaliteit.nl', role_code: 'monteur', function: 'Elektromonteur' },
  { name: 'Leerling Demo', email: 'leerling@arro-kwaliteit.nl', role_code: 'leerling', function: 'Leerling monteur' },
];

export function seed() {
  const insertUser = db.prepare(
    `INSERT INTO users (name, email, password_hash, role_code, function) VALUES (?, ?, ?, ?, ?)`
  );

  for (const u of demoUsers) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(u.email);
    if (existing) {
      console.log(`Bestaat al, overgeslagen: ${u.email}`);
      continue;
    }
    const hash = bcrypt.hashSync('welkom123', 10);
    insertUser.run(u.name, u.email, hash, u.role_code, u.function);
    console.log(`Aangemaakt: ${u.email} / welkom123 (${u.role_code})`);
  }

  // Standaard kwaliteitschecklist
  const checklistExists = db.prepare('SELECT id FROM checklists WHERE name = ?').get('Standaard opleverchecklist');
  if (!checklistExists) {
    const result = db.prepare('INSERT INTO checklists (name) VALUES (?)').run('Standaard opleverchecklist');
    const checklistId = result.lastInsertRowid;
    const items = [
      'Visuele controle uitgevoerd',
      'Schakelmateriaal correct gemonteerd',
      'Wandcontactdozen gecontroleerd',
      'Beschadigingen gecontroleerd',
      'Groepenkast gecontroleerd',
      'Aarding gecontroleerd',
      'Aansluitingen gecontroleerd',
      'Afwerking gecontroleerd',
      'Werkplek schoon achtergelaten',
      'Benodigde metingen uitgevoerd',
      'Foto\'s aanwezig',
      'Meetrapport aanwezig',
      'Opdracht volledig uitgevoerd',
    ];
    const insertItem = db.prepare('INSERT INTO checklist_items (checklist_id, text, sort_order) VALUES (?, ?, ?)');
    items.forEach((text, i) => insertItem.run(checklistId, text, i));
    console.log(`Standaardchecklist aangemaakt met ${items.length} items.`);
  }

  // Demodata: enkele fictieve woningen (sectie 32 van de bouwopdracht)
  const propertyExists = db.prepare('SELECT id FROM properties LIMIT 1').get();
  if (!propertyExists) {
    const manager = db.prepare(`SELECT id FROM users WHERE role_code = 'manager' LIMIT 1`).get();
    const monteur = db.prepare(`SELECT id FROM users WHERE role_code = 'monteur' LIMIT 1`).get();
    const controleur = db.prepare(`SELECT id FROM users WHERE role_code = 'controleur' LIMIT 1`).get();

    const demoProperties = [
      {
        opdrachtgever: 'Eigen Haard', project: 'Mutatie West', werkbonnummer: 'WB-2026-0001',
        address: 'Burgemeester de Vlugtlaan', huisnummer: '120', postcode: '1063 BJ', plaats: 'Amsterdam',
        geplande_opleverdatum: '2026-10-01', actuele_opleverdatum: '2026-10-01', status: 'IN_UITVOERING',
      },
      {
        opdrachtgever: 'Eigen Haard', project: 'Mutatie West', werkbonnummer: 'WB-2026-0002',
        address: 'Jan Evertsenstraat', huisnummer: '84', postcode: '1057 BW', plaats: 'Amsterdam',
        geplande_opleverdatum: '2026-09-28', actuele_opleverdatum: '2026-09-28', status: 'GEREED_VOOR_CONTROLE',
      },
      {
        opdrachtgever: 'Eigen Haard', project: 'Mutatie Nieuw-West', werkbonnummer: 'WB-2026-0003',
        address: "Plein '40-'45", huisnummer: '16', postcode: '1064 SW', plaats: 'Amsterdam',
        geplande_opleverdatum: '2026-09-25', actuele_opleverdatum: '2026-09-30', status: 'HERSTEL_NODIG',
      },
      {
        opdrachtgever: 'Eigen Haard', project: 'Mutatie West', werkbonnummer: 'WB-2026-0004',
        address: 'Bos en Lommerweg', huisnummer: '210', postcode: '1055 AA', plaats: 'Amsterdam',
        geplande_opleverdatum: '2026-09-20', actuele_opleverdatum: '2026-09-20', werkelijke_opleverdatum: '2026-09-20',
        status: 'VRIJGEGEVEN',
      },
    ];

    const insertProperty = db.prepare(`
      INSERT INTO properties (opdrachtgever, project, werkbonnummer, address, huisnummer, postcode, plaats,
        geplande_opleverdatum, actuele_opleverdatum, werkelijke_opleverdatum, status, created_by)
      VALUES (@opdrachtgever, @project, @werkbonnummer, @address, @huisnummer, @postcode, @plaats,
        @geplande_opleverdatum, @actuele_opleverdatum, @werkelijke_opleverdatum, @status, @created_by)
    `);
    const insertAssignment = db.prepare(
      `INSERT INTO property_assignments (property_id, user_id, role_in_property) VALUES (?, ?, ?)`
    );

    for (const p of demoProperties) {
      const result = insertProperty.run({
        ...p,
        werkelijke_opleverdatum: p.werkelijke_opleverdatum || null,
        created_by: manager?.id || null,
      });
      const propertyId = result.lastInsertRowid;
      if (monteur) insertAssignment.run(propertyId, monteur.id, 'monteur');
      if (controleur) insertAssignment.run(propertyId, controleur.id, 'controleur');
      if (manager) insertAssignment.run(propertyId, manager.id, 'manager');
    }
    console.log(`${demoProperties.length} demo-woningen aangemaakt (duidelijk fictief).`);
  }

  console.log('Seed voltooid.');
}

// Direct aangeroepen via `npm run seed` (niet wanneer als module geimporteerd, bv. bij serverstart).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain) {
  seed();
}
