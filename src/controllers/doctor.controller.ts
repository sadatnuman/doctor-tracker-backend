import type { Request, Response } from 'express';
import * as doctorService from '../services/doctor.service.js';
import * as patientService from '../services/patient.service.js';

export async function list(req: Request, res: Response) {
  res.json(await doctorService.listDoctors(req.validated.query));
}

export async function getOne(req: Request, res: Response) {
  res.json({ data: await doctorService.getDoctor(req.validated.params.id) });
}

export async function create(req: Request, res: Response) {
  const doctor = await doctorService.createDoctor(req.validated.body);
  res.status(201).location(`/api/doctors/${doctor.id}`).json({ data: doctor });
}

export async function update(req: Request, res: Response) {
  res.json({ data: await doctorService.updateDoctor(req.validated.params.id, req.validated.body) });
}

export async function remove(req: Request, res: Response) {
  res.json({ data: await doctorService.deleteDoctor(req.validated.params.id, req.validated.query.cascade) });
}

export async function listPatients(req: Request, res: Response) {
  const doctorId = req.validated.params.id;
  await doctorService.assertDoctorExists(doctorId);
  res.json(await patientService.listPatients({ ...req.validated.query, doctor: doctorId }));
}

export async function addPatient(req: Request, res: Response) {
  const patient = await patientService.createPatient({ ...req.validated.body, doctor: req.validated.params.id });
  res.status(201).location(`/api/patients/${patient.id}`).json({ data: patient });
}

export async function removePatient(req: Request, res: Response) {
  const { id, patientId } = req.validated.params;
  res.json({ data: await patientService.deletePatient(patientId, id) });
}
