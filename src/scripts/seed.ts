/**
 * Seeds demo accounts for every role plus realistic Bangladeshi demo data.
 *   npm run seed               → admin, demo doctor + patient, 60 doctors (all with logins),
 *                                3,000 patient records, ~120 patient accounts with paid bookings
 *   npm run seed -- --accounts → only create/refresh the admin account
 *
 * Every person and hospital here is fictional.
 */
import { faker } from '@faker-js/faker';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { PATIENT_CONDITIONS, PATIENT_STATUSES, SPECIALIZATIONS } from '../config/constants.js';
import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { AppointmentModel } from '../models/appointment.model.js';
import { DoctorModel } from '../models/doctor.model.js';
import { PatientModel } from '../models/patient.model.js';
import { PaymentModel } from '../models/payment.model.js';
import { RefreshTokenModel } from '../models/refreshToken.model.js';
import { UserModel } from '../models/user.model.js';
import { slotTimesForDate, type Availability } from '../services/slot.service.js';
import { addDays, zonedDate, zonedToUtc } from '../utils/time.js';

const DOCTOR_COUNT = 60;
const PATIENT_COUNT = 3000;
const PATIENT_ACCOUNTS = 120;
const DAY = 24 * 60 * 60 * 1000;
const TZ = env.CLINIC_TIMEZONE;

// ── Bangladeshi names (English spelling) ───────────────────────────────────
const MALE_NAMES = [
  'Rafi', 'Tanvir', 'Sakib', 'Imran', 'Fahim', 'Arif', 'Nayeem', 'Rakib', 'Shahriar', 'Mahmud',
  'Hasan', 'Kamrul', 'Sohel', 'Rashed', 'Mehedi', 'Asif', 'Rezaul', 'Shafiq', 'Anisur', 'Mizanur',
  'Jubayer', 'Tahmid', 'Nafis', 'Ashraful', 'Habibur', 'Monir', 'Faisal', 'Sajid', 'Rubel', 'Shuvo',
];
const FEMALE_NAMES = [
  'Ayesha', 'Nusrat', 'Farzana', 'Sharmin', 'Tahmina', 'Nasrin', 'Sadia', 'Rumana', 'Taslima', 'Jannatul',
  'Sumaiya', 'Fatema', 'Mahmuda', 'Rokeya', 'Shirin', 'Nadia', 'Laila', 'Tania', 'Afroza', 'Sabina',
  'Nabila', 'Israt', 'Mithila', 'Tasnim', 'Rehana', 'Shamima', 'Lamia', 'Anika', 'Ishrat', 'Munira',
];
const SURNAMES = [
  'Rahman', 'Hossain', 'Ahmed', 'Islam', 'Chowdhury', 'Khan', 'Uddin', 'Alam', 'Akter', 'Begum',
  'Sarker', 'Talukder', 'Mia', 'Haque', 'Karim', 'Sultana', 'Siddique', 'Mahmud', 'Bhuiyan', 'Miah',
  'Das', 'Roy', 'Saha', 'Paul', 'Majumder', 'Biswas', 'Kabir', 'Molla', 'Sheikh', 'Hasan',
];

