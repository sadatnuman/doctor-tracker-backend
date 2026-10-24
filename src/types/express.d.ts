import type { AuthUser } from '../services/auth.service.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate` from a verified access token. */
      user?: AuthUser;
      /** Parsed + coerced output of the zod schemas run by the `validate` middleware. */
      validated: { body?: any; query?: any; params?: any };
    }
  }
}

export {};
