import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import propertyRoutes from './routes/properties.js';
import dashboardRoutes from './routes/dashboard.js';
import workItemRoutes from './routes/workItems.js';
import measurementRoutes from './routes/measurements.js';
import attachmentRoutes from './routes/attachments.js';
import checklistRoutes from './routes/checklists.js';
import propertyChecklistRoutes from './routes/propertyChecklist.js';
import findingRoutes from './routes/findings.js';
import technicalReviewRoutes from './routes/technicalReviews.js';
import auditEventRoutes from './routes/auditEvents.js';
import externalInspectionRoutes from './routes/externalInspections.js';
import improvementMetricRoutes from './routes/improvementMetrics.js';
import reportRoutes from './routes/reports.js';
import materialRoutes from './routes/materials.js';
import workItemMaterialRoutes from './routes/workItemMaterials.js';
import workItemCatalogRoutes from './routes/workItemCatalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In productie draait de gebouwde React-app mee in hetzelfde proces (één service
// op Fly.io). Lokaal in ontwikkeling bestaat deze map niet en serveert Vite de
// frontend apart op zijn eigen poort.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');

export function createApp() {
  const app = express();

  // Beveiligingsheaders en basis rate-limiting (sectie 27 van de bouwopdracht).
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 1000,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/checklists', checklistRoutes);
  app.use('/api/audit-events', auditEventRoutes);
  app.use('/api/improvement-metrics', improvementMetricRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/materials', materialRoutes);
  app.use('/api/work-item-catalog', workItemCatalogRoutes);
  app.use('/api/properties/:propertyId/work-items/:itemId/materials', workItemMaterialRoutes);
  app.use('/api/properties/:propertyId/work-items', workItemRoutes);
  app.use('/api/properties/:propertyId/measurements', measurementRoutes);
  app.use('/api/properties/:propertyId/attachments', attachmentRoutes);
  app.use('/api/properties/:propertyId/checklist', propertyChecklistRoutes);
  app.use('/api/properties/:propertyId/findings', findingRoutes);
  app.use('/api/properties/:propertyId/technical-reviews', technicalReviewRoutes);
  app.use('/api/properties/:propertyId/external-inspections', externalInspectionRoutes);
  app.use('/api/properties', propertyRoutes);
  app.use('/api/dashboard', dashboardRoutes);

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Onbekend endpoint' });
  });

  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Interne serverfout' });
  });

  return app;
}
