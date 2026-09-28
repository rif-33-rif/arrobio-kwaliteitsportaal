import 'dotenv/config';
import { createApp } from './app.js';
import { seed } from './db/seed.js';

const PORT = process.env.PORT || 4000;

// Op gratis hosting (Render) is de schijf niet blijvend: elke herstart begint
// met een lege database. seed() is idempotent en herstelt dan de demo-accounts.
if (process.env.AUTO_SEED !== 'false') {
  seed();
}

const app = createApp();

app.listen(PORT, () => {
  console.log(`Arrobio Kwaliteitsportaal API draait op http://localhost:${PORT}`);
});
