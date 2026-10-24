import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** Access-token lifetime (jsonwebtoken format, e.g. 15m). Kept short: it can't be revoked. */
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  /** Refresh-token lifetime in days. Refresh tokens are stored hashed and rotated on use. */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  CLIENT_ORIGIN: z.string().default('http://localhost:3000'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Timezone doctors' weekly schedules are written in (no DST in the default). */
  CLINIC_TIMEZONE: z.string().default('Asia/Dhaka'),
  /** How long a booked slot is held while the patient pays. Unpaid holds release the slot. */
  PAYMENT_HOLD_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
  SEED_ADMIN_EMAIL: z.email().default('admin@doctortracker.com'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin@12345'),
  SEED_DOCTOR_EMAIL: z.email().default('doctor@doctortracker.com'),
  SEED_DOCTOR_PASSWORD: z.string().min(8).default('Doctor@12345'),
  SEED_PATIENT_EMAIL: z.email().default('patient@doctortracker.com'),
  SEED_PATIENT_PASSWORD: z.string().min(8).default('Patient@12345'),
}).refine((e) => e.NODE_ENV !== 'production' || !e.JWT_SECRET.startsWith('change-me'), {
  // A copied .env.example secret would let anyone mint valid tokens.
  path: ['JWT_SECRET'],
  message: 'JWT_SECRET is still the .env.example placeholder; generate a real secret for production',
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  allowedOrigins: parsed.data.CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
};
