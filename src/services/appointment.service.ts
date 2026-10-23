import { randomBytes } from 'node:crypto';
import { Types, type QueryFilter } from 'mongoose';
import { BOOKING_WINDOW_DAYS } from '../config/constants.js';
import { env } from '../config/env.js';
import { AppointmentModel, type Appointment } from '../models/appointment.model.js';
import { DoctorModel } from '../models/doctor.model.js';
import { PatientModel } from '../models/patient.model.js';
import { PaymentModel } from '../models/payment.model.js';
import { UserModel } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';
import { buildPaginationMeta, dateRange } from '../utils/query.js';
import type {
  BookAppointmentInput,
  ListAppointmentsQuery,
  PayAppointmentInput,
} from '../validators/appointment.validator.js';
import type { AuthUser } from './auth.service.js';
import { isPublishedSlot, releaseExpiredHolds, type Availability } from './slot.service.js';

const HOLD_MS = () => env.PAYMENT_HOLD_MINUTES * 60_000;

const POPULATE = [
  { path: 'doctor', select: 'name specialization hospital' },
  { path: 'patientUser', select: 'name email phone' },
  { path: 'payment', select: 'amount currency method instrument status transactionId paidAt refundedAt' },
] as const;

const ref = (doc: any, fields: string[]) =>
  doc && typeof doc === 'object' && '_id' in doc
    ? { id: String(doc._id), ...Object.fromEntries(fields.map((f) => [f, doc[f]])) }
    : null;

function serialize(a: Record<string, any>) {
  return {
    id: String(a._id),
    doctor: ref(a.doctor, ['name', 'specialization', 'hospital']),
    patientUser: ref(a.patientUser, ['name', 'email', 'phone']),
    patientRecordId: a.patient ? String(a.patient._id ?? a.patient) : null,
    start: a.start,
    end: a.end,
    reason: a.reason,
    fee: a.fee,
    status: a.status,
    holdExpiresAt: a.status === 'pending_payment' ? a.holdExpiresAt : null,
    payment: ref(a.payment, ['amount', 'currency', 'method', 'instrument', 'status', 'transactionId', 'paidAt', 'refundedAt']),
    cancelledBy: a.cancelledBy ?? null,
    cancellationReason: a.cancellationReason ?? null,
    createdAt: a.createdAt,
  };
}

/** Row-level access: admins see everything, doctors their own schedule, patients their own bookings. */
function scopeFilter(user: AuthUser): QueryFilter<Appointment> {
  if (user.role === 'admin') return {};
  if (user.role === 'doctor') return { doctor: new Types.ObjectId(user.doctorId) };
  return { patientUser: new Types.ObjectId(user.id) };
}

async function findScoped(user: AuthUser, id: string) {
  // Not-yours and not-found look the same, so ids can't be probed.
  const appointment = await AppointmentModel.findOne({ _id: id, ...scopeFilter(user) });
  if (!appointment) throw ApiError.notFound('Appointment');
  return appointment;
}

async function loadSerialized(id: Types.ObjectId | string) {
  const doc = await AppointmentModel.findById(id).populate([...POPULATE]).lean();
  return serialize(doc!);
}

export async function bookAppointment(user: AuthUser, input: BookAppointmentInput) {
  const doctor = await DoctorModel.findById(input.doctorId).select('availability consultationFee').lean();
  if (!doctor) throw ApiError.notFound('Doctor');
  const availability = doctor.availability as Availability;

  const now = Date.now();
  const start = input.start;
  if (start.getTime() <= now) throw ApiError.badRequest('That time has already passed. Pick another slot.');
  if (start.getTime() > now + BOOKING_WINDOW_DAYS * 86_400_000) {
    throw ApiError.badRequest(`You can book up to ${BOOKING_WINDOW_DAYS} days ahead.`);
  }
  if (!isPublishedSlot(availability, start)) {
    throw ApiError.badRequest('Pick one of the doctor’s available times.');
  }

  await releaseExpiredHolds({ patientUser: new Types.ObjectId(user.id) });
  const openHold = await AppointmentModel.findOne({ patientUser: user.id, status: 'pending_payment' }).select('_id').lean();
  if (openHold) {
    throw ApiError.conflict('Finish paying for your other booking first, or cancel it.', {
      appointmentId: String(openHold._id),
      reason: 'OPEN_HOLD',
    });
  }

  // Free a lapsed hold on this exact slot so the unique index doesn't block a valid booking.
  await releaseExpiredHolds({ doctor: doctor._id, start });

  try {
    const created = await AppointmentModel.create({
      doctor: doctor._id,
      patientUser: user.id,
      start,
      end: new Date(start.getTime() + availability.slotMinutes * 60_000),
      reason: input.reason,
      fee: doctor.consultationFee,
      status: 'pending_payment',
      holdExpiresAt: new Date(now + HOLD_MS()),
      holdsSlot: true,
      statusChangedAt: new Date(now),
    });
    return loadSerialized(created._id);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw ApiError.conflict('Someone just booked this slot. Please pick another time.', { reason: 'SLOT_TAKEN' });
    }
    throw error;
  }
}

