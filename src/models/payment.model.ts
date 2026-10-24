import { Schema, model, type InferSchemaType } from 'mongoose';
import { CURRENCY, PAYMENT_METHODS, PAYMENT_STATUSES } from '../config/constants.js';
import { toJSONOptions } from './plugins.js';

/**
 * A payment attempt for an appointment. The gateway is simulated, but the record is
 * what a real integration would keep: amount, method, masked instrument, a unique
 * transaction id and the full status history (paid → refunded).
 */
const paymentSchema = new Schema(
  {
    appointment: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true },
    patientUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: CURRENCY },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    /** e.g. "Visa •••• 4242" or "bKash •••• 5678" — never the full number. */
    instrument: { type: String, required: true, maxlength: 60 },
    status: { type: String, enum: PAYMENT_STATUSES, required: true },
    transactionId: { type: String, required: true, unique: true },
    failureReason: { type: String, maxlength: 200 },
    paidAt: { type: Date },
    refundedAt: { type: Date },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

paymentSchema.index({ appointment: 1 });
paymentSchema.index({ patientUser: 1, createdAt: -1 });
// Revenue by doctor / over time.
paymentSchema.index({ status: 1, paidAt: -1 });
paymentSchema.index({ doctor: 1, paidAt: -1 });

export type Payment = InferSchemaType<typeof paymentSchema>;
export const PaymentModel = model('Payment', paymentSchema);
