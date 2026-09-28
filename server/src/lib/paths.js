import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, '..', '..');

// In productie (Fly.io) wijst UPLOADS_DIR naar een permanent gekoppeld volume
// (bv. /data/uploads), zodat foto's een deploy/herstart overleven. Lokaal
// gebruiken we gewoon de map naast de broncode.
export const uploadsRoot = process.env.UPLOADS_DIR || path.join(serverRoot, 'uploads');
