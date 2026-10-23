import { Router } from 'express';
import mongoose from 'mongoose';
import * as auth from '../controllers/auth.controller.js';
import * as doctors from '../controllers/doctor.controller.js';
import * as insights from '../controllers/insights.controller.js';
import * as patients from '../controllers/patient.controller.js';
import { authenticate, requireRole } from '../middlewares/auth.js';
import { loginLimiter } from '../middlewares/security.js';
import { validate } from '../middlewares/validate.js';
import { loginSchema } from '../validators/auth.validator.js';
import {
  createDoctorSchema,
  deleteDoctorSchema,
  doctorIdSchema,
  listDoctorsSchema,
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

export const router = Router();

// ── Public ────────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'up' : 'down', uptime: process.uptime() });
});
router.post('/auth/login', loginLimiter, validate(loginSchema), auth.login);
router.post('/auth/logout', auth.logout);

// ── Everything below requires an authenticated admin ──────────────────────
router.use(authenticate, requireRole('admin'));

router.get('/auth/me', auth.me);

router
  .route('/doctors')
  .get(validate(listDoctorsSchema), doctors.list)
  .post(validate(createDoctorSchema), doctors.create);
router
  .route('/doctors/:id')
  .get(validate(doctorIdSchema), doctors.getOne)
  .patch(validate(updateDoctorSchema), doctors.update)
  .delete(validate(deleteDoctorSchema), doctors.remove);
router
  .route('/doctors/:id/patients')
  .get(validate(listDoctorPatientsSchema), doctors.listPatients)
  .post(validate(createDoctorPatientSchema), doctors.addPatient);
router.delete('/doctors/:id/patients/:patientId', validate(doctorPatientParams), doctors.removePatient);

router
  .route('/patients')
  .get(validate(listPatientsSchema), patients.list)
  .post(validate(createPatientSchema), patients.create);
router
  .route('/patients/:id')
  .get(validate(patientIdSchema), patients.getOne)
  .patch(validate(updatePatientSchema), patients.update)
  .delete(validate(patientIdSchema), patients.remove);

router.get('/stats/overview', validate(overviewSchema), insights.overview);
router.get('/meta/filters', insights.filters);
