import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/** Brute-force protection on the login endpoint. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Try again in 15 minutes.' } },
});

/** General API limiter. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 10_000 : 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, slow down.' } },
});

const isUnsafeKey = (key: string) => key.startsWith('$') || key.includes('.');

function stripOperators(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripOperators);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !isUnsafeKey(key))
        .map(([key, v]) => [key, stripOperators(v)]),
    );
  }
  return value;
}

/** Defense in depth against NoSQL operator injection (`{ "$gt": "" }`) in bodies. */
export const sanitizeBody: RequestHandler = (req, _res, next) => {
  if (req.body && typeof req.body === 'object') req.body = stripOperators(req.body);
  next();
};
