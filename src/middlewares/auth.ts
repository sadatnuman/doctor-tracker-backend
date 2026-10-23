import type { RequestHandler } from 'express';
import { AUTH_COOKIE } from '../config/constants.js';
import type { UserRole } from '../models/user.model.js';
import { verifyToken } from '../services/auth.service.js';
import { ApiError } from '../utils/ApiError.js';

/** Authentication: accepts the httpOnly cookie (browser) or a Bearer token (API clients). */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const token: string | undefined = req.cookies?.[AUTH_COOKIE] ?? bearer;
  if (!token) throw ApiError.unauthorized();

  try {
    req.user = verifyToken(token);
  } catch {
    throw ApiError.unauthorized('Session expired or invalid. Please sign in again.');
  }
  next();
};

/** Authorization: restricts a route to the given roles. */
export const requireRole =
  (...roles: UserRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw ApiError.unauthorized();
    if (!roles.includes(req.user.role)) throw ApiError.forbidden();
    next();
  };
