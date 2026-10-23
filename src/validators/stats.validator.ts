import { z } from 'zod';
import { isoDate } from './common.js';

export const overviewSchema = {
  query: z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      interval: z.enum(['day', 'week', 'month']).optional(),
    })
    .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '`from` must be before `to`', path: ['from'] }),
};

export type OverviewQuery = z.infer<typeof overviewSchema.query>;
