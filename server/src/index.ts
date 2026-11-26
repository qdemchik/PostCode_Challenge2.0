import Fastify from 'fastify';
import cors from '@fastify/cors';
import { initSession, restoreSession, persistSession, enableSessionAutosave } from './services/store.js';
import { preAssignContainers } from './services/assignment.js';
import { shipmentRoutes } from './routes/shipments.js';
import { containerRoutes } from './routes/containers.js';
import { waybillRoutes } from './routes/waybills.js';
import { printRoutes } from './routes/print.js';
import { demoRoutes } from './routes/demo.js';
import { reviewRoutes } from './routes/review.js';
import { tripRoutes } from './routes/trips.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

await shipmentRoutes(app);
await containerRoutes(app);
await waybillRoutes(app);
await printRoutes(app);
await demoRoutes(app);
await reviewRoutes(app);
await tripRoutes(app);

app.get('/api/health', async () => ({ ok: true, service: 'outgoing-mail-mock' }));

// bootstrap
const sessionPath = process.env.POSTCODE_SESSION_FILE;
const restored = restoreSession(sessionPath);
if (!restored) {
  initSession(false);
  const pre = preAssignContainers();
  console.log('[boot] Pre-assignment:', pre);
  persistSession(sessionPath);
} else {
  console.log('[boot] Restored previous session');
}
enableSessionAutosave(sessionPath);

const port = Number(process.env.PORT) || 3001;
app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`Mock API listening on http://localhost:${port}`);
});