/** Fictional hospitals named after places in Bangladesh. */
const HOSPITALS = [
  'Dhanmondi Lakeview Hospital',
  'Gulshan Central Medical Center',
  'Mirpur Community Hospital',
  'Uttara Crescent Hospital',
  'Chattogram Bayside Medical Center',
  'Sylhet Tea Valley Hospital',
  'Rajshahi Padma Specialized Hospital',
  'Khulna Riverside Heart Center',
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

// Realistic roster mix: far more generalists than radiologists.
const SPECIALIZATION_WEIGHTS = SPECIALIZATIONS.map((value) => ({
  value,
  weight:
    { 'General Medicine': 14, Cardiology: 9, Pediatrics: 9, Orthopedics: 7, Neurology: 6, Dermatology: 5 }[
      value as string
    ] ?? 3,
}));

/** Chambers in Bangladesh: Sunday–Thursday working days, many with evening hours. */
const SCHEDULES: Availability[] = [
  { days: [0, 1, 2, 3, 4], start: '09:00', end: '17:00', slotMinutes: 30 },
  { days: [0, 2, 4], start: '10:00', end: '14:00', slotMinutes: 20 },
  { days: [0, 1, 3, 4, 6], start: '16:00', end: '21:00', slotMinutes: 30 },
  { days: [0, 1, 2, 3, 4, 6], start: '18:00', end: '22:00', slotMinutes: 15 },
];

const INTERESTS: Record<string, string[]> = {
  Cardiology: ['heart failure', 'hypertension', 'preventive cardiology'],
  Dermatology: ['acne and scarring', 'eczema', 'skin allergies'],
  Endocrinology: ['diabetes care', 'thyroid disorders', 'hormonal health'],
  Gastroenterology: ['liver disease', 'acid reflux', 'digestive health'],
  'General Medicine': ['family health', 'chronic disease management', 'preventive check-ups'],
  Neurology: ['migraine', 'epilepsy', 'stroke recovery'],
  Oncology: ['early cancer screening', 'chemotherapy care', 'survivorship'],
  Orthopedics: ['sports injuries', 'joint replacement', 'back pain'],
  Pediatrics: ['newborn care', 'childhood vaccination', 'child nutrition'],
  Psychiatry: ['anxiety and depression', 'sleep problems', 'stress management'],
  Pulmonology: ['asthma', 'COPD', 'sleep apnea'],
  Radiology: ['ultrasound', 'CT and MRI reporting', 'diagnostic imaging'],
};

const REASONS = [
  'Follow-up on blood pressure',
  'Persistent cough for two weeks',
  'Annual health check-up',
  'Knee pain after a fall',
  'Skin rash on both arms',
  'Recurring headaches',
  'Diabetes medication review',
  'Child has fever and cold',
  'Trouble sleeping',
  'Chest discomfort when climbing stairs',
  'Stomach pain after meals',
  'Dengue test results review',
];

const weighted = <T extends string>(weights: Record<T, number>) =>
  faker.helpers.weightedArrayElement(
    (Object.entries(weights) as [T, number][]).map(([value, weight]) => ({ value, weight })),
  );

/** Bangladeshi mobile number, e.g. "+880 1712-345678". */
const phoneNumber = () =>
  `+880 1${faker.helpers.arrayElement(['3', '5', '6', '7', '8', '9'])}${faker.string.numeric(2)}-${faker.string.numeric(6)}`;

type Gender = 'Male' | 'Female';
const personName = (gender: Gender) =>
  `${faker.helpers.arrayElement(gender === 'Male' ? MALE_NAMES : FEMALE_NAMES)} ${faker.helpers.arrayElement(SURNAMES)}`;
const emailSlug = (name: string) =>
  name.toLowerCase().replace(/^dr\.\s*/, '').replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');

/** Skews dates towards the present so the dashboard shows organic growth. */
const recentDate = (maxDaysAgo: number) =>
  new Date(Date.now() - Math.pow(Math.random(), 1.35) * maxDaysAgo * DAY - Math.random() * DAY);

const feeFor = (specialization: string) =>
  specialization === 'General Medicine'
    ? faker.helpers.arrayElement([500, 600, 700, 800])
    : faker.helpers.arrayElement([800, 1000, 1200, 1500, 1800, 2000]);

const bioFor = (specialization: string, hospital: string) =>
  `${specialization} consultant at ${hospital} with ${faker.number.int({ min: 5, max: 25 })} years of experience. ` +
  `Special interest in ${faker.helpers.arrayElement(INTERESTS[specialization] ?? ['patient care'])}.`;

async function seedAdmin() {
  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  const existing = await UserModel.findOne({ email }).select('+password');
  if (existing) {
    existing.set({ password: env.SEED_ADMIN_PASSWORD, role: 'admin', name: 'Admin User' });
    await existing.save();
  } else {
    await UserModel.create({ name: 'Admin User', email, password: env.SEED_ADMIN_PASSWORD, role: 'admin' });
  }
  console.log(`✔ Admin: ${email} / ${env.SEED_ADMIN_PASSWORD}`);
}

/** A bookable slot start `offsetDays` from today (negative = past), or null if the doctor isn't in. */
function slotOn(availability: Availability, offsetDays: number) {
  const date = addDays(zonedDate(new Date(), TZ), offsetDays);
  const times = slotTimesForDate(availability, date);
  if (times.length === 0) return null;
  return zonedToUtc(date, faker.helpers.arrayElement(times), TZ);
}

async function seedData() {
  faker.seed(42);
  await Promise.all([
    DoctorModel.deleteMany({}),
    PatientModel.deleteMany({}),
    AppointmentModel.deleteMany({}),
    PaymentModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
    UserModel.deleteMany({ role: { $in: ['doctor', 'patient'] } }),
  ]);

  // ── Doctors (the first one is the documented demo doctor) ──────────────────
  const usedEmails = new Set<string>();
  const doctors = Array.from({ length: DOCTOR_COUNT }, (_, i) => {
    const demo = i === 0;
    const gender: Gender = demo ? 'Female' : faker.helpers.arrayElement(['Male', 'Female']);
    const name = `Dr. ${demo ? 'Ayesha Rahman' : personName(gender)}`;
    const specialization = demo ? 'General Medicine' : faker.helpers.weightedArrayElement(SPECIALIZATION_WEIGHTS);
    const hospital = demo ? HOSPITALS[0]! : faker.helpers.arrayElement(HOSPITALS);
    const createdAt = demo ? new Date(Date.now() - 700 * DAY) : recentDate(900);
    let email = demo ? env.SEED_DOCTOR_EMAIL : `${emailSlug(name)}@doctortracker.dev`;
    if (usedEmails.has(email)) email = email.replace('@', `${i}@`);
    usedEmails.add(email);
    return {
      _id: new Types.ObjectId(),
      name,
      nameLower: name.toLowerCase(),
      specialization,
      hospital,
      phone: phoneNumber(),
      email,
      consultationFee: demo ? 800 : feeFor(specialization),
      bio: bioFor(specialization, hospital),
      availability: demo ? SCHEDULES[0]! : faker.helpers.arrayElement(SCHEDULES),
      createdAt,
      updatedAt: createdAt,
    };
  });

  // One bcrypt hash per shared demo password keeps seeding fast; each user still stores a real hash.
  const [doctorHash, patientHash] = await Promise.all([
    bcrypt.hash(env.SEED_DOCTOR_PASSWORD, 12),
    bcrypt.hash(env.SEED_PATIENT_PASSWORD, 12),
  ]);
  const doctorUsers = doctors.map((d) => ({
    _id: new Types.ObjectId(),
    name: d.name,
    email: d.email,
    password: doctorHash,
    role: 'doctor',
    doctor: d._id,
    tokenVersion: 0,
    createdAt: d.createdAt,
    updatedAt: d.createdAt,
  }));

  // Uneven popularity so "patients per doctor" is an interesting chart.
  const doctorWeights = doctors.map((d) => ({ value: d, weight: faker.number.int({ min: 1, max: 12 }) }));

  const patients: Record<string, unknown>[] = Array.from({ length: PATIENT_COUNT }, () => {
    const doctor = faker.helpers.weightedArrayElement(doctorWeights);
    const gender = faker.helpers.weightedArrayElement([
      { value: 'Male' as const, weight: 49 },
      { value: 'Female' as const, weight: 49 },
      { value: 'Other' as const, weight: 2 },
    ]);
    const name = personName(gender === 'Other' ? faker.helpers.arrayElement(['Male', 'Female']) : gender);
    const admissionDate = new Date(Math.max(recentDate(730).getTime(), doctor.createdAt.getTime()));
    return {
      name,
      nameLower: name.toLowerCase(),
      age: faker.number.int({ min: 1, max: 92 }),
      gender,
      phone: phoneNumber(),
      email: faker.datatype.boolean(0.8)
        ? `${emailSlug(name)}${faker.number.int({ min: 1, max: 999 })}@${faker.helpers.arrayElement(['gmail.com', 'yahoo.com', 'outlook.com'])}`
        : undefined,
      condition: weighted(CONDITION_WEIGHTS),
      status: weighted(STATUS_WEIGHTS),
      admissionDate,
      notes: faker.datatype.boolean(0.4) ? faker.helpers.arrayElement(REASONS) : undefined,
      doctor: doctor._id,
      createdAt: admissionDate,
      updatedAt: admissionDate,
    };
  });

  // ── Patient accounts with online bookings (the first is the demo patient) ──
  const patientUsers = Array.from({ length: PATIENT_ACCOUNTS }, (_, i) => {
    const demo = i === 0;
    const gender: Gender = demo ? 'Male' : faker.helpers.arrayElement(['Male', 'Female']);
    const name = demo ? 'Rafi Ahmed' : personName(gender);
    const createdAt = new Date(Date.now() - faker.number.int({ min: 35, max: 200 }) * DAY);
    return {
      _id: new Types.ObjectId(),
      name,
      email: demo ? env.SEED_PATIENT_EMAIL : `${emailSlug(name)}.${i}@example.com`,
      password: patientHash,
      role: 'patient',
      phone: phoneNumber(),
      age: demo ? 34 : faker.number.int({ min: 4, max: 85 }),
      gender,
      tokenVersion: 0,
      createdAt,
      updatedAt: createdAt,
    };
  });

  const appointments: Record<string, unknown>[] = [];
  const payments: Record<string, unknown>[] = [];
  const linkedRecords = new Map<string, Types.ObjectId>(); // `${user}:${doctor}` → patient record
  const taken = new Set<string>();

  const book = (
    user: (typeof patientUsers)[number],
    doctor: (typeof doctors)[number],
    offsetDays: number,
    status: 'completed' | 'confirmed' | 'cancelled',
  ) => {
    const start = slotOn(doctor.availability, offsetDays);
    if (!start || start <= doctor.createdAt) return false;
    if (status === 'confirmed' && start <= new Date()) return false;
    if (status === 'completed' && start > new Date()) return false;
    const key = `${doctor._id}:${start.getTime()}`;
    if (taken.has(key)) return false;
    taken.add(key);

    const bookedAt = new Date(Math.min(start.getTime() - faker.number.int({ min: 1, max: 6 }) * DAY, Date.now() - 3600_000));
    const recordKey = `${user._id}:${doctor._id}`;
    let record = linkedRecords.get(recordKey);
    if (!record && status !== 'cancelled') {
      record = new Types.ObjectId();
      linkedRecords.set(recordKey, record);
      patients.push({
        _id: record,
        name: user.name,
        nameLower: user.name.toLowerCase(),
        age: user.age,
        gender: user.gender,
        phone: user.phone,
        email: user.email,
        condition: weighted(CONDITION_WEIGHTS),
        status: status === 'completed' ? faker.helpers.arrayElement(['Recovered', 'Active']) : 'Active',
        admissionDate: start,
        notes: 'Online booking',
        doctor: doctor._id,
        user: user._id,
        createdAt: bookedAt,
        updatedAt: bookedAt,
      });
    }

    const appointmentId = new Types.ObjectId();
    const paymentId = new Types.ObjectId();
    const method = faker.helpers.arrayElement(['card', 'bkash', 'nagad'] as const);
    const last4 = faker.string.numeric(4);
    payments.push({
      _id: paymentId,
      appointment: appointmentId,
      patientUser: user._id,
      doctor: doctor._id,
      amount: doctor.consultationFee,
      currency: 'BDT',
      method,
      instrument: method === 'card' ? `Visa •••• ${last4}` : `${method === 'bkash' ? 'bKash' : 'Nagad'} •••• ${last4}`,
      status: status === 'cancelled' ? 'refunded' : 'paid',
      transactionId: `TXN-SEED-${appointmentId.toHexString().slice(-10).toUpperCase()}`,
      paidAt: bookedAt,
      refundedAt: status === 'cancelled' ? new Date(bookedAt.getTime() + 3600_000) : undefined,
      createdAt: bookedAt,
      updatedAt: bookedAt,
    });
    appointments.push({
      _id: appointmentId,
      doctor: doctor._id,
      patientUser: user._id,
      patient: record,
      start,
      end: new Date(start.getTime() + doctor.availability.slotMinutes * 60_000),
      reason: faker.helpers.arrayElement(REASONS),
      fee: doctor.consultationFee,
      status,
      holdsSlot: status === 'confirmed',
      payment: paymentId,
      cancelledBy: status === 'cancelled' ? 'patient' : undefined,
      statusChangedAt: bookedAt,
      createdAt: bookedAt,
      updatedAt: bookedAt,
    });
    return true;
  };

  // Demo patient: a past visit and an upcoming one with the demo doctor, plus a cancelled booking.
  const demoPatient = patientUsers[0]!;
  const demoDoctor = doctors[0]!;
  [-7, -8, -9, -10, -11].some((offset) => book(demoPatient, demoDoctor, offset, 'completed'));
  [2, 3, 4, 5, 6].some((offset) => book(demoPatient, demoDoctor, offset, 'confirmed'));
  [-3, -4, -5, -6].some((offset) => book(demoPatient, doctors[5]!, offset, 'cancelled'));

  // Everyone else: recent history and a busy upcoming fortnight (the demo doctor gets extra).
  for (const user of patientUsers.slice(1)) {
    for (let n = faker.number.int({ min: 1, max: 3 }); n > 0; n--) {
      const doctor = faker.datatype.boolean(0.2) ? demoDoctor : faker.helpers.weightedArrayElement(doctorWeights);
      const offset = faker.number.int({ min: -30, max: 13 });
      const status =
        offset < 0
          ? faker.datatype.boolean(0.85) ? 'completed' : 'cancelled'
          : faker.datatype.boolean(0.9) ? 'confirmed' : 'cancelled';
      book(user, doctor, offset, status);
    }
  }

  // Raw driver inserts keep the generated timestamps intact and are much faster.
  const insert = async (model: { collection: { insertMany: (docs: any[], opts: object) => Promise<unknown> } }, docs: object[]) => {
    for (let i = 0; i < docs.length; i += 1000) await model.collection.insertMany(docs.slice(i, i + 1000), { ignoreUndefined: true });
  };
  await insert(DoctorModel, doctors);
  await insert(UserModel, [...doctorUsers, ...patientUsers]);
  await insert(PatientModel, patients);
  await insert(AppointmentModel, appointments);
  await insert(PaymentModel, payments);

  console.log(`✔ ${doctors.length} doctors (all can sign in), ${patients.length} patient records`);
  console.log(`✔ ${patientUsers.length} patient accounts, ${appointments.length} appointments, ${payments.length} payments`);
  console.log(`✔ Demo doctor:  ${env.SEED_DOCTOR_EMAIL} / ${env.SEED_DOCTOR_PASSWORD}`);
  console.log(`✔ Demo patient: ${env.SEED_PATIENT_EMAIL} / ${env.SEED_PATIENT_PASSWORD}`);
}

async function main() {
  await connectDB();
  await Promise.all(
    [UserModel, DoctorModel, PatientModel, AppointmentModel, PaymentModel, RefreshTokenModel].map((m) => m.syncIndexes()),
  );
  await seedAdmin();
  if (!process.argv.includes('--accounts')) await seedData();
  await disconnectDB();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDB();
  process.exit(1);
});