export async function listAppointments(user: AuthUser, q: ListAppointmentsQuery) {
  await releaseExpiredHolds();
  const filter: QueryFilter<Appointment> = { ...scopeFilter(user) };
  if (q.status?.length) filter.status = { $in: q.status };
  if (q.doctor && user.role === 'admin') filter.doctor = new Types.ObjectId(q.doctor);

  const now = new Date();
  const range = dateRange(q.from, q.to) ?? {};
  if (q.when === 'upcoming') Object.assign(range, { $gte: range.$gte && range.$gte > now ? range.$gte : now });
  if (q.when === 'past') Object.assign(range, { $lt: now });
  if (Object.keys(range).length) filter.start = range;

  const sort = q.when === 'upcoming' ? { start: 1 as const, _id: 1 as const } : { start: -1 as const, _id: -1 as const };
  const [docs, total] = await Promise.all([
    AppointmentModel.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate([...POPULATE])
      .lean(),
    AppointmentModel.countDocuments(filter),
  ]);
  return { data: docs.map(serialize), meta: { ...buildPaginationMeta(q.page, q.limit, total), serverTime: now.toISOString() } };
}

export async function getAppointment(user: AuthUser, id: string) {
  await releaseExpiredHolds({ _id: new Types.ObjectId(id) });
  const appointment = await findScoped(user, id);
  return { ...(await loadSerialized(appointment._id)), serverTime: new Date().toISOString() };
}

/**
 * Simulated gateway: validates the instrument like a real checkout would and declines
 * the well-known test card 4000 0000 0000 0002. Returns a masked instrument label.
 */
function chargeInstrument(input: PayAppointmentInput): { ok: true; instrument: string } | { ok: false; instrument: string; reason: string } {
  if (input.method === 'card') {
    const brand = input.cardNumber.startsWith('4') ? 'Visa' : /^5[1-5]/.test(input.cardNumber) ? 'Mastercard' : 'Card';
    const instrument = `${brand} •••• ${input.cardNumber.slice(-4)}`;
    if (!luhn(input.cardNumber)) return { ok: false, instrument, reason: 'Card number is not valid' };
    const [mm, yy] = input.expiry.split('/').map(Number) as [number, number];
    if (new Date(2000 + yy, mm, 1) <= new Date()) return { ok: false, instrument, reason: 'Card has expired' };
    if (input.cardNumber === '4000000000000002') return { ok: false, instrument, reason: 'Card was declined by the bank' };
    return { ok: true, instrument };
  }
  const label = input.method === 'bkash' ? 'bKash' : 'Nagad';
  return { ok: true, instrument: `${label} •••• ${input.walletNumber.slice(-4)}` };
}

function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const transactionId = () => `TXN-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`;

export async function payForAppointment(user: AuthUser, id: string, input: PayAppointmentInput) {
  await releaseExpiredHolds({ _id: new Types.ObjectId(id) });
  const appointment = await findScoped(user, id);
  if (appointment.status === 'confirmed' || appointment.status === 'completed') {
    throw ApiError.conflict('This appointment is already paid for.', { reason: 'ALREADY_PAID' });
  }
  if (appointment.status !== 'pending_payment') {
    throw ApiError.conflict(
      `Your ${env.PAYMENT_HOLD_MINUTES}-minute hold ran out and the slot was released. Please pick a time again.`,
      { reason: 'HOLD_EXPIRED' },
    );
  }

  const charge = chargeInstrument(input);
  if (!charge.ok) {
    await PaymentModel.create({
      appointment: appointment._id,
      patientUser: appointment.patientUser,
      doctor: appointment.doctor,
      amount: appointment.fee,
      method: input.method,
      instrument: charge.instrument,
      status: 'failed',
      failureReason: charge.reason,
      transactionId: transactionId(),
    });
    throw new ApiError(402, `${charge.reason}. Your slot is still held — try again or use another method.`, 'PAYMENT_DECLINED');
  }

  // Claim the confirmation atomically: only succeeds while the hold is still live.
  const now = new Date();
  const confirmed = await AppointmentModel.findOneAndUpdate(
    { _id: appointment._id, status: 'pending_payment', holdExpiresAt: { $gt: now } },
    { $set: { status: 'confirmed', statusChangedAt: now }, $unset: { holdExpiresAt: 1 } },
    { returnDocument: 'after' },
  );
  if (!confirmed) {
    await releaseExpiredHolds({ _id: appointment._id });
    throw ApiError.conflict('Your hold ran out just before payment. You have not been charged.', { reason: 'HOLD_EXPIRED' });
  }

  const payment = await PaymentModel.create({
    appointment: confirmed._id,
    patientUser: confirmed.patientUser,
    doctor: confirmed.doctor,
    amount: confirmed.fee,
    method: input.method,
    instrument: charge.instrument,
    status: 'paid',
    transactionId: transactionId(),
    paidAt: now,
  });

  const patientRecord = await openPatientRecord(confirmed.patientUser, confirmed.doctor, confirmed.start, confirmed.reason);
  await AppointmentModel.updateOne({ _id: confirmed._id }, { $set: { payment: payment._id, patient: patientRecord } });
  return loadSerialized(confirmed._id);
}

