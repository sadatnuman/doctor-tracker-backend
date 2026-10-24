import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { PAGINATION } from '../config/constants.js';

export const objectId = z.string().refine((v) => isValidObjectId(v), { message: 'Invalid id' });

export const idParams = z.object({ id: objectId });

const optionalTrimmed = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

export const isoDate = z.coerce.date({ error: 'Invalid date' });

export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(PAGINATION.maxLimit).default(PAGINATION.defaultLimit),
  search: optionalTrimmed.pipe(z.string().max(100).optional()),
  from: isoDate.optional(),
  to: isoDate.optional(),
};

export const withDateOrder = <T extends z.ZodType<{ from?: Date; to?: Date }>>(schema: T) =>
  schema.refine((q) => !q.from || !q.to || q.from <= q.to, { message: '`from` must be before `to`', path: ['from'] });

export const phone = z
  .string()
  .trim()
  .min(7, 'Phone number is too short')
  .max(20, 'Phone number is too long')
  .regex(/^[+\d][\d\s\-()]{6,19}$/, 'Invalid phone number');

export const personName = z.string().trim().min(2, 'Name must be at least 2 characters').max(100);

export { optionalTrimmed };

export const paginationOnlySchema = {
  query: z.object({ page: paginationQuery.page, limit: paginationQuery.limit }),
};
