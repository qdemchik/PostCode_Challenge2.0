import Fastify from 'fastify';
import cors from '@fastify/cors';
import { initSession, restoreSession, persistSession } from './services/store.js';
import { preAssignContainers } from './services/assignment.js';
import { shipmentRoutes } from './routes/shipments.js';
import { containerRoutes } from './routes/containers.js';
import { waybillRoutes } from './routes/waybills.js';
import { printRoutes } from './routes/print.js';
import { demoRoutes } from './routes/demo.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

await shipmentRoutes(app);
await containerRoutes(app);
await waybillRoutes(app);
await printRoutes(app);
await demoRoutes(app);

app.get('/api/health', async () => ({ ok: true, service: 'outgoing-mail-mock' }));

// bootstrap
const restored = restoreSession();
if (!restored) {
  initSession(false);
  const pre = preAssignContainers();
  console.log('[boot] Pre-assignment:', pre);
  persistSession();
} else {
  console.log('[boot] Restored previous session');
}

const port = Number(process.env.PORT) || 3001;
app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`Mock API listening on http://localhost:${port}`);
});
