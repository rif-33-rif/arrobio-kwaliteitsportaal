import db from '../db/index.js';

const insertEvent = db.prepare(
  `INSERT INTO audit_events (property_id, user_id, action, from_status, to_status, details)
   VALUES (?, ?, ?, ?, ?, ?)`
);

export function logAudit({ propertyId = null, userId = null, action, fromStatus = null, toStatus = null, details = null }) {
  insertEvent.run(propertyId, userId, action, fromStatus, toStatus, details ? JSON.stringify(details) : null);
}
