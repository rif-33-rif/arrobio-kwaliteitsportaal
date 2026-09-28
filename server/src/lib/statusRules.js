// Centraal statusmodel. Dit is de ENIGE plek waar geldige statusovergangen
// worden bepaald. Geen enkele route mag een status rechtstreeks overschrijven
// zonder hier langs te gaan (sectie 30 en 33 van de bouwopdracht).

export const STATUSES = [
  'NIEUW',
  'GEPLAND',
  'IN_UITVOERING',
  'GEREED_VOOR_CONTROLE',
  'HERSTEL_NODIG',
  'GEREED_VOOR_HERCONTROLE',
  'TECHNISCH_GOEDGEKEURD',
  'MANAGERCONTROLE',
  'VRIJGEGEVEN',
  'HEROPEND',
  'GEANNULEERD',
];

const TRANSITIONS = {
  NIEUW: ['GEPLAND', 'GEANNULEERD'],
  GEPLAND: ['IN_UITVOERING', 'GEANNULEERD'],
  IN_UITVOERING: ['GEREED_VOOR_CONTROLE', 'GEANNULEERD'],
  GEREED_VOOR_CONTROLE: ['TECHNISCH_GOEDGEKEURD', 'HERSTEL_NODIG'],
  HERSTEL_NODIG: ['GEREED_VOOR_HERCONTROLE'],
  GEREED_VOOR_HERCONTROLE: ['TECHNISCH_GOEDGEKEURD', 'HERSTEL_NODIG'],
  TECHNISCH_GOEDGEKEURD: ['MANAGERCONTROLE', 'GEREED_VOOR_CONTROLE'],
  MANAGERCONTROLE: ['VRIJGEGEVEN', 'HERSTEL_NODIG'],
  VRIJGEGEVEN: ['HEROPEND'],
  HEROPEND: ['GEREED_VOOR_CONTROLE'],
  GEANNULEERD: [],
};

export class InvalidTransitionError extends Error {
  constructor(from, to) {
    super(`Statusovergang van ${from} naar ${to} is niet toegestaan`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertValidTransition(from, to) {
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}
