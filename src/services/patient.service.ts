import { Types, type QueryFilter } from 'mongoose';
import { PatientModel, type Patient } from '../models/patient.model.js';
import { ApiError } from '../utils/ApiError.js';
import { buildPaginationMeta, dateRange, parseSort, prefixRegex } from '../utils/query.js';
import type { CreatePatientInput, ListPatientsQuery, UpdatePatientInput } from '../validators/patient.validator.js';
import { assertDoctorExists } from './doctor.service.js';

const DOCTOR_FIELDS = 'name specialization hospital';

function buildFilter(q: ListPatientsQuery): QueryFilter<Patient> {
  const filter: QueryFilter<Patient> = {};
  if (q.search) {
    const regex = prefixRegex(q.search);
    filter.$or = [{ nameLower: regex }, { email: regex }];
  }
  if (q.doctor) filter.doctor = new Types.ObjectId(q.doctor);
  if (q.condition?.length) filter.condition = { $in: q.condition };
  if (q.status?.length) filter.status = { $in: q.status };
  if (q.gender) filter.gender = q.gender;
  if (q.ageMin !== undefined || q.ageMax !== undefined) {
    filter.age = {
      ...(q.ageMin !== undefined && { $gte: q.ageMin }),
      ...(q.ageMax !== undefined && { $lte: q.ageMax }),
    };
  }
  const admitted = dateRange(q.from, q.to);
  if (admitted) filter.admissionDate = admitted;
  return filter;
}

type PopulatedDoctor = { _id: Types.ObjectId; name: string; specialization: string; hospital: string };

function serialize(p: Record<string, any>) {
  const { _id, doctor, nameLower: _nameLower, __v: _version, ...rest } = p;
  const populated = doctor && typeof doctor === 'object' && 'name' in doctor ? (doctor as PopulatedDoctor) : null;
  return {
    id: String(_id),
    ...rest,
    doctor: populated
      ? {
          id: String(populated._id),
          name: populated.name,
          specialization: populated.specialization,
          hospital: populated.hospital,
        }
      : null,
  };
}

export async function listPatients(q: ListPatientsQuery) {
  const filter = buildFilter(q);
  const [docs, total] = await Promise.all([
    PatientModel.find(filter)
      .sort(parseSort(q.sort))
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      // Populate issues a single `$in` query for the whole page, not one per row.
      .populate('doctor', DOCTOR_FIELDS)
      .lean(),
    PatientModel.countDocuments(filter),
  ]);
  return { data: docs.map(serialize), meta: buildPaginationMeta(q.page, q.limit, total) };
}

export async function getPatient(id: string) {
  const patient = await PatientModel.findById(id).populate('doctor', DOCTOR_FIELDS).lean();
  if (!patient) throw ApiError.notFound('Patient');
  return serialize(patient);
}

export async function createPatient(input: CreatePatientInput) {
  await assertDoctorExists(input.doctor);
  const patient = await PatientModel.create(input);
  await patient.populate('doctor', DOCTOR_FIELDS);
  return serialize(patient.toObject());
}

export async function updatePatient(id: string, input: UpdatePatientInput) {
  if (input.doctor) await assertDoctorExists(input.doctor);
  const { email, ...rest } = input;
  // An empty email in the form means "remove it".
  const update = 'email' in input && !email ? { $set: rest, $unset: { email: 1 } } : { $set: input };
  const patient = await PatientModel.findByIdAndUpdate(id, update, { returnDocument: 'after', runValidators: true })
    .populate('doctor', DOCTOR_FIELDS)
    .lean();
  if (!patient) throw ApiError.notFound('Patient');
  return serialize(patient);
}

/** When `doctorId` is given the delete is scoped to that doctor's patient list. */
export async function deletePatient(id: string, doctorId?: string) {
  const patient = await PatientModel.findOneAndDelete({ _id: id, ...(doctorId && { doctor: doctorId }) });
  if (!patient) throw ApiError.notFound('Patient');
  return { id };
}
