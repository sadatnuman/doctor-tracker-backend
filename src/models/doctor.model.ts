import { Schema, model, type InferSchemaType } from 'mongoose';
import { nameLowerPlugin, toJSONOptions } from './plugins.js';

const doctorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    nameLower: { type: String, select: false },
    specialization: { type: String, required: true, trim: true, maxlength: 80 },
    hospital: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
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
