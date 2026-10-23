export const ROLES = ['admin', 'doctor', 'patient'] as const;
export type Role = (typeof ROLES)[number];

/** Short-lived JWT (sent on every request) and opaque rotating refresh token. */
export const ACCESS_COOKIE = 'dt_access';
export const REFRESH_COOKIE = 'dt_refresh';

/**
 * pending_payment → (paid within the hold) → confirmed → completed
 *                 ↘ (hold runs out) expired       ↘ cancelled (refunded)
 */
export const APPOINTMENT_STATUSES = ['pending_payment', 'confirmed', 'completed', 'cancelled', 'expired'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['card', 'bkash', 'nagad'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_STATUSES = ['paid', 'failed', 'refunded'] as const;

/** Booking window patients can see and book into. */
export const BOOKING_WINDOW_DAYS = 30;
export const SLOT_LENGTHS = [15, 20, 30, 45, 60] as const;
export const CURRENCY = 'BDT';

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
