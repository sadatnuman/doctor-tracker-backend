export const AUTH_COOKIE = 'dt_token';

export const PATIENT_CONDITIONS = [
  'Hypertension',
  'Diabetes',
  'Asthma',
  'Cardiac',
  'Fracture',
  'Infection',
  'Migraine',
  'Arthritis',
  'Other',
] as const;

export const PATIENT_STATUSES = ['Active', 'Critical', 'Recovered', 'Discharged'] as const;

export const GENDERS = ['Male', 'Female', 'Other'] as const;

export const SPECIALIZATIONS = [
  'Cardiology',
  'Dermatology',
  'Endocrinology',
  'Gastroenterology',
  'General Medicine',
  'Neurology',
  'Oncology',
  'Orthopedics',
  'Pediatrics',
  'Psychiatry',
  'Pulmonology',
  'Radiology',
] as const;

export const PAGINATION = { defaultLimit: 10, maxLimit: 100 } as const;

export type PatientCondition = (typeof PATIENT_CONDITIONS)[number];
export type PatientStatus = (typeof PATIENT_STATUSES)[number];
export type Gender = (typeof GENDERS)[number];
