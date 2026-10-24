import express, { Router } from 'express';
import mongoose from 'mongoose';
import * as appointments from '../controllers/appointment.controller.js';
import * as auth from '../controllers/auth.controller.js';
import * as doctors from '../controllers/doctor.controller.js';
import * as insights from '../controllers/insights.controller.js';
import * as patients from '../controllers/patient.controller.js';
import * as publicApi from '../controllers/public.controller.js';
import { authenticate, requireDoctorScope, requireRole } from '../middlewares/auth.js';
import { authLimiter, bookingLimiter, loginLimiter } from '../middlewares/security.js';
import { validate } from '../middlewares/validate.js';
import {
  appointmentIdSchema,
  availabilitySchema,
  bookAppointmentSchema,
  cancelAppointmentSchema,
  listAppointmentsSchema,
  payAppointmentSchema,
  slotsSchema,
} from '../validators/appointment.validator.js';
import {
  changePasswordSchema,
  doctorAccountSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '../validators/auth.validator.js';
import { paginationOnlySchema } from '../validators/common.js';
import {
  createDoctorSchema,
  deleteDoctorSchema,
  doctorIdSchema,
  listDoctorsSchema,
  listPublicDoctorsSchema,
  updateDoctorSchema,
} from '../validators/doctor.validator.js';
import {
  createDoctorPatientSchema,
  createPatientSchema,
  doctorPatientParams,
  listDoctorPatientsSchema,
  listPatientsSchema,
  patientIdSchema,
  updatePatientSchema,
} from '../validators/patient.validator.js';
import { overviewSchema } from '../validators/stats.validator.js';

/**
 * Route table. Access is declared next to each route:
 *   public            – anyone
 *   signedIn          – any role
 *   admin / doctor / patient – that role only
 *   requireDoctorScope – admin, or the doctor who owns `:id`
 */
export const router = Router();

const signedIn = authenticate;
const admin = [authenticate, requireRole('admin')];
const doctor = [authenticate, requireRole('doctor')];
const patient = [authenticate, requireRole('patient')];
const adminOrOwningDoctor = [authenticate, requireRole('admin', 'doctor'), requireDoctorScope('id')];

// ── Public ────────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'up' : 'down', uptime: process.uptime() });
});
router.get('/public/doctors', validate(listPublicDoctorsSchema), publicApi.doctors);
router.get('/public/doctors/:id', validate(doctorIdSchema), publicApi.doctor);
router.get('/public/doctors/:id/slots', validate(slotsSchema), publicApi.slots);
router.get('/meta/filters', insights.filters);

// ── Auth (one login for every role) ───────────────────────────────────────
router.post('/auth/login', loginLimiter, validate(loginSchema), auth.login);
router.post('/auth/register', authLimiter, validate(registerSchema), auth.register);
router.post('/auth/refresh', authLimiter, auth.refresh);
router.post('/auth/logout', auth.logout);
router.post('/auth/logout-all', signedIn, auth.logoutAll);
router.get('/auth/me', signedIn, auth.me);
router.patch('/auth/me', signedIn, validate(updateProfileSchema), auth.updateProfile);
// Profile picture: raw image body, size-capped before it reaches the handler.
router.put(
  '/auth/me/avatar',
  signedIn,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '300kb' }),
  auth.uploadAvatar,
);
router.delete('/auth/me/avatar', signedIn, auth.deleteAvatar);
router.get('/avatars/:id', validate(doctorIdSchema), auth.getAvatar);
router.post('/auth/change-password', signedIn, loginLimiter, validate(changePasswordSchema), auth.changePassword);

// ── Appointments & payments (rows are scoped to the caller's role) ────────
router.get('/appointments', signedIn, validate(listAppointmentsSchema), appointments.list);
router.post('/appointments', ...patient, bookingLimiter, validate(bookAppointmentSchema), appointments.book);
router.get('/appointments/:id', signedIn, validate(appointmentIdSchema), appointments.getOne);
router.post('/appointments/:id/pay', ...patient, validate(payAppointmentSchema), appointments.pay);
router.post('/appointments/:id/cancel', signedIn, validate(cancelAppointmentSchema), appointments.cancel);
router.post('/appointments/:id/complete', authenticate, requireRole('admin', 'doctor'), validate(appointmentIdSchema), appointments.complete);
router.get('/payments', signedIn, validate(paginationOnlySchema), appointments.payments);

// ── Doctor's own workspace ────────────────────────────────────────────────
router.get('/me/doctor', ...doctor, doctors.getMine);
router.get('/me/doctor/overview', ...doctor, appointments.doctorOverview);
router.put('/me/doctor/availability', ...doctor, validate(availabilitySchema), doctors.updateMyAvailability);

// ── Doctor-scoped patient lists: admin, or the doctor who owns :id ────────
router.get('/doctors/:id/patients', ...adminOrOwningDoctor, validate(listDoctorPatientsSchema), doctors.listPatients);
router.post('/doctors/:id/patients', ...adminOrOwningDoctor, validate(createDoctorPatientSchema), doctors.addPatient);
router.delete('/doctors/:id/patients/:patientId', ...adminOrOwningDoctor, validate(doctorPatientParams), doctors.removePatient);
// Editing a record: admin any; a doctor only their own (enforced in the service).
router.get('/patients/:id', authenticate, requireRole('admin', 'doctor'), validate(patientIdSchema), patients.getOne);
router.patch('/patients/:id', authenticate, requireRole('admin', 'doctor'), validate(updatePatientSchema), patients.update);

// ── Administration ────────────────────────────────────────────────────────
router.get('/doctors', ...admin, validate(listDoctorsSchema), doctors.list);
router.post('/doctors', ...admin, validate(createDoctorSchema), doctors.create);
router.get('/doctors/:id', ...admin, validate(doctorIdSchema), doctors.getOne);
router.patch('/doctors/:id', ...admin, validate(updateDoctorSchema), doctors.update);
router.delete('/doctors/:id', ...admin, validate(deleteDoctorSchema), doctors.remove);
router.put('/doctors/:id/account', ...admin, validate({ ...doctorIdSchema, ...doctorAccountSchema }), doctors.setAccount);
router.get('/patients', ...admin, validate(listPatientsSchema), patients.list);
router.post('/patients', ...admin, validate(createPatientSchema), patients.create);
router.delete('/patients/:id', ...admin, validate(patientIdSchema), patients.remove);
router.get('/stats/overview', ...admin, validate(overviewSchema), insights.overview);
