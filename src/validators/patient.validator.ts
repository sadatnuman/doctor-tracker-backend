import { z } from 'zod';
import { GENDERS, PATIENT_CONDITIONS, PATIENT_STATUSES } from '../config/constants.js';
import { idParams, isoDate, objectId, paginationQuery, personName, phone, withDateOrder } from './common.js';

const patientFields = z.object({
  name: personName,
  age: z.coerce.number().int('Age must be a whole number').min(0).max(130),
  gender: z.enum(GENDERS),
  phone,
  email: z
    .union([z.email('Enter a valid email').trim().toLowerCase().max(120), z.literal('')])
    .optional()
    .transform((v) => v || undefined),
  condition: z.enum(PATIENT_CONDITIONS),
  // No `.default()` here: Zod 4 applies defaults even inside `.partial()`, which would
  // silently reset the status on every PATCH. The create schemas add it instead.
  status: z.enum(PATIENT_STATUSES),
  admissionDate: isoDate.refine((d) => d <= new Date(Date.now() + 24 * 3600 * 1000), {
    message: 'Admission date cannot be in the future',
  }),
  notes: z.string().trim().max(1000).optional(),
});

export const PATIENT_SORTS = [
  'admissionDate',
  '-admissionDate',
  'createdAt',
  '-createdAt',
  'name',
  '-name',
  'age',
  '-age',
] as const;

/** Comma-separated multi-value filter, e.g. `condition=Asthma,Diabetes`. */
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).optional());

const patientFilters = {
  ...paginationQuery,
  condition: csvEnum(PATIENT_CONDITIONS),
  status: csvEnum(PATIENT_STATUSES),
  gender: z.enum(GENDERS).optional(),
  ageMin: z.coerce.number().int().min(0).max(130).optional(),
  ageMax: z.coerce.number().int().min(0).max(130).optional(),
  sort: z.enum(PATIENT_SORTS).default('-admissionDate'),
};

export const listPatientsSchema = {
  query: withDateOrder(z.object({ ...patientFilters, doctor: objectId.optional() })),
};

export const listDoctorPatientsSchema = {
  params: idParams,
  query: withDateOrder(z.object(patientFilters)),
};

const createFields = patientFields.extend({ status: z.enum(PATIENT_STATUSES).default('Active') });

export const createPatientSchema = { body: createFields.extend({ doctor: objectId }) };
export const createDoctorPatientSchema = { params: idParams, body: createFields };

export const updatePatientSchema = {
  params: idParams,
  body: patientFields
    .extend({ doctor: objectId })
    .partial()
    .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' }),
};

export const patientIdSchema = { params: idParams };
export const doctorPatientParams = { params: z.object({ id: objectId, patientId: objectId }) };

export type ListPatientsQuery = z.infer<typeof listPatientsSchema.query>;
export type CreatePatientInput = z.infer<typeof createPatientSchema.body>;
export type UpdatePatientInput = z.infer<typeof updatePatientSchema.body>;
