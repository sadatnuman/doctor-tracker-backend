import { z } from 'zod';
import { APPOINTMENT_STATUSES, SLOT_LENGTHS } from '../config/constants.js';
import { idParams, isoDate, objectId, paginationQuery } from './common.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour)');
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const bookAppointmentSchema = {
  body: z.object({
    doctorId: objectId,
    start: z.iso.datetime({ offset: true, message: 'Pick a time slot' }).transform((v) => new Date(v)),
    reason: z.string().trim().min(3, 'Tell the doctor briefly why you’re coming').max(500),
  }),
};

const csvStatuses = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
  .pipe(z.array(z.enum(APPOINTMENT_STATUSES)).optional());

export const listAppointmentsSchema = {
  query: z.object({
    page: paginationQuery.page,
    limit: paginationQuery.limit,
    status: csvStatuses,
    doctor: objectId.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    when: z.enum(['upcoming', 'past', 'all']).default('all'),
  }),
};

const cardPayment = z.object({
  method: z.literal('card'),
  cardholder: z.string().trim().min(2, 'Enter the name on the card').max(60),
  cardNumber: z
    .string()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\d{12,19}$/, 'Enter a valid card number')),
  expiry: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'Use MM/YY'),
  cvc: z.string().regex(/^\d{3,4}$/, 'Enter the 3–4 digit code'),
});

const walletPayment = z.object({
  method: z.enum(['bkash', 'nagad']),
  walletNumber: z
    .string()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^01[3-9]\d{8}$/, 'Enter an 11-digit mobile number, e.g. 017XXXXXXXX')),
  pin: z.string().regex(/^\d{4,6}$/, 'Enter your 4–6 digit PIN'),
});

export const payAppointmentSchema = {
  params: idParams,
  body: z.discriminatedUnion('method', [cardPayment, walletPayment]),
};

export const cancelAppointmentSchema = {
  params: idParams,
  body: z.object({ reason: z.string().trim().max(300).optional() }),
};

export const appointmentIdSchema = { params: idParams };

export const slotsSchema = {
  params: idParams,
  query: z.object({
    from: calendarDate.optional(),
    days: z.coerce.number().int().min(1).max(14).default(7),
  }),
};

export const availabilitySchema = {
  body: z
    .object({
      days: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day').max(7),
      start: hhmm,
      end: hhmm,
      slotMinutes: z.coerce
        .number()
        .refine((n) => (SLOT_LENGTHS as readonly number[]).includes(n), 'Choose 15, 20, 30, 45 or 60 minutes')
        .transform((n) => n as (typeof SLOT_LENGTHS)[number]),
    })
    .refine((a) => toMin(a.end) - toMin(a.start) >= a.slotMinutes, {
      message: 'End time must leave room for at least one slot',
      path: ['end'],
    })
    .transform((a) => ({ ...a, days: [...new Set(a.days)].sort() })),
};

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema.body>;
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsSchema.query>;
export type PayAppointmentInput = z.infer<typeof payAppointmentSchema.body>;
export type AvailabilityInput = z.infer<typeof availabilitySchema.body>;
