import { Schema, model, type InferSchemaType } from 'mongoose';
import { GENDERS, PATIENT_CONDITIONS, PATIENT_STATUSES } from '../config/constants.js';
import { nameLowerPlugin, toJSONOptions } from './plugins.js';

const patientSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    nameLower: { type: String, select: false },
    age: { type: Number, required: true, min: 0, max: 130 },
    gender: { type: String, required: true, enum: GENDERS },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    email: { type: String, lowercase: true, trim: true, maxlength: 120 },
    condition: { type: String, required: true, enum: PATIENT_CONDITIONS },
    status: { type: String, required: true, enum: PATIENT_STATUSES, default: 'Active' },
    admissionDate: { type: Date, required: true, default: () => new Date() },
    notes: { type: String, trim: true, maxlength: 1000 },
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

patientSchema.plugin(nameLowerPlugin);

// "Patients of doctor X, newest first" + per-doctor aggregation on the dashboard.
patientSchema.index({ doctor: 1, admissionDate: -1 });
// Condition / status filters sorted by admission date.
patientSchema.index({ condition: 1, admissionDate: -1 });
patientSchema.index({ status: 1, admissionDate: -1 });
// Date-range filters, default sort and the dashboard time series.
patientSchema.index({ admissionDate: -1 });
// Search: anchored prefix match on name or email. Every `$or` branch needs an index,
// otherwise MongoDB falls back to a collection scan.
patientSchema.index({ nameLower: 1 });
patientSchema.index({ email: 1 }, { sparse: true });

export type Patient = InferSchemaType<typeof patientSchema>;
export const PatientModel = model('Patient', patientSchema);
