import type { UserRole } from '../models/user.model.js';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; role: UserRole; name: string };
      /** Parsed + coerced output of the zod schemas run by the `validate` middleware. */
      validated: { body?: any; query?: any; params?: any };
    }
  }
}

export {};
