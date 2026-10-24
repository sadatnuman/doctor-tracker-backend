import { z } from 'zod';
import { GENDERS } from '../config/constants.js';
import { personName, phone } from './common.js';

const email = z.email('Enter a valid email').trim().toLowerCase().max(120);

/** At least 8 chars with a letter and a number; capped to bound bcrypt work. */
export const strongPassword = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

export const loginSchema = {
  body: z.object({
    email,
    password: z.string().min(1, 'Password is required').max(128),
  }),
};

/** Patient self-registration. `role` is never accepted from the client. */
export const registerSchema = {
  body: z.object({
    name: personName,
    email,
    password: strongPassword,
    phone,
    age: z.coerce.number().int().min(0).max(130),
    gender: z.enum(GENDERS),
  }),
};

export const changePasswordSchema = {
  body: z
    .object({
      currentPassword: z.string().min(1, 'Enter your current password').max(128),
      newPassword: strongPassword,
    })
    .refine((b) => b.currentPassword !== b.newPassword, {
      message: 'Choose a password you haven’t used here',
      path: ['newPassword'],
    }),
};

export const updateProfileSchema = {
  body: z
    .object({
      name: personName,
      phone,
      age: z.coerce.number().int().min(0).max(130),
      gender: z.enum(GENDERS),
    })
    .partial()
    .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' }),
};

export const doctorAccountSchema = {
  body: z.object({ password: strongPassword }),
};

export type RegisterInput = z.infer<typeof registerSchema.body>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema.body>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema.body>;
