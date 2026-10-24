import { Schema, model, type InferSchemaType } from 'mongoose';
import { SLOT_LENGTHS } from '../config/constants.js';
import { nameLowerPlugin, toJSONOptions } from './plugins.js';

/** Weekly consulting hours, as wall-clock times in the clinic timezone. */
const availabilitySchema = new Schema(
  {
    /** 0 = Sunday … 6 = Saturday. Default: Sunday–Thursday. */
    days: { type: [Number], default: () => [0, 1, 2, 3, 4] },
    start: { type: String, default: '09:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    end: { type: String, default: '17:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    slotMinutes: { type: Number, default: 30, enum: SLOT_LENGTHS },
  },
  { _id: false },
);

const doctorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    nameLower: { type: String, select: false },
    specialization: { type: String, required: true, trim: true, maxlength: 80 },
    hospital: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
    /** Consultation fee in BDT, charged when a patient books. */
    consultationFee: { type: Number, default: 1000, min: 0, max: 100_000 },
    bio: { type: String, trim: true, maxlength: 600 },
    availability: { type: availabilitySchema, default: () => ({}) },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

doctorSchema.plugin(nameLowerPlugin);

// Search: anchored prefix match on the normalized name.
doctorSchema.index({ nameLower: 1 });
// Filters + default sort (newest first) share the same compound indexes (ESR rule: equality, sort, range).
doctorSchema.index({ specialization: 1, createdAt: -1 });
doctorSchema.index({ hospital: 1, createdAt: -1 });
doctorSchema.index({ createdAt: -1 });

export type Doctor = InferSchemaType<typeof doctorSchema>;
export const DoctorModel = model('Doctor', doctorSchema);
