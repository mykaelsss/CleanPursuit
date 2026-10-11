import { STATUS_CODES } from 'node:http';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type pg from 'pg';
import type { Env } from './env.ts';
import type { PhotoAnalyzer } from './lib/analyzer.ts';
import { HttpError } from './lib/errors.ts';
import type { Storage } from './lib/storage.ts';
import analyzer from './plugins/analyzer.ts';
import auth from './plugins/auth.ts';
import db from './plugins/db.ts';
import storage from './plugins/storage.ts';
import analysisRoutes from './routes/analysis.ts';
import authRoutes from './routes/auth.ts';
import eventRoutes from './routes/events.ts';
import fileRoutes from './routes/files.ts';
import equipmentRoutes from './routes/equipment.ts';
import dropoffRoutes from './routes/dropoffs.ts';
import hotspotRoutes from './routes/hotspots.ts';
import healthRoutes from './routes/health.ts';
import meRoutes from './routes/me.ts';
import questRoutes from './routes/quests.ts';
import reportRoutes from './routes/reports.ts';
import partiesRoutes from './routes/parties.ts';
import leaderboardRoutes from './routes/leaderboards.ts';

export interface BuildAppOptions {
  env: Env;
  pool: pg.Pool;
  storage: Storage;
  analyzer: PhotoAnalyzer;
}

function loggerOptions(env: Env): FastifyServerOptions['logger'] {
  if (env.NODE_ENV === 'development') {
    return { level: env.LOG_LEVEL, transport: { target: 'pino-pretty' } };
  }
  return { level: env.LOG_LEVEL };
}

export async function buildApp({ env, pool, storage: objectStorage, analyzer: photoAnalyzer }: BuildAppOptions) {
  const app = Fastify({ logger: loggerOptions(env) }).withTypeProvider<ZodTypeProvider>();

  // Zod schemas validate requests and shape responses, so undeclared fields never leave the API.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500 && !(error instanceof HttpError)) {
      // Hide internal details such as database errors from clients.
      request.log.error({ err: error }, 'request failed');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Something went wrong',
      });
    }
    return reply.status(statusCode).send({
      statusCode,
      code: error.code,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message: error.message,
    });
  });

  await app.register(helmet);
  // The app authenticates with bearer tokens, not cookies, so any origin is safe; only Expo web needs this.
  // @fastify/cors allows only GET, HEAD and POST by default, so list every method the API uses.
  await app.register(cors, { methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  // Off by default; routes opt in with `config: { rateLimit }`.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, { after }) =>
      new HttpError(429, 'RATE_LIMITED', `Too many requests; try again in ${after}`),
  });

  if (env.NODE_ENV !== 'production') {
    await app.register(swagger, {
      openapi: {
        info: { title: 'CleanPursuit API', version: '0.1.0' },
        components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: true });
  }

  await app.register(db, { pool });
  await app.register(storage, { storage: objectStorage });
  await app.register(analyzer, { analyzer: photoAnalyzer });
  await app.register(auth, { jwtSecret: env.JWT_SECRET });
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(fileRoutes);
  await app.register(analysisRoutes);
  await app.register(equipmentRoutes);
  await app.register(dropoffRoutes);
  await app.register(hotspotRoutes);
  await app.register(reportRoutes);
  await app.register(questRoutes);
  await app.register(eventRoutes);
  await app.register(partiesRoutes);
  await app.register(leaderboardRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
