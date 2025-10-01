import Fastify from 'fastify';
import path from 'path';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import fs from 'fs';
import dotenv from 'dotenv';
import { visitorRoutes } from './routes/visitor.js';
import { bookRoutes } from './routes/book.js';
import { healthRoutes } from './routes/health.js';
import simpleAuthRoutes from './routes/simpleAuth.js';
import eventRoutes from './routes/event.js';
import roomFacilityRoutes from './routes/roomFacility.js';
import { registerBookStatsJob, prewarmBookCaches } from './cron/syncBooks.js';
import { pingMySQL } from './db/mysqlClient.js';
import { registerVisitorSyncJob, prewarmVisitorCaches } from './cron/syncVisitors.js';
// import { registerAuthCleanupJob } from './cron/authCleanup.js';
import { initSequelize } from './db/sequelize.js';
import { initAuthSequelize } from './db/authSequelize.js';
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
        title: 'Library Dashboard API',
        description: 'Endpoints for visitor counts, aggregates, and authentication',
        version: '1.0.0'
      },
      servers: [
        { url: '/', description: 'Current server' }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      }
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
  // file upload + static serving
  await fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
      files: 1,
      fields: 20
    }
  });

  // Pastikan folder upload sudah ada sebelum static plugin dipasang
  try {
    const uploadEventsDir = path.join(process.cwd(), 'uploads', 'events');
    await fs.promises.mkdir(uploadEventsDir, { recursive: true });
    fastify.log.info({ uploadEventsDir }, 'Upload events directory ensured');
  } catch (e) {
    fastify.log.error({ err: e }, 'Gagal membuat folder uploads/events');
  }
  await fastify.register(fastifyStatic, {
    root: path.join(process.cwd(), 'uploads'),
    prefix: '/uploads/'
  });

  await fastify.register(simpleAuthRoutes, { prefix: '/api/auth' });
  await fastify.register(eventRoutes);
  await fastify.register(roomFacilityRoutes);

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

  // Initialize Auth Database
  try {
    await initAuthSequelize();
    fastify.log.info('Auth database initialized successfully');
  } catch (e) {
    fastify.log.error({ err: e }, 'Auth database init failed - auth endpoints may not work');
  }

  await Promise.allSettled([
    prewarmVisitorCaches(),
    prewarmBookCaches()
  ]);

  registerVisitorSyncJob();
  registerBookStatsJob();
  // registerAuthCleanupJob();

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
