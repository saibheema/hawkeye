import type { FastifyInstance } from 'fastify';
import { db, runHistory, scripts, auditLog } from '@hawkeye/db';
import { eq, and, desc } from 'drizzle-orm';
import { generateId } from '../lib/id.js';

export async function runRoutes(app: FastifyInstance) {

  // GET /runs/:scriptId — run history for a script
  app.get('/:scriptId', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { userId } = (req as any).user;
    const { scriptId } = req.params as { scriptId: string };
    const [script] = await db.select().from(scripts)
      .where(and(eq(scripts.id, scriptId), eq(scripts.userId, userId)));
    if (!script) return reply.code(404).send({ error: 'Script not found' });

    return db.select().from(runHistory)
      .where(eq(runHistory.scriptId, scriptId))
      .orderBy(desc(runHistory.startedAt))
      .limit(50);
  });

  // POST /runs/:scriptId/start — record a run start
  app.post('/:scriptId/start', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { userId } = (req as any).user;
    const { scriptId } = req.params as { scriptId: string };
    const [script] = await db.select().from(scripts)
      .where(and(eq(scripts.id, scriptId), eq(scripts.userId, userId)));
    if (!script) return reply.code(404).send({ error: 'Script not found' });

    const now = Date.now();
    const id = generateId();
    const [run] = await db.insert(runHistory).values({
      id, scriptId, userId, status: 'running',
      startedAt: now, logs: [],
    }).returning();

    await db.insert(auditLog).values({
      id: generateId(), userId, action: 'script.run',
      domain: script.domain, resourceId: scriptId,
      timestamp: now,
    });

    return reply.code(201).send(run);
  });

  // POST /runs/:runId/complete — record run result
  app.post('/:runId/complete', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const { status, error, logs } = req.body as {
      status: 'success' | 'failed';
      error?: string;
      logs?: string[];
    };

    const [run] = await db.update(runHistory)
      .set({ status, error, logs: logs ?? [], completedAt: Date.now() })
      .where(eq(runHistory.id, runId))
      .returning();

    return run;
  });
}
