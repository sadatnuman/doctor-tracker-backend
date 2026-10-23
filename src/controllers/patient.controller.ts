import type { Request, Response } from 'express';
import * as patientService from '../services/patient.service.js';

export async function list(req: Request, res: Response) {
  res.json(await patientService.listPatients(req.validated.query));
}

export async function getOne(req: Request, res: Response) {
  res.json({ data: await patientService.getPatient(req.validated.params.id) });
}

export async function create(req: Request, res: Response) {
  const patient = await patientService.createPatient(req.validated.body);
  res.status(201).location(`/api/patients/${patient.id}`).json({ data: patient });
}

export async function update(req: Request, res: Response) {
  res.json({ data: await patientService.updatePatient(req.validated.params.id, req.validated.body) });
}

export async function remove(req: Request, res: Response) {
  res.json({ data: await patientService.deletePatient(req.validated.params.id) });
}
