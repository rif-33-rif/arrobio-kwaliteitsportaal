import db from '../db/index.js';
import { logAudit } from './audit.js';

export class DossierLockedError extends Error {
  constructor() {
    super('Dossier is definitief vrijgegeven. Gebruik eerst een formele heropening voordat wijzigingen mogelijk zijn.');
    this.name = 'DossierLockedError';
  }
}

// Sectie 20 van de bouwopdracht: wijzigingen aan werkzaamheden, metingen, foto's of
// checklist NA technische goedkeuring maken die goedkeuring automatisch ongeldig en
// zetten de woning terug naar GEREED_VOOR_CONTROLE. Na definitieve vrijgave is stille
// wijziging niet toegestaan; dat vereist eerst een formele heropening (/heropenen).
// Roep dit aan het begin van elke schrijfactie op woninggegevens aan.
export function guardMutation(propertyId, userId) {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
  if (!property) return;

  if (property.status === 'VRIJGEGEVEN') {
    throw new DossierLockedError();
  }

  if (['TECHNISCH_GOEDGEKEURD', 'MANAGERCONTROLE'].includes(property.status)) {
    const latestReview = db
      .prepare('SELECT id FROM technical_reviews WHERE property_id = ? AND invalidated = 0 ORDER BY id DESC LIMIT 1')
      .get(propertyId);
    if (latestReview) {
      db.prepare('UPDATE technical_reviews SET invalidated = 1, invalidated_reason = ? WHERE id = ?').run(
        'Dossier gewijzigd na technische goedkeuring',
        latestReview.id
      );
    }
    db.prepare(`UPDATE properties SET status = 'GEREED_VOOR_CONTROLE', updated_at = datetime('now') WHERE id = ?`).run(propertyId);
    logAudit({
      propertyId,
      userId,
      action: 'GOEDKEURING_ONGELDIG_GEMAAKT',
      fromStatus: property.status,
      toStatus: 'GEREED_VOOR_CONTROLE',
      details: { reden: 'Dossier gewijzigd na technische goedkeuring' },
    });
  }
}