/**
 * A paid booking puts the patient on the doctor's list: reuse their record with this
 * doctor if one exists, otherwise open a new one from the account's details.
 */
async function openPatientRecord(userId: Types.ObjectId, doctorId: Types.ObjectId, start: Date, reason: string) {
  const user = await UserModel.findById(userId).select('name email phone age gender').lean();
  if (!user) return undefined;
  const record = await PatientModel.findOneAndUpdate(
    { user: userId, doctor: doctorId },
    {
      $setOnInsert: {
        name: user.name,
        nameLower: user.name.toLowerCase(),
        email: user.email,
        phone: user.phone ?? 'Not provided',
        age: user.age ?? 0,
        gender: user.gender ?? 'Other',
        condition: 'Other',
        admissionDate: start,
      },
      // A returning patient becomes active again; the latest reason goes on the record.
      $set: { status: 'Active', notes: `Online booking: ${reason}`.slice(0, 1000) },
    },
    { upsert: true, returnDocument: 'after', runValidators: true },
  );
  return record?._id;
}

export async function cancelAppointment(user: AuthUser, id: string, reason?: string) {
  await releaseExpiredHolds({ _id: new Types.ObjectId(id) });
  const appointment = await findScoped(user, id);
  if (!['pending_payment', 'confirmed'].includes(appointment.status)) {
    throw ApiError.conflict(`A ${appointment.status.replace('_', ' ')} appointment can’t be cancelled.`);
  }
  if (appointment.status === 'confirmed' && appointment.start <= new Date() && user.role !== 'admin') {
    throw ApiError.conflict('This visit has already started. Ask the clinic to cancel it.');
  }

  const now = new Date();
  appointment.set({
    status: 'cancelled',
    holdsSlot: false,
    holdExpiresAt: undefined,
    cancelledBy: user.role,
    cancellationReason: reason,
    statusChangedAt: now,
  });
  await appointment.save();
  if (appointment.payment) {
    await PaymentModel.updateOne({ _id: appointment.payment, status: 'paid' }, { $set: { status: 'refunded', refundedAt: now } });
  }
  return loadSerialized(appointment._id);
}

export async function completeAppointment(user: AuthUser, id: string) {
  const appointment = await findScoped(user, id);
  if (appointment.status !== 'confirmed') throw ApiError.conflict('Only confirmed appointments can be completed.');
  if (appointment.start > new Date()) throw ApiError.conflict('You can mark the visit completed once it has started.');
  appointment.set({ status: 'completed', statusChangedAt: new Date() });
  await appointment.save();
  return loadSerialized(appointment._id);
}

export async function listPayments(user: AuthUser, page: number, limit: number) {
  const filter = user.role === 'admin' ? {} : user.role === 'doctor' ? { doctor: user.doctorId } : { patientUser: user.id };
  const [docs, total] = await Promise.all([
    PaymentModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate([
        { path: 'doctor', select: 'name' },
        { path: 'patientUser', select: 'name' },
        { path: 'appointment', select: 'start' },
      ])
      .lean(),
    PaymentModel.countDocuments(filter),
  ]);
  return {
    data: docs.map((p: Record<string, any>) => ({
      id: String(p._id),
      amount: p.amount,
      currency: p.currency,
      method: p.method,
      instrument: p.instrument,
      status: p.status,
      transactionId: p.transactionId,
      failureReason: p.failureReason ?? null,
      paidAt: p.paidAt ?? null,
      refundedAt: p.refundedAt ?? null,
      createdAt: p.createdAt,
      doctor: ref(p.doctor, ['name']),
      patientUser: ref(p.patientUser, ['name']),
      appointment: p.appointment ? { id: String(p.appointment._id), start: p.appointment.start } : null,
    })),
    meta: buildPaginationMeta(page, limit, total),
  };
}

/** Numbers for the doctor's home screen. */
export async function getDoctorOverview(user: AuthUser) {
  const doctorId = new Types.ObjectId(user.doctorId);
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await releaseExpiredHolds({ doctor: doctorId });
  const [upcoming, completedThisMonth, revenue, patientCount] = await Promise.all([
    AppointmentModel.countDocuments({ doctor: doctorId, status: 'confirmed', start: { $gte: now } }),
    AppointmentModel.countDocuments({ doctor: doctorId, status: 'completed', start: { $gte: startOfMonth } }),
    PaymentModel.aggregate<{ total: number }>([
      { $match: { doctor: doctorId, status: 'paid', paidAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    PatientModel.countDocuments({ doctor: doctorId }),
  ]);
  return { upcoming, completedThisMonth, revenueThisMonth: revenue[0]?.total ?? 0, patientCount };
}
