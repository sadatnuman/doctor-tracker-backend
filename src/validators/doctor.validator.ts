import { z } from 'zod';
import { idParams, optionalTrimmed, paginationQuery, personName, phone, withDateOrder } from './common.js';

const doctorBody = z.object({
  name: personName,
  specialization: z.string().trim().min(2, 'Specialization is required').max(80),
  hospital: z.string().trim().min(2, 'Hospital is required').max(120),
  phone,
  email: z.email('Enter a valid email').trim().toLowerCase().max(120),
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

export const createDoctorSchema = { body: doctorBody };
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
export type CreateDoctorInput = z.infer<typeof doctorBody>;
export type UpdateDoctorInput = Partial<CreateDoctorInput>;
