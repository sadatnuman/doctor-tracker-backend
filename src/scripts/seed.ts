/**
 * Seeds an admin account plus realistic demo data.
 *   npm run seed               → admin + 60 doctors + 3,000 patients (replaces existing doctors/patients)
 *   npm run seed -- --admin    → only create/refresh the admin account
 */
import { faker } from '@faker-js/faker';
import { Types } from 'mongoose';
import { GENDERS, PATIENT_CONDITIONS, PATIENT_STATUSES, SPECIALIZATIONS } from '../config/constants.js';
import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { DoctorModel } from '../models/doctor.model.js';
import { PatientModel } from '../models/patient.model.js';
import { UserModel } from '../models/user.model.js';

const DOCTOR_COUNT = 60;
const PATIENT_COUNT = 3000;
const DAY = 24 * 60 * 60 * 1000;

const HOSPITALS = [
  'Riverside General Hospital',
  'Northgate Medical Center',
  'Lakeview Community Hospital',
  'Summit Health Institute',
  'Greenfield Children’s Hospital',
  'Harborview Specialty Clinic',
  'Oakwood Regional Hospital',
  'Meadowbrook Heart Center',
];

const CONDITION_WEIGHTS: Record<(typeof PATIENT_CONDITIONS)[number], number> = {
  Hypertension: 18,
  Diabetes: 16,
  Asthma: 10,
  Cardiac: 9,
  Fracture: 8,
  Infection: 14,
  Migraine: 7,
  Arthritis: 8,
  Other: 10,
};
const STATUS_WEIGHTS: Record<(typeof PATIENT_STATUSES)[number], number> = {
  Active: 40,
  Recovered: 30,
  Discharged: 22,
  Critical: 8,
};

const weighted = <T extends string>(weights: Record<T, number>) =>
  faker.helpers.weightedArrayElement(
    (Object.entries(weights) as [T, number][]).map(([value, weight]) => ({ value, weight })),
  );

/** Readable, valid-looking numbers, e.g. "+1 415-555-0192". */
const phoneNumber = () =>
  `+1 ${faker.number.int({ min: 201, max: 989 })}-${faker.string.numeric(3)}-${faker.string.numeric(4)}`;

// Realistic roster mix: far more generalists than radiologists.
const SPECIALIZATION_WEIGHTS = SPECIALIZATIONS.map((value) => ({
  value,
  weight: { 'General Medicine': 14, Cardiology: 9, Pediatrics: 9, Orthopedics: 7, Neurology: 6, Dermatology: 5 }[value as string] ?? 3,
}));

/** Skews dates towards the present so the dashboard shows organic growth. */
const recentDate = (maxDaysAgo: number) =>
  new Date(Date.now() - Math.pow(Math.random(), 1.35) * maxDaysAgo * DAY - Math.random() * DAY);

async function seedAdmin() {
  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  const existing = await UserModel.findOne({ email }).select('+password');
  if (existing) {
    existing.password = env.SEED_ADMIN_PASSWORD;
    await existing.save();
  } else {
    await UserModel.create({ name: 'Admin User', email, password: env.SEED_ADMIN_PASSWORD, role: 'admin' });
  }
  console.log(`✔ Admin ready: ${email}`);
}

async function seedData() {
  faker.seed(42);
  await Promise.all([DoctorModel.deleteMany({}), PatientModel.deleteMany({})]);

  const doctors = Array.from({ length: DOCTOR_COUNT }, (_, i) => {
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    const name = `Dr. ${first} ${last}`;
    const createdAt = recentDate(900);
    return {
      _id: new Types.ObjectId(),
      name,
      nameLower: name.toLowerCase(),
      specialization: faker.helpers.weightedArrayElement(SPECIALIZATION_WEIGHTS),
      hospital: faker.helpers.arrayElement(HOSPITALS),
      phone: phoneNumber(),
      email: `${first}.${last}.${i}@doctortracker.dev`.toLowerCase().replace(/[^a-z0-9.@]/g, ''),
      createdAt,
      updatedAt: createdAt,
    };
  });

  // Uneven popularity so "patients per doctor" is an interesting chart.
  const doctorWeights = doctors.map((d) => ({ value: d, weight: faker.number.int({ min: 1, max: 12 }) }));

  const patients = Array.from({ length: PATIENT_COUNT }, () => {
    const doctor = faker.helpers.weightedArrayElement(doctorWeights);
    const gender = faker.helpers.weightedArrayElement([
      { value: GENDERS[0], weight: 48 },
      { value: GENDERS[1], weight: 49 },
      { value: GENDERS[2], weight: 3 },
    ]);
    const sex = gender === 'Male' ? 'male' : gender === 'Female' ? 'female' : undefined;
    const first = faker.person.firstName(sex);
    const last = faker.person.lastName();
    const name = `${first} ${last}`;
    const admissionDate = new Date(Math.max(recentDate(730).getTime(), doctor.createdAt.getTime()));
    return {
      name,
      nameLower: name.toLowerCase(),
      age: faker.number.int({ min: 1, max: 92 }),
      gender,
      phone: phoneNumber(),
      email: faker.datatype.boolean(0.8) ? faker.internet.email({ firstName: first, lastName: last }).toLowerCase() : undefined,
      condition: weighted(CONDITION_WEIGHTS),
      status: weighted(STATUS_WEIGHTS),
      admissionDate,
      notes: faker.datatype.boolean(0.4) ? faker.lorem.sentence() : undefined,
      doctor: doctor._id,
      createdAt: admissionDate,
      updatedAt: admissionDate,
    };
  });

  // Raw driver inserts keep the generated timestamps intact and are much faster.
  await DoctorModel.collection.insertMany(doctors);
  for (let i = 0; i < patients.length; i += 1000) {
    await PatientModel.collection.insertMany(patients.slice(i, i + 1000), { ignoreUndefined: true });
  }
  console.log(`✔ Inserted ${doctors.length} doctors and ${patients.length} patients`);
}

async function main() {
  await connectDB();
  await Promise.all([UserModel.syncIndexes(), DoctorModel.syncIndexes(), PatientModel.syncIndexes()]);
  await seedAdmin();
  if (!process.argv.includes('--admin')) await seedData();
  await disconnectDB();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDB();
  process.exit(1);
});
