import { z } from 'zod';

export const loginSchema = {
  body: z.object({
    email: z.email('Enter a valid email').trim().toLowerCase(),
    password: z.string().min(1, 'Password is required').max(128),
  }),
};
