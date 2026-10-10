import type { FastifyRequest } from 'fastify';

// Rate limits for signed-in routes, counted per user instead of per IP.
// Runs as a preHandler so `app.authenticate` has already set `request.user`.
export function perUserRateLimit(max: number, timeWindow: string) {
  return {
    max,
    timeWindow,
    hook: 'preHandler' as const,
    keyGenerator: (request: FastifyRequest) => request.user.id,
  };
}
