import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, apiCatalog } from '@hawkeye/db';
import { eq, and } from 'drizzle-orm';
import { generateId } from '../lib/id.js';

const ingestSchema = z.object({
  domain: z.string(),
  endpoints: z.array(z.object({
    method: z.string(),
    path: z.string(),
    baseUrl: z.string(),
    authType: z.string().default('none'),
    queryParams: z.record(z.string()).default({}),
  })),
});

export async function catalogRoutes(app: FastifyInstance) {

  // GET /catalog/:domain
  app.get('/:domain', { preHandler: [app.authenticate] }, async (req) => {
    const { userId } = (req as any).user;
    const { domain } = req.params as { domain: string };
    return db.select().from(apiCatalog)
      .where(and(eq(apiCatalog.userId, userId), eq(apiCatalog.domain, domain)));
  });

  // POST /catalog — ingest discovered endpoints from extension
  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { userId } = (req as any).user;
    const body = ingestSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const now = Date.now();
    const results = [];

    for (const ep of body.data.endpoints) {
      const [existing] = await db.select().from(apiCatalog)
        .where(and(
          eq(apiCatalog.userId, userId),
          eq(apiCatalog.domain, body.data.domain),
          eq(apiCatalog.method, ep.method),
          eq(apiCatalog.path, ep.path),
        ));

      if (existing) {
        const [updated] = await db.update(apiCatalog)
          .set({ callCount: existing.callCount + 1, lastCalled: now })
          .where(eq(apiCatalog.id, existing.id))
          .returning();
        results.push(updated);
      } else {
        const [created] = await db.insert(apiCatalog).values({
          id: generateId(), userId,
          domain: body.data.domain,
          ...ep,
          callCount: 1,
          lastCalled: now,
        }).returning();
        results.push(created);
      }
    }

    return { ingested: results.length };
  });
}
