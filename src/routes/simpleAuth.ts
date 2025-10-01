import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SimpleAuthService, type LoginCredentials, type RegisterData } from '../services/simpleAuthService.js';
import { simpleAuth } from '../middleware/simpleAuth.js';

interface RefreshBody { refreshToken: string }

export default async function simpleAuthRoutes(fastify: FastifyInstance) {
  // REGISTER
  fastify.post('/register', {
    schema: {
      description: 'Register user baru (username unik)',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 3 },
          password: { type: 'string', minLength: 3 }
        }
      }
    }
  }, async (req: FastifyRequest<{ Body: RegisterData }>, reply: FastifyReply) => {
    try {
      const { user, tokens } = await SimpleAuthService.register(req.body);
      reply.code(201).send({ success: true, message: 'Registered', data: { user, tokens } });
    } catch (e: any) {
      reply.code(400).send({ success: false, message: e.message });
    }
  });

  // LOGIN
  fastify.post('/login', {
    schema: {
      description: 'Login user (return access & refresh token)',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' }
        }
      }
    }
  }, async (req: FastifyRequest<{ Body: LoginCredentials }>, reply: FastifyReply) => {
    try {
      const { user, tokens } = await SimpleAuthService.login(req.body);
      reply.send({ success: true, message: 'Login ok', data: { user, tokens } });
    } catch (e: any) {
      reply.code(401).send({ success: false, message: e.message });
    }
  });

  // REFRESH
  fastify.post('/refresh', {
    schema: {
      description: 'Refresh access token pakai refreshToken',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: { refreshToken: { type: 'string' } }
      }
    }
  }, async (req: FastifyRequest<{ Body: RefreshBody }>, reply: FastifyReply) => {
    try {
      const tokens = await SimpleAuthService.refreshToken(req.body.refreshToken);
      reply.send({ success: true, message: 'Refreshed', data: { tokens } });
    } catch (e: any) {
      reply.code(401).send({ success: false, message: e.message });
    }
  });

  // ME
  fastify.get('/me', { preHandler: simpleAuth, schema: { tags: ['Auth'], description: 'Info user login' } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userJwt = (req as any).user;
      const user = await SimpleAuthService.getUserById(userJwt.userId);
      reply.send({ success: true, data: { user } });
    });

  // VERIFY
  fastify.get('/verify', { preHandler: simpleAuth, schema: { tags: ['Auth'], description: 'Cek token masih valid' } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = (req as any).user;
      reply.send({ success: true, data: { valid: true, user } });
    });

  // LOGOUT
  fastify.post('/logout', { preHandler: simpleAuth, schema: { tags: ['Auth'], description: 'Logout (hapus token di DB)' } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = (req as any).user;
      await SimpleAuthService.logout(user.userId);
      reply.send({ success: true, message: 'Logged out' });
    });
}