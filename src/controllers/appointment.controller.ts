import type { Request, Response } from 'express';
import * as appointmentService from '../services/appointment.service.js';

export async function book(req: Request, res: Response) {
  const appointment = await appointmentService.bookAppointment(req.user!, req.validated.body);
  res.status(201).location(`/api/appointments/${appointment.id}`).json({ data: appointment });
}

export async function list(req: Request, res: Response) {
  res.json(await appointmentService.listAppointments(req.user!, req.validated.query));
}

export async function getOne(req: Request, res: Response) {
  res.json({ data: await appointmentService.getAppointment(req.user!, req.validated.params.id) });
}

export async function pay(req: Request, res: Response) {
  res.json({ data: await appointmentService.payForAppointment(req.user!, req.validated.params.id, req.validated.body) });
}

export async function cancel(req: Request, res: Response) {
  res.json({
    data: await appointmentService.cancelAppointment(req.user!, req.validated.params.id, req.validated.body.reason),
  });
}

export async function complete(req: Request, res: Response) {
  res.json({ data: await appointmentService.completeAppointment(req.user!, req.validated.params.id) });
}

export async function payments(req: Request, res: Response) {
  const { page, limit } = req.validated.query;
  res.json(await appointmentService.listPayments(req.user!, page, limit));
}

export async function doctorOverview(req: Request, res: Response) {
  res.json({ data: await appointmentService.getDoctorOverview(req.user!) });
}
