import { Types, type QueryFilter } from 'mongoose';
import { DoctorModel, type Doctor } from '../models/doctor.model.js';
import { PatientModel } from '../models/patient.model.js';
import { ApiError } from '../utils/ApiError.js';
import { buildPaginationMeta, dateRange, parseSort, prefixRegex } from '../utils/query.js';
import type { CreateDoctorInput, ListDoctorsQuery, UpdateDoctorInput } from '../validators/doctor.validator.js';

const LIST_PROJECTION = 'name specialization hospital phone email createdAt updatedAt';

type CountRow = { _id: string; count: number };

function buildFilter(q: ListDoctorsQuery): QueryFilter<Doctor> {
  const filter: QueryFilter<Doctor> = {};
  if (q.search) {
    const regex = prefixRegex(q.search);
    filter.$or = [{ nameLower: regex }, { email: regex }];
  }
  // Values come from the filter dropdowns (`/meta/filters`), so exact equality keeps the
  // { specialization|hospital, createdAt } compound indexes fully usable.
  if (q.specialization) filter.specialization = q.specialization;
  if (q.hospital) filter.hospital = q.hospital;
  const created = dateRange(q.from, q.to);
  if (created) filter.createdAt = created;
  return filter;
}

/** One grouped query for the whole page instead of N count queries. */
async function patientCountsFor(ids: Types.ObjectId[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await PatientModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { doctor: { $in: ids } } },
    { $group: { _id: '$doctor', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

function serialize<T extends { _id: Types.ObjectId; nameLower?: unknown; __v?: unknown }>({
  _id,
  nameLower: _nameLower,
  __v: _version,
  ...rest
}: T) {
  return { id: String(_id), ...rest };
}

export async function listDoctors(q: ListDoctorsQuery) {
  const filter = buildFilter(q);
  const [docs, total] = await Promise.all([
    DoctorModel.find(filter)
      .select(LIST_PROJECTION)
      .sort(parseSort(q.sort))
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    DoctorModel.countDocuments(filter),
  ]);
  const counts = await patientCountsFor(docs.map((d) => d._id));
  return {
    data: docs.map((d) => ({ ...serialize(d), patientCount: counts.get(String(d._id)) ?? 0 })),
    meta: buildPaginationMeta(q.page, q.limit, total),
  };
}

export async function getDoctor(id: string) {
  const doctorId = new Types.ObjectId(id);
  const [doctor, stats] = await Promise.all([
    DoctorModel.findById(doctorId).select(LIST_PROJECTION).lean(),
    PatientModel.aggregate<{ total: { n: number }[]; byStatus: CountRow[]; byCondition: CountRow[] }>([
      { $match: { doctor: doctorId } },
      {
        $facet: {
          total: [{ $count: 'n' }],
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
          byCondition: [{ $group: { _id: '$condition', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
        },
      },
    ]),
  ]);
  if (!doctor) throw ApiError.notFound('Doctor');
  const s = stats[0];
  return {
    ...serialize(doctor),
    patientCount: s?.total[0]?.n ?? 0,
    patientsByStatus: (s?.byStatus ?? []).map((r) => ({ status: r._id, count: r.count })),
    patientsByCondition: (s?.byCondition ?? []).map((r) => ({ condition: r._id, count: r.count })),
  };
}

export async function createDoctor(input: CreateDoctorInput) {
  const doctor = await DoctorModel.create(input);
  return { ...serialize(doctor.toObject()), patientCount: 0 };
}

export async function updateDoctor(id: string, input: UpdateDoctorInput) {
  const doctor = await DoctorModel.findByIdAndUpdate(
    id,
    { $set: input },
    { returnDocument: 'after', runValidators: true },
  )
    .select(LIST_PROJECTION)
    .lean();
  if (!doctor) throw ApiError.notFound('Doctor');
  return serialize(doctor);
}

export async function deleteDoctor(id: string, cascade: boolean) {
  const doctorId = new Types.ObjectId(id);
  const patientCount = await PatientModel.countDocuments({ doctor: doctorId });
  if (patientCount > 0 && !cascade) {
    throw ApiError.conflict(
      `This doctor has ${patientCount} patient(s). Delete them as well to continue.`,
      { patientCount },
    );
  }
  const doctor = await DoctorModel.findByIdAndDelete(doctorId);
  if (!doctor) throw ApiError.notFound('Doctor');
  const deletedPatients = patientCount > 0 ? (await PatientModel.deleteMany({ doctor: doctorId })).deletedCount : 0;
  return { id, deletedPatients };
}

export async function assertDoctorExists(id: string | Types.ObjectId) {
  const exists = await DoctorModel.exists({ _id: id });
  if (!exists) throw ApiError.notFound('Doctor');
}
