import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { authenticatePlugin } from './plugins/authenticate.js';
import { authRoutes } from './routes/auth.js';
import { scriptRoutes } from './routes/scripts.js';
import { runRoutes } from './routes/runs.js';
import { catalogRoutes } from './routes/catalog.js';

const app = Fastify({ logger: { level: 'info' } });

await app.register(cors, {
  origin: ['chrome-extension://*', 'http://localhost:3001'],
  credentials: true,
});

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error('JWT_SECRET must be set');
}

await app.register(jwt, {
  secret: jwtSecret,
});

await app.register(authenticatePlugin);

// Health check
app.get('/health', async () => ({ status: 'ok', timestamp: Date.now() }));

// Routes
await app.register(authRoutes, { prefix: '/auth' });
await app.register(scriptRoutes, { prefix: '/scripts' });
await app.register(runRoutes, { prefix: '/runs' });
await app.register(catalogRoutes, { prefix: '/catalog' });

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
console.log(`Hawkeye API running on http://localhost:${port}`);
