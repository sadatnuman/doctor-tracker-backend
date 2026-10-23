import type { RequestHandler } from 'express';
import { ACCESS_COOKIE, type Role } from '../config/constants.js';
import { env } from '../config/env.js';
import { verifyAccessToken } from '../services/auth.service.js';
import { ApiError } from '../utils/ApiError.js';

/** Authentication: the httpOnly access cookie (browser) or a Bearer token (API clients). */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const token: string | undefined = req.cookies?.[ACCESS_COOKIE] ?? bearer;
  if (!token) throw new ApiError(401, 'Sign in to continue', 'UNAUTHORIZED');

  try {
    req.user = verifyAccessToken(token);
  } catch {
    // The client reacts to TOKEN_EXPIRED by calling /auth/refresh and retrying.
    throw new ApiError(401, 'Session expired', 'TOKEN_EXPIRED');
  }
  next();
};

/** Role-based access control: only the listed roles get through. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw ApiError.unauthorized();
    if (!roles.includes(req.user.role)) throw ApiError.forbidden();
    next();
  };

/**
 * Resource ownership for doctor-scoped routes (`/doctors/:id/...`): admins may act on
 * any doctor, a doctor only on their own roster entry. Patients never pass.
 */
export const requireDoctorScope =
  (param = 'id'): RequestHandler =>
  (req, _res, next) => {
    const user = req.user;
    if (!user) throw ApiError.unauthorized();
    if (user.role === 'admin') return next();
    if (user.role === 'doctor' && user.doctorId && user.doctorId === req.params[param]) return next();
    throw ApiError.forbidden('You can only access your own patients');
  };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense in depth (cookies are already SameSite=Lax): a state-changing request
 * that carries an Origin must come from an allowed frontend origin.
 */
export const verifyOrigin: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && !env.allowedOrigins.includes(origin)) {
    throw ApiError.forbidden('Cross-site request blocked');
  }
  next();
};
