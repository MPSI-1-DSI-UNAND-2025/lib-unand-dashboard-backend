import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService, type JWTPayload } from '../services/authService.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: JWTPayload;
}

// Middleware untuk verifikasi JWT token
export async function authenticateToken(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return reply.code(401).send({
        success: false,
        message: 'Access token required'
      });
    }

    const payload = AuthService.verifyAccessToken(token);
    request.user = payload;
  } catch (error) {
    return reply.code(403).send({
      success: false,
      message: 'Invalid or expired token'
    });
  }
}

// Middleware untuk verifikasi role
export function authorizeRoles(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.code(401).send({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!roles.includes(request.user.role)) {
      return reply.code(403).send({
        success: false,
        message: 'Insufficient permissions'
      });
    }
  };
}

// Middleware untuk admin only
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.code(401).send({
      success: false,
      message: 'Authentication required'
    });
  }

  if (request.user.role !== 'admin') {
    return reply.code(403).send({
      success: false,
      message: 'Admin access required'
    });
  }
}

// Middleware untuk librarian dan admin
export async function requireLibrarianOrAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.code(401).send({
      success: false,
      message: 'Authentication required'
    });
  }

  if (!['admin', 'librarian'].includes(request.user.role)) {
    return reply.code(403).send({
      success: false,
      message: 'Librarian or admin access required'
    });
  }
}