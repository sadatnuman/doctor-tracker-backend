import { Schema, model, type InferSchemaType } from 'mongoose';
import { APPOINTMENT_STATUSES, ROLES } from '../config/constants.js';
import { toJSONOptions } from './plugins.js';

const appointmentSchema = new Schema(
  {
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    /** The patient account that booked. */
    patientUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** The doctor's patient record, linked once the visit is paid for. */
    patient: { type: Schema.Types.ObjectId, ref: 'Patient' },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    /** Consultation fee captured at booking time, so later fee changes don't alter it. */
    fee: { type: Number, required: true, min: 0 },
    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'pending_payment', required: true },
    /** Unpaid bookings release their slot at this instant. */
    holdExpiresAt: { type: Date },
    /**
     * true while the appointment occupies its slot (unpaid hold or confirmed). A partial
     * unique index on { doctor, start } over these rows makes double-booking impossible,
     * even when two patients press "Book" at the same moment.
     */
    holdsSlot: { type: Boolean, default: true },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
    cancelledBy: { type: String, enum: ROLES },
    cancellationReason: { type: String, trim: true, maxlength: 300 },
    statusChangedAt: { type: Date },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

appointmentSchema.index(
  { doctor: 1, start: 1 },
  { unique: true, partialFilterExpression: { holdsSlot: true }, name: 'one_active_booking_per_slot' },
);
// Doctor's schedule and taken-slot lookups.
appointmentSchema.index({ doctor: 1, start: -1 });
// "My appointments" for a patient.
appointmentSchema.index({ patientUser: 1, start: -1 });
// Admin list by status; the hold sweeper (status + holdExpiresAt).
appointmentSchema.index({ status: 1, start: -1 });
appointmentSchema.index({ status: 1, holdExpiresAt: 1 });

export type Appointment = InferSchemaType<typeof appointmentSchema>;
export const AppointmentModel = model('Appointment', appointmentSchema);
