import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'fallback-refresh-secret';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12');

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterData {
  username: string;
  email: string;
  password: string;
  full_name?: string;
  role?: 'admin' | 'librarian' | 'viewer';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface JWTPayload {
  userId: number;
  username: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export class AuthService {
  // Hash password
  static async hashPassword(password: string): Promise<string> {
    return await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }

  // Verify password
  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(password, hash);
  }

  // Generate JWT tokens
  static generateTokens(user: User): AuthTokens {
    const payload: JWTPayload = {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    };

    const accessTokenOptions = {
      expiresIn: JWT_EXPIRES_IN,
      issuer: 'lib-dashboard',
      audience: 'lib-dashboard-users'
    };

    const refreshTokenOptions = {
      expiresIn: JWT_REFRESH_EXPIRES_IN,
      issuer: 'lib-dashboard',
      audience: 'lib-dashboard-users'
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
      issuer: 'lib-dashboard',
      audience: 'lib-dashboard-users'
    } as any);

    const refreshToken = jwt.sign(
      { userId: user.id },
      JWT_REFRESH_SECRET,
      {
        expiresIn: JWT_REFRESH_EXPIRES_IN,
        issuer: 'lib-dashboard',
        audience: 'lib-dashboard-users'
      } as any
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: JWT_EXPIRES_IN
    };
  }

  // Verify JWT token
  static verifyAccessToken(token: string): JWTPayload {
    try {
      return jwt.verify(token, JWT_SECRET, {
        issuer: 'lib-dashboard',
        audience: 'lib-dashboard-users'
      }) as JWTPayload;
    } catch (error) {
      throw new Error('Invalid access token');
    }
  }

  // Verify refresh token
  static verifyRefreshToken(token: string): { userId: number } {
    try {
      return jwt.verify(token, JWT_REFRESH_SECRET, {
        issuer: 'lib-dashboard',
        audience: 'lib-dashboard-users'
      }) as { userId: number };
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }

  // Register new user
  static async register(data: RegisterData): Promise<User> {
    // Check if user already exists
    const existingUser = await User.findOne({
      where: {
        [Op.or]: [
          { username: data.username },
          { email: data.email }
        ]
      }
    });

    if (existingUser) {
      throw new Error('Username or email already exists');
    }

    // Hash password
    const password_hash = await this.hashPassword(data.password);

    // Create user
    const userData: any = {
      username: data.username,
      email: data.email,
      password_hash,
      role: data.role || 'viewer',
      is_active: true
    };
    
    if (data.full_name) {
      userData.full_name = data.full_name;
    }

    const user = await User.create(userData);

    return user;
  }

  // Login user
  static async login(credentials: LoginCredentials): Promise<{ user: User; tokens: AuthTokens }> {
    // Find user by username or email
    const user = await User.findOne({
      where: {
        [Op.or]: [
          { username: credentials.username },
          { email: credentials.username }
        ]
      }
    });

    if (!user) {
      throw new Error('Invalid credentials');
    }

    if (!user.is_active) {
      throw new Error('Account is deactivated');
    }

    // Verify password
    const isValidPassword = await this.verifyPassword(credentials.password, user.password_hash);
    if (!isValidPassword) {
      throw new Error('Invalid credentials');
    }

    // Generate tokens
    const tokens = this.generateTokens(user);

    // Store refresh token hash in database
    const tokenHash = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await RefreshToken.create({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt
    });

    // Update last login
    await user.update({ last_login: new Date() });

    // Remove password from response
    const userResponse = user.toJSON();
    delete (userResponse as any).password_hash;

    return { user: userResponse as User, tokens };
  }

  // Refresh access token
  static async refreshToken(refreshToken: string): Promise<AuthTokens> {
    try {
      // Verify refresh token
      const payload = this.verifyRefreshToken(refreshToken);

      // Check if token exists and is not revoked
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const storedToken = await RefreshToken.findOne({
        where: {
          user_id: payload.userId,
          token_hash: tokenHash,
          is_revoked: false,
          expires_at: {
            [Op.gt]: new Date()
          }
        }
      });

      if (!storedToken) {
        throw new Error('Invalid refresh token');
      }

      // Get user
      const user = await User.findByPk(payload.userId);
      if (!user || !user.is_active) {
        throw new Error('User not found or deactivated');
      }

      // Generate new tokens
      const newTokens = this.generateTokens(user);

      // Revoke old refresh token
      await storedToken.update({ is_revoked: true });

      // Store new refresh token
      const newTokenHash = crypto.createHash('sha256').update(newTokens.refreshToken).digest('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await RefreshToken.create({
        user_id: user.id,
        token_hash: newTokenHash,
        expires_at: expiresAt
      });

      return newTokens;
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }

  // Logout (revoke refresh token)
  static async logout(refreshToken: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    
    await RefreshToken.update(
      { is_revoked: true },
      {
        where: {
          token_hash: tokenHash,
          is_revoked: false
        }
      }
    );
  }

  // Logout all devices (revoke all user's refresh tokens)
  static async logoutAllDevices(userId: number): Promise<void> {
    await RefreshToken.update(
      { is_revoked: true },
      {
        where: {
          user_id: userId,
          is_revoked: false
        }
      }
    );
  }

  // Clean expired refresh tokens (for cron job)
  static async cleanExpiredTokens(): Promise<void> {
    await RefreshToken.destroy({
      where: {
        expires_at: {
          [Op.lt]: new Date()
        }
      }
    });
  }

  // Get user by ID
  static async getUserById(id: number): Promise<User | null> {
    const user = await User.findByPk(id);
    if (user) {
      const userResponse = user.toJSON();
      delete (userResponse as any).password_hash;
      return userResponse as User;
    }
    return null;
  }
}

export default AuthService;