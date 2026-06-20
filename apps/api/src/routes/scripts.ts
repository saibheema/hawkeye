import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, scripts, scriptVersions, auditLog } from '@hawkeye/db';
import { eq, and } from 'drizzle-orm';
import { generateId } from '../lib/id.js';

const createScriptSchema = z.object({
  domain: z.string(),
  name: z.string(),
  description: z.string().default(''),
  code: z.string(),
  prompt: z.string(),
  model: z.string(),
  tags: z.array(z.string()).default([]),
});

const updateScriptSchema = createScriptSchema.partial().extend({
  enabled: z.boolean().optional(),
  status: z.enum(['draft','review','approved','archived']).optional(),
});

export async function scriptRoutes(app: FastifyInstance) {

  // GET /scripts/:domain — list scripts for a domain
  app.get('/:domain', { preHandler: [app.authenticate] }, async (req) => {
    const { userId } = (req as any).user;
    const { domain } = req.params as { domain: string };
    return db.select().from(scripts)
      .where(and(eq(scripts.userId, userId), eq(scripts.domain, domain)));
  });

  // GET /scripts/all — all scripts for user
  app.get('/all', { preHandler: [app.authenticate] }, async (req) => {
    const { userId } = (req as any).user;
    return db.select().from(scripts).where(eq(scripts.userId, userId));
  });

  // POST /scripts — create script
  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { userId } = (req as any).user;
    const body = createScriptSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const now = Date.now();
    const id = generateId();
    const [script] = await db.insert(scripts).values({
      id, userId,
      ...body.data,
      status: 'draft',
      enabled: true,
      autoRun: false,
      createdAt: now,
      updatedAt: now,
    }).returning();

    // Save initial version
    await db.insert(scriptVersions).values({
      id: generateId(), scriptId: id, version: 1,
      code: body.data.code, changedBy: userId, createdAt: now,
    });

    // Audit log
    await db.insert(auditLog).values({
      id: generateId(), userId, action: 'script.create',
      domain: body.data.domain, resourceId: id,
      payload: { name: body.data.name }, timestamp: now,
    });

    return reply.code(201).send(script);
  });

  // PUT /scripts/:id — update script
  app.put('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { userId } = (req as any).user;
    const { id } = req.params as { id: string };
    const body = updateScriptSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const now = Date.now();
    const [existing] = await db.select().from(scripts)
      .where(and(eq(scripts.id, id), eq(scripts.userId, userId)));
    if (!existing) return reply.code(404).send({ error: 'Script not found' });

    const [updated] = await db.update(scripts)
      .set({ ...body.data, updatedAt: now })
      .where(eq(scripts.id, id))
      .returning();

    if (body.data.code && body.data.code !== existing.code) {
      const versions = await db.select().from(scriptVersions).where(eq(scriptVersions.scriptId, id));
      await db.insert(scriptVersions).values({
        id: generateId(), scriptId: id,
        version: versions.length + 1,
        code: body.data.code, changedBy: userId, createdAt: now,
      });
    }

    return updated;
  });

  // DELETE /scripts/:id
  app.delete('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { userId } = (req as any).user;
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(scripts)
      .where(and(eq(scripts.id, id), eq(scripts.userId, userId)));
    if (!existing) return reply.code(404).send({ error: 'Script not found' });
    await db.delete(scripts).where(eq(scripts.id, id));
    return { success: true };
  });
}
