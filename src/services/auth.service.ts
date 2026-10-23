import type { CookieOptions } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UserModel, type UserDocument, type UserRole } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';

export interface AuthTokenPayload {
  id: string;
  email: string;
  role: UserRole;
  name: string;
}

const JWT_ISSUER = 'doctor-tracker-api';

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    issuer: JWT_ISSUER,
    subject: payload.id,
  });
}

export function verifyToken(token: string): AuthTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
  }) as AuthTokenPayload;
  return { id: decoded.id, email: decoded.email, role: decoded.role, name: decoded.name };
}

export const baseCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax',
  path: '/',
});

/** Cookie lifetime mirrors the JWT expiry so both expire together. */
export function authCookieOptions(token: string): CookieOptions {
  const { exp, iat } = jwt.decode(token) as { exp: number; iat: number };
  return { ...baseCookieOptions(), maxAge: (exp - iat) * 1000 };
}

export async function login(email: string, password: string) {
  const user = (await UserModel.findOne({ email }).select('+password')) as UserDocument | null;
  // Same message for unknown email and wrong password to avoid user enumeration.
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
  }
  const payload: AuthTokenPayload = { id: user.id, email: user.email, role: user.role, name: user.name };
  return { user: payload, token: signToken(payload) };
}

export async function getUserById(id: string) {
  const user = await UserModel.findById(id).lean();
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  return { id: String(user._id), name: user.name, email: user.email, role: user.role };
}
