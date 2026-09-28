import db from '../db/index.js';

export class FourEyesViolationError extends Error {
  constructor() {
    super(
      'Volgens het vierogenprincipe mag de uitvoerder zijn eigen werkzaamheden niet als tweede controleur goedkeuren.'
    );
    this.name = 'FourEyesViolationError';
  }
}

// Harde, server-side afdwinging van het vierogenprincipe (sectie 2 en 15 van de
// bouwopdracht). Dit mag NOOIT alleen client-side gecontroleerd worden en een
// manager mag deze controle niet overslaan.
export function assertFourEyes(propertyId, reviewerId) {
  const executors = db
    .prepare('SELECT DISTINCT executor_id FROM work_items WHERE property_id = ? AND executor_id IS NOT NULL')
    .all(propertyId)
    .map((r) => r.executor_id);

  const assignedExecutors = db
    .prepare(
      `SELECT DISTINCT user_id FROM property_assignments
       WHERE property_id = ? AND role_in_property IN ('monteur', 'leerling') AND active = 1`
    )
    .all(propertyId)
    .map((r) => r.user_id);

  const uitvoerders = new Set([...executors, ...assignedExecutors]);

  if (uitvoerders.has(Number(reviewerId))) {
    throw new FourEyesViolationError();
  }
}
