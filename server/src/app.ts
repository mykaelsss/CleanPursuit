import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
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
import db from './plugins/db.ts';
import healthRoutes from './routes/health.ts';

export interface BuildAppOptions {
  env: Env;
  pool: pg.Pool;
}

function loggerOptions(env: Env): FastifyServerOptions['logger'] {
  if (env.NODE_ENV === 'development') {
    return { level: env.LOG_LEVEL, transport: { target: 'pino-pretty' } };
  }
  return { level: env.LOG_LEVEL };
}

export async function buildApp({ env, pool }: BuildAppOptions) {
  const app = Fastify({ logger: loggerOptions(env) }).withTypeProvider<ZodTypeProvider>();

  // Zod schemas validate requests and shape responses, so undeclared fields never leave the API.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
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
      error: error.name,
      message: error.message,
    });
  });

  await app.register(helmet);
  // The app authenticates with bearer tokens, not cookies, so any origin is safe; only Expo web needs this.
  await app.register(cors);

  if (env.NODE_ENV !== 'production') {
    await app.register(swagger, {
      openapi: { info: { title: 'CleanPursuit API', version: '0.1.0' } },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: true });
  }

  await app.register(db, { pool });
  await app.register(healthRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
