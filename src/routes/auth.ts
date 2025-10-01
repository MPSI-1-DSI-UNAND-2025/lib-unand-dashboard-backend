import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AuthService, type LoginCredentials, type RegisterData } from '../services/authService.js';
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js';



export default async function authRoutes(fastify: FastifyInstance) {
  // Register endpoint
  fastify.post('/register', {
    schema: {
      description: 'Register new user',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['username', 'email', 'password'],
        properties: {
          username: { type: 'string', minLength: 3 },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6 },
          full_name: { type: 'string' },
          role: {
            type: 'string',
            enum: ['admin', 'librarian', 'viewer'],
            default: 'viewer'
          }
        }
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                username: { type: 'string' },
                email: { type: 'string' },
                full_name: { type: 'string' },
                role: { type: 'string' },
                is_active: { type: 'boolean' },
                created_at: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = await AuthService.register(request.body as RegisterData);
      
      // Remove password_hash from response
      const userResponse = user.toJSON();
      delete (userResponse as any).password_hash;
      
      reply.code(201).send({
        success: true,
        message: 'User registered successfully',
        data: userResponse
      });
    } catch (error: any) {
      reply.code(400).send({
        success: false,
        message: error.message || 'Registration failed'
      });
    }
  });

  // Login endpoint
  fastify.post('/login', {
    schema: {
      description: 'User login',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                user: {
                  type: 'object',
                  properties: {
                    id: { type: 'number' },
                    username: { type: 'string' },
                    email: { type: 'string' },
                    full_name: { type: 'string' },
                    role: { type: 'string' },
                    is_active: { type: 'boolean' }
                  }
                },
                tokens: {
                  type: 'object',
                  properties: {
                    accessToken: { type: 'string' },
                    refreshToken: { type: 'string' },
                    expiresIn: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await AuthService.login(request.body as LoginCredentials);
      
      reply.send({
        success: true,
        message: 'Login successful',
        data: result
      });
    } catch (error: any) {
      reply.code(401).send({
        success: false,
        message: error.message || 'Login failed'
      });
    }
  });

  // Refresh token endpoint
  fastify.post('/refresh-token', {
    schema: {
      description: 'Refresh access token',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                accessToken: { type: 'string' },
                refreshToken: { type: 'string' },
                expiresIn: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { refreshToken: string };
      const tokens = await AuthService.refreshToken(body.refreshToken);
      
      reply.send({
        success: true,
        message: 'Token refreshed successfully',
        data: tokens
      });
    } catch (error: any) {
      reply.code(401).send({
        success: false,
        message: error.message || 'Token refresh failed'
      });
    }
  });

  // Logout endpoint
  fastify.post('/logout', {
    schema: {
      description: 'User logout',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { refreshToken: string };
      await AuthService.logout(body.refreshToken);
      
      reply.send({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error: any) {
      reply.code(400).send({
        success: false,
        message: error.message || 'Logout failed'
      });
    }
  });

  // Logout all devices endpoint
  fastify.post('/logout-all', {
    preHandler: authenticateToken,
    schema: {
      description: 'Logout from all devices',
      tags: ['Auth'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      await AuthService.logoutAllDevices(user.userId);
      
      reply.send({
        success: true,
        message: 'Logged out from all devices'
      });
    } catch (error: any) {
      reply.code(400).send({
        success: false,
        message: error.message || 'Logout failed'
      });
    }
  });

  // Get current user profile
  fastify.get('/me', {
    preHandler: authenticateToken,
    schema: {
      description: 'Get current user profile',
      tags: ['Auth'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                username: { type: 'string' },
                email: { type: 'string' },
                full_name: { type: 'string' },
                role: { type: 'string' },
                is_active: { type: 'boolean' },
                last_login: { type: 'string' },
                created_at: { type: 'string' },
                updated_at: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const requestUser = (request as any).user;
      const user = await AuthService.getUserById(requestUser.userId);
      
      if (!user) {
        return reply.code(404).send({
          success: false,
          message: 'User not found'
        });
      }

      reply.send({
        success: true,
        message: 'User profile retrieved successfully',
        data: user
      });
    } catch (error: any) {
      reply.code(500).send({
        success: false,
        message: error.message || 'Failed to get user profile'
      });
    }
  });

  // Verify token endpoint (for checking if token is still valid)
  fastify.get('/verify', {
    preHandler: authenticateToken,
    schema: {
      description: 'Verify if access token is valid',
      tags: ['Auth'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                valid: { type: 'boolean' },
                userId: { type: 'number' },
                username: { type: 'string' },
                role: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    reply.send({
      success: true,
      message: 'Token is valid',
      data: {
        valid: true,
        userId: user.userId,
        username: user.username,
        role: user.role
      }
    });
  });

  // Debug endpoint: Get user info by username/email
  fastify.get('/debug/user/:identifier', {
    schema: {
      description: 'Debug: Get user info by username or email',
      tags: ['Debug'],
      params: {
        type: 'object',
        properties: {
          identifier: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { identifier: string } }>, reply: FastifyReply) => {
    try {
      const { User } = await import('../models/User.js');
      const { Op } = await import('sequelize');
      
      const user = await User.findOne({
        where: {
          [Op.or]: [
            { username: request.params.identifier },
            { email: request.params.identifier }
          ]
        }
      });

      if (!user) {
        return reply.code(404).send({
          success: false,
          message: 'User not found'
        });
      }

      const userResponse = user.toJSON();
      delete (userResponse as any).password_hash;

      reply.send({
        success: true,
        data: userResponse
      });
    } catch (error: any) {
      reply.code(500).send({
        success: false,
        message: error.message
      });
    }
  });

  // Debug endpoint: Activate user
  fastify.patch('/debug/user/:identifier/activate', {
    schema: {
      description: 'Debug: Activate user by username or email',
      tags: ['Debug'],
      params: {
        type: 'object',
        properties: {
          identifier: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { identifier: string } }>, reply: FastifyReply) => {
    try {
      const { User } = await import('../models/User.js');
      const { Op } = await import('sequelize');
      
      const user = await User.findOne({
        where: {
          [Op.or]: [
            { username: request.params.identifier },
            { email: request.params.identifier }
          ]
        }
      });

      if (!user) {
        return reply.code(404).send({
          success: false,
          message: 'User not found'
        });
      }

      await user.update({ is_active: true });

      reply.send({
        success: true,
        message: 'User activated successfully',
        data: {
          username: user.username,
          email: user.email,
          is_active: true
        }
      });
    } catch (error: any) {
      reply.code(500).send({
        success: false,
        message: error.message
      });
    }
  });
}