import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Check that the API and the database are up',
        response: {
          200: z.object({ status: z.literal('ok'), database: z.literal('ok') }),
          503: z.object({ status: z.literal('degraded'), database: z.literal('unreachable') }),
        },
      },
    },
    async (request, reply) => {
      try {
        await app.db.query('SELECT 1');
        return { status: 'ok', database: 'ok' } as const;
      } catch (err) {
        request.log.error({ err }, 'database health check failed');
        return reply.status(503).send({ status: 'degraded', database: 'unreachable' });
      }
    },
  );
};

export default healthRoutes;
