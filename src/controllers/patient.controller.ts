import type { Request, Response } from 'express';
import * as patientService from '../services/patient.service.js';
import { ApiError } from '../utils/ApiError.js';

export async function list(req: Request, res: Response) {
  res.json(await patientService.listPatients(req.validated.query));
}

export async function getOne(req: Request, res: Response) {
  res.json({ data: await patientService.getPatient(req.validated.params.id, patientService.ownerScope(req.user)) });
}

export async function create(req: Request, res: Response) {
  const patient = await patientService.createPatient(req.validated.body);
  res.status(201).location(`/api/patients/${patient.id}`).json({ data: patient });
}

export async function update(req: Request, res: Response) {
  // Only admins can move a patient to another doctor.
  if (req.user?.role === 'doctor' && req.validated.body.doctor && req.validated.body.doctor !== req.user.doctorId) {
    throw ApiError.forbidden('Only an administrator can reassign a patient to another doctor');
  }
  res.json({
    data: await patientService.updatePatient(req.validated.params.id, req.validated.body, patientService.ownerScope(req.user)),
  });
}

export async function remove(req: Request, res: Response) {
  res.json({ data: await patientService.deletePatient(req.validated.params.id) });
}
