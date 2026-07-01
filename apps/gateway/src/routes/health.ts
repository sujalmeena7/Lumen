import type { FastifyPluginAsync } from 'fastify';

export interface HealthCheckers {
  checkDb: () => Promise<boolean>;
  checkRedis: () => Promise<boolean>;
}

export const healthRoutes: FastifyPluginAsync<HealthCheckers> = async (fastify, checkers) => {
  fastify.get('/health', async (_request, reply) => {
    const [dbOk, redisOk] = await Promise.all([
      checkers.checkDb().catch(() => false),
      checkers.checkRedis().catch(() => false),
    ]);
    const healthy = dbOk && redisOk;
    reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      dependencies: { postgres: dbOk ? 'ok' : 'down', redis: redisOk ? 'ok' : 'down' },
    });
  });
};
