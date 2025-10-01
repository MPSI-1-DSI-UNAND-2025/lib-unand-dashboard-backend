import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/SimpleUser.js';
import dotenv from 'dotenv';

// Helper safe logger (avoid throwing if circular)
function logDebug(context: string, payload: any) {
  if (process.env.AUTH_DEBUG === 'false') return; // allow disabling
  try {
    // eslint-disable-next-line no-console
    console.log(`[auth-debug] ${context}`, typeof payload === 'object' ? JSON.stringify(payload) : payload);
  } catch {
    // ignore
  }
}

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'simple-secret';          // ganti di production
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';             // akses token lifetime
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-secret';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterData {
  username: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO expiry of access token
}

export interface JWTPayload {
  userId: number;
  username: string;
}

export class SimpleAuthService {
  // Hash password
  static async hashPassword(password: string): Promise<string> {
    logDebug('hashPassword:start', { len: password?.length });
    if (typeof password !== 'string') throw new Error('Password must be string');
    const hash = await bcrypt.hash(password, 12);
    logDebug('hashPassword:done', { hashPrefix: hash.slice(0, 10) });
    return hash;
  }

  // Verify password
  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    logDebug('verifyPassword:start', { pwLen: password?.length, hashOk: !!hash });
    if (!hash || typeof hash !== 'string') return false;
    if (typeof password !== 'string') return false;
    const ok = await bcrypt.compare(password, hash);
    logDebug('verifyPassword:result', { ok });
    return ok;
  }

  // Generate tokens
  static generateTokens(user: User): AuthTokens {
    logDebug('generateTokens:start', { id: user.id, username: user.username });
    const payload = {
      userId: user.id,
      username: user.username
    };

    if (!JWT_SECRET) throw new Error('Missing JWT_SECRET');
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as any);

    if (!JWT_REFRESH_SECRET) throw new Error('Missing JWT_REFRESH_SECRET');
    const refreshToken = jwt.sign({ userId: user.id }, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN } as any);

    // Hitung kapan access token kadaluarsa (approx only)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    logDebug('generateTokens:done', { expiresAt });
    return { accessToken, refreshToken, expiresAt };
  }

  // Verify access token
  static verifyAccessToken(token: string): JWTPayload {
    try {
      return jwt.verify(token, JWT_SECRET) as JWTPayload;
    } catch (error) {
      throw new Error('Invalid access token');
    }
  }

  // Verify refresh token
  static verifyRefreshToken(token: string): { userId: number } {
    try {
      return jwt.verify(token, JWT_REFRESH_SECRET) as { userId: number };
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }

  // Register new user
  static async register(data: RegisterData): Promise<{ user: any; tokens: AuthTokens }> {
    // Check if user exists
    logDebug('register:input', { username: data?.username });
    if (!data?.username || !data?.password) throw new Error('Username & password required');
    const existingUser = await User.findOne({ where: { username: data.username } });

    if (existingUser) {
      throw new Error('Username already exists');
    }

    // Hash password
    const password_hash = await this.hashPassword(data.password);

    // Create user
    const user = await User.create({ username: data.username, password_hash });
    logDebug('register:userCreated', { id: user.id });
  // reload to ensure all auto fields loaded
  await user.reload();
  const createdId = user.getDataValue('id');

    // Generate tokens
  const tokens = this.generateTokens(user);

    // Save tokens to user
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours

    await user.update({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken, token_expires_at: expiresAt });
    logDebug('register:tokensSaved', { id: user.id });
  logDebug('register:tokensSaved', { id: createdId });

    // Return user without password
    const userResponse = user.toJSON();
    delete (userResponse as any).password_hash;

    return { user: userResponse, tokens };
  }

  // Login user
  static async login(data: LoginCredentials): Promise<{ user: any; tokens: AuthTokens }> {
    logDebug('login:start', { username: data?.username });
    if (!data?.username || !data?.password) throw new Error('Username & password required');

    const user = await User.findOne({ where: { username: data.username } });
    if (!user) {
      logDebug('login:notFound', {});
      throw new Error('Invalid username or password');
    }

    const rawHash = user.getDataValue('password_hash');
    logDebug('login:userRecord', {
      id: user.getDataValue('id'),
      username: user.getDataValue('username'),
      hasHash: !!rawHash,
      hashLen: rawHash ? String(rawHash).length : 0,
      accessTokenNull: user.getDataValue('access_token') == null,
      refreshTokenNull: user.getDataValue('refresh_token') == null
    });

    if (typeof rawHash !== 'string' || rawHash.length < 20) {
      logDebug('login:invalidStoredHash', { reason: 'hash not valid string', rawType: typeof rawHash });
      throw new Error('Invalid username or password');
    }

    const isValid = await this.verifyPassword(data.password, rawHash);
    if (!isValid) {
      logDebug('login:passwordMismatch', {});
      throw new Error('Invalid username or password');
    }

    const tokens = this.generateTokens(user);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    await user.update({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken, token_expires_at: expiresAt });
    logDebug('login:tokensSaved', { id: user.getDataValue('id') });

    const userResponse = user.toJSON();
    delete (userResponse as any).password_hash;
    return { user: userResponse, tokens };
  }

  // Refresh token
  static async refreshToken(refreshToken: string): Promise<AuthTokens> {
    try {
      const payload = this.verifyRefreshToken(refreshToken);

      // Find user
      const user = await User.findByPk(payload.userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if refresh token matches
      if (user.refresh_token !== refreshToken) {
        throw new Error('Invalid refresh token');
      }

      // Generate new tokens
      const tokens = this.generateTokens(user);

      // Update tokens
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      await user.update({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken, token_expires_at: expiresAt });
      logDebug('refresh:tokensUpdated', { id: user.id });

      return tokens;
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }

  // Logout
  static async logout(userId: number): Promise<void> {
    logDebug('logout:start', { userId });
    const user = await User.findByPk(userId);
    if (user) {
      await user.update({ access_token: null as any, refresh_token: null as any, token_expires_at: null as any });
      logDebug('logout:cleared', { userId });
    }
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

export default SimpleAuthService;