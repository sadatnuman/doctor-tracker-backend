import { Types } from 'mongoose';
import { BOOKING_WINDOW_DAYS } from '../config/constants.js';
import { env } from '../config/env.js';
import { AppointmentModel } from '../models/appointment.model.js';
import { DoctorModel } from '../models/doctor.model.js';
import { ApiError } from '../utils/ApiError.js';
import { addDays, fromMinutes, toMinutes, weekdayOf, zonedDate, zonedTime, zonedToUtc } from '../utils/time.js';

export interface Availability {
  days: number[];
  start: string;
  end: string;
  slotMinutes: number;
}

const TZ = () => env.CLINIC_TIMEZONE;

/** Wall-clock start times ("09:00", "09:30", …) for one calendar date. */
export function slotTimesForDate(availability: Availability, date: string): string[] {
  if (!availability.days.includes(weekdayOf(date))) return [];
  const times: string[] = [];
  const end = toMinutes(availability.end);
  for (let t = toMinutes(availability.start); t + availability.slotMinutes <= end; t += availability.slotMinutes) {
    times.push(fromMinutes(t));
  }
  return times;
}

/** True when `start` is exactly one of the doctor's published slot starts. */
export function isPublishedSlot(availability: Availability, start: Date): boolean {
  if (start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0) return false;
  return slotTimesForDate(availability, zonedDate(start, TZ())).includes(zonedTime(start, TZ()));
}

export function bookingWindow(now = new Date()) {
  const today = zonedDate(now, TZ());
  return { today, lastDay: addDays(today, BOOKING_WINDOW_DAYS - 1) };
}

/**
 * Lazily releases unpaid holds whose 5-minute window has passed. Runs before every
 * read/write that cares about slot availability (and on a timer), so a slot is free
 * for everyone the moment its hold lapses. Indexed by { status, holdExpiresAt }.
 */
export function releaseExpiredHolds(extra: Record<string, unknown> = {}) {
  const now = new Date();
  return AppointmentModel.updateMany(
    { status: 'pending_payment', holdExpiresAt: { $lte: now }, ...extra },
    { $set: { status: 'expired', holdsSlot: false, statusChangedAt: now } },
  );
}

/** A doctor's bookable slots for `days` calendar days starting at `from` (clinic time). */
export async function getDoctorSlots(doctorId: string, from: string | undefined, days: number) {
  const doctor = await DoctorModel.findById(doctorId).select('availability consultationFee').lean();
  if (!doctor) throw ApiError.notFound('Doctor');
  const availability = doctor.availability as Availability;

  const now = new Date();
  const { today, lastDay } = bookingWindow(now);
  const first = from && from > today ? from : today;
  const dates = Array.from({ length: days }, (_, i) => addDays(first, i)).filter((d) => d <= lastDay);
  if (dates.length === 0) return { timezone: TZ(), slotMinutes: availability.slotMinutes, fee: doctor.consultationFee, days: [] };

  const rangeStart = zonedToUtc(dates[0]!, '00:00', TZ());
  const rangeEnd = zonedToUtc(addDays(dates.at(-1)!, 1), '00:00', TZ());

  // Taken = confirmed, or an unpaid hold that hasn't lapsed yet. Served by { doctor, start }.
  const taken = await AppointmentModel.find({
    doctor: new Types.ObjectId(doctorId),
    start: { $gte: rangeStart, $lt: rangeEnd },
    holdsSlot: true,
    $or: [{ status: 'confirmed' }, { status: 'pending_payment', holdExpiresAt: { $gt: now } }],
  })
    .select('start')
    .lean();
  const takenAt = new Set(taken.map((a) => a.start.getTime()));

  return {
    timezone: TZ(),
    slotMinutes: availability.slotMinutes,
    fee: doctor.consultationFee,
    days: dates.map((date) => ({
      date,
      weekday: weekdayOf(date),
      slots: slotTimesForDate(availability, date)
        .map((time) => {
          const start = zonedToUtc(date, time, TZ());
          return { start: start.toISOString(), time, available: !takenAt.has(start.getTime()) };
        })
        .filter((slot) => new Date(slot.start) > now),
    })),
  };
}
