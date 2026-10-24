import type { Request, Response } from 'express';
import * as doctorService from '../services/doctor.service.js';
import * as slotService from '../services/slot.service.js';

// Anonymous endpoints: short shared caching is safe because nothing here is personal.

export async function doctors(req: Request, res: Response) {
  res.set('Cache-Control', 'public, max-age=30');
  res.json(await doctorService.listPublicDoctors(req.validated.query));
}

export async function doctor(req: Request, res: Response) {
  res.set('Cache-Control', 'public, max-age=30');
  res.json({ data: await doctorService.getPublicDoctor(req.validated.params.id) });
}

export async function slots(req: Request, res: Response) {
  // Availability changes by the second while people book, so never cache it.
  res.set('Cache-Control', 'no-store');
  const { from, days } = req.validated.query;
  res.json({ data: await slotService.getDoctorSlots(req.validated.params.id, from, days) });
}
