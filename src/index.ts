import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import dotenv from 'dotenv';
import { visitorRoutes } from './routes/visitor.js';
import { pingMySQL } from './db/mysqlClient.js';
import { registerVisitorSyncJob } from './cron/syncVisitors.js';
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

  await fastify.register(visitorRoutes);

  registerVisitorSyncJob();

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
