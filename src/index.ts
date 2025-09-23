import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import dotenv from 'dotenv';
import { visitorRoutes } from './routes/visitor.js';
import { bookRoutes } from './routes/book.js';
import { healthRoutes } from './routes/health.js';
import { registerBookStatsJob, prewarmBookCaches } from './cron/syncBooks.js';
import { pingMySQL } from './db/mysqlClient.js';
import { registerVisitorSyncJob, prewarmVisitorCaches } from './cron/syncVisitors.js';
import { initSequelize } from './db/sequelize.js';
import './cache/redisClient.js';

dotenv.config();

async function start() {
  const fastify = Fastify({ logger: true });
  try {
    await pingMySQL();
  } catch (e) {
    fastify.log.error({ err: e }, 'MySQL ping failed');
  }
  await fastify.register(cors, { origin: '*' });
  await fastify.register(helmet);
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'Library Visitor Metrics API',
        description: 'Endpoints for visitor counts and aggregates',
        version: '1.0.0'
      },
      servers: [
        { url: '/', description: 'Current server' }
      ]
    }
  });
  await fastify.register(swaggerUI, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true
    },
    staticCSP: false
  });

  // mark server start ref for health uptime
  (fastify as any).startTime = Date.now();

  await fastify.register(visitorRoutes);
  await fastify.register(bookRoutes);
  await fastify.register(healthRoutes);

  // Prewarm caches before starting real-time loop & cron schedules
  // Initialize Sequelize (with simple retry) before prewarm caches using ORM
  const maxRetries = 5;
  let attempt = 0;
  while (true) {
    try {
      attempt++;
      await initSequelize();
      break;
    } catch (e) {
      if (attempt >= maxRetries) {
        fastify.log.error({ err: e }, 'Sequelize init failed after retries');
        break; // proceed without aborting entire server (cache endpoints will warm later if DB recovers)
      }
      const backoff = attempt * 2000;
      fastify.log.warn(`Sequelize init retry ${attempt}/${maxRetries} after ${backoff}ms`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }

  await Promise.allSettled([
    prewarmVisitorCaches(),
    prewarmBookCaches()
  ]);

  registerVisitorSyncJob();
  registerBookStatsJob();

  const port = Number(process.env.PORT || 3000);
  try {
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
