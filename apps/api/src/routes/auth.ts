import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createUser, validateUser } from '../lib/auth.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (req, reply) => {
    const body = registerSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    try {
      const user = await createUser(body.data.email, body.data.password, body.data.name);
      const token = app.jwt.sign({ userId: user.id, email: user.email });
      return { token, user: { id: user.id, email: user.email, name: user.name } };
    } catch {
      return reply.code(409).send({ error: 'Email already registered' });
    }
  });

  app.post('/login', async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const user = await validateUser(body.data.email, body.data.password);
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' });

    const token = app.jwt.sign({ userId: user.id, email: user.email });
    return { token, user: { id: user.id, email: user.email, name: user.name } };
  });

  app.get('/me', { preHandler: [app.authenticate] }, async (req) => {
    return (req as any).user;
  });
}
