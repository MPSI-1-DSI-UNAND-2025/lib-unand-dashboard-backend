import type { FastifyRequest, FastifyReply } from 'fastify';
import { SimpleAuthService, type JWTPayload } from '../services/simpleAuthService.js';

// Simple auth middleware
export async function simpleAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return reply.code(401).send({
        success: false,
        message: 'Token required'
      });
    }

    const payload = SimpleAuthService.verifyAccessToken(token);
    (request as any).user = payload;
  } catch (error) {
    return reply.code(401).send({
      success: false,
      message: 'Invalid token'
    });
  }
}