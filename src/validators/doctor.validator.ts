import { z } from 'zod';
import { availabilitySchema } from './appointment.validator.js';
import { strongPassword } from './auth.validator.js';
import { idParams, optionalTrimmed, paginationQuery, personName, phone, withDateOrder } from './common.js';

// No `.default()`s here: Zod 4 applies defaults inside `.partial()`, which would
// overwrite fields on every PATCH. The model supplies defaults on create instead.
const doctorBody = z.object({
  name: personName,
  specialization: z.string().trim().min(2, 'Specialization is required').max(80),
  hospital: z.string().trim().min(2, 'Hospital is required').max(120),
  phone,
  email: z.email('Enter a valid email').trim().toLowerCase().max(120),
  consultationFee: z.coerce.number().int('Use a whole amount').min(0).max(100_000).optional(),
  bio: z.string().trim().max(600).optional(),
  availability: availabilitySchema.body.optional(),
});

export const DOCTOR_SORTS = ['createdAt', '-createdAt', 'name', '-name', 'specialization', '-specialization', 'hospital', '-hospital'] as const;

export const listDoctorsSchema = {
  query: withDateOrder(
    z.object({
      ...paginationQuery,
      specialization: optionalTrimmed,
      hospital: optionalTrimmed,
      sort: z.enum(DOCTOR_SORTS).default('-createdAt'),
    }),
  ),
};

/** Public directory: no contact details, no date filters, name search only. */
export const listPublicDoctorsSchema = {
  query: z.object({
    page: paginationQuery.page,
    limit: z.coerce.number().int().min(1).max(48).default(12),
    search: paginationQuery.search,
    specialization: optionalTrimmed,
    hospital: optionalTrimmed,
    sort: z.enum(['name', 'consultationFee', '-consultationFee']).default('name'),
  }),
};

/** Optional `password` also creates the doctor's login in the same request. */
export const createDoctorSchema = { body: doctorBody.extend({ password: strongPassword.optional() }) };
export const updateDoctorSchema = {
  params: idParams,
  body: doctorBody.partial().refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' }),
};
export const doctorIdSchema = { params: idParams };
export const deleteDoctorSchema = {
  params: idParams,
  query: z.object({ cascade: z.enum(['true', 'false']).default('false').transform((v) => v === 'true') }),
};

export type ListDoctorsQuery = z.infer<typeof listDoctorsSchema.query>;
export type ListPublicDoctorsQuery = z.infer<typeof listPublicDoctorsSchema.query>;
export type CreateDoctorInput = z.infer<typeof createDoctorSchema.body>;
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema.body>;
