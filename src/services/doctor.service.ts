import { Types, type QueryFilter } from 'mongoose';
import { AppointmentModel } from '../models/appointment.model.js';
import { DoctorModel, type Doctor } from '../models/doctor.model.js';
import { PatientModel } from '../models/patient.model.js';
import { RefreshTokenModel } from '../models/refreshToken.model.js';
import { UserModel } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';
import { buildPaginationMeta, dateRange, parseSort, prefixRegex } from '../utils/query.js';
import type { AvailabilityInput } from '../validators/appointment.validator.js';
import type {
  CreateDoctorInput,
  ListDoctorsQuery,
  ListPublicDoctorsQuery,
  UpdateDoctorInput,
} from '../validators/doctor.validator.js';
import { setDoctorAccount } from './auth.service.js';

const LIST_PROJECTION = 'name specialization hospital phone email consultationFee createdAt updatedAt';
const DETAIL_PROJECTION = `${LIST_PROJECTION} bio availability`;
/** What anonymous visitors may see: no phone or email. */
const PUBLIC_PROJECTION = 'name specialization hospital consultationFee bio availability';

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

/** Which of these doctors can sign in — one `$in` query for the page. */
async function accountsFor(ids: Types.ObjectId[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const users = await UserModel.find({ doctor: { $in: ids } }).select('doctor').lean();
  return new Set(users.map((u) => String(u.doctor)));
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
  const ids = docs.map((d) => d._id);
  const [counts, accounts] = await Promise.all([patientCountsFor(ids), accountsFor(ids)]);
  return {
    data: docs.map((d) => ({
      ...serialize(d),
      patientCount: counts.get(String(d._id)) ?? 0,
      hasAccount: accounts.has(String(d._id)),
    })),
    meta: buildPaginationMeta(q.page, q.limit, total),
  };
}

export async function getDoctor(id: string) {
  const doctorId = new Types.ObjectId(id);
  const [doctor, stats, account] = await Promise.all([
    DoctorModel.findById(doctorId).select(DETAIL_PROJECTION).lean(),
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
    UserModel.findOne({ doctor: doctorId }).select('email lastLoginAt').lean(),
  ]);
  if (!doctor) throw ApiError.notFound('Doctor');
  const s = stats[0];
  return {
    ...serialize(doctor),
    patientCount: s?.total[0]?.n ?? 0,
    patientsByStatus: (s?.byStatus ?? []).map((r) => ({ status: r._id, count: r.count })),
    patientsByCondition: (s?.byCondition ?? []).map((r) => ({ condition: r._id, count: r.count })),
    hasAccount: Boolean(account),
    account: account ? { email: account.email, lastLoginAt: account.lastLoginAt ?? null } : null,
  };
}

export async function createDoctor({ password, ...input }: CreateDoctorInput) {
  if (password && (await UserModel.exists({ email: input.email }))) {
    throw ApiError.conflict('An account with this email already exists', { field: 'email' });
  }
  const doctor = await DoctorModel.create(input);
  if (password) await setDoctorAccount(String(doctor._id), password);
  return { ...serialize(doctor.toObject()), patientCount: 0, hasAccount: Boolean(password) };
}

export async function updateDoctor(id: string, input: UpdateDoctorInput) {
  if (input.email) {
    const clash = await UserModel.exists({ email: input.email, doctor: { $ne: new Types.ObjectId(id) } });
    if (clash) throw ApiError.conflict('An account with this email already exists', { field: 'email' });
  }
  const doctor = await DoctorModel.findByIdAndUpdate(id, { $set: input }, { returnDocument: 'after', runValidators: true })
    .select(DETAIL_PROJECTION)
    .lean();
  if (!doctor) throw ApiError.notFound('Doctor');
  // The login follows the roster: same name and email.
  if (input.email || input.name) {
    await UserModel.updateOne({ doctor: doctor._id }, { $set: { email: doctor.email, name: doctor.name } });
  }
  return serialize(doctor);
}

export async function updateAvailability(id: string, availability: AvailabilityInput) {
  return updateDoctor(id, { availability });
}

export async function deleteDoctor(id: string, cascade: boolean) {
  const doctorId = new Types.ObjectId(id);
  const [patientCount, upcoming] = await Promise.all([
    PatientModel.countDocuments({ doctor: doctorId }),
    AppointmentModel.countDocuments({ doctor: doctorId, status: { $in: ['pending_payment', 'confirmed'] }, start: { $gte: new Date() } }),
  ]);
  if ((patientCount > 0 || upcoming > 0) && !cascade) {
    throw ApiError.conflict(
      `This doctor has ${patientCount} patient(s) and ${upcoming} upcoming appointment(s). Delete them as well to continue.`,
      { patientCount, upcomingAppointments: upcoming },
    );
  }
  const doctor = await DoctorModel.findByIdAndDelete(doctorId);
  if (!doctor) throw ApiError.notFound('Doctor');
  const account = await UserModel.findOneAndDelete({ doctor: doctorId });
  const [patients] = await Promise.all([
    PatientModel.deleteMany({ doctor: doctorId }),
    AppointmentModel.deleteMany({ doctor: doctorId }),
    account ? RefreshTokenModel.deleteMany({ user: account._id }) : null,
  ]);
  return { id, deletedPatients: patients.deletedCount };
}

export async function assertDoctorExists(id: string | Types.ObjectId) {
  const exists = await DoctorModel.exists({ _id: id });
  if (!exists) throw ApiError.notFound('Doctor');
}

// ── Public directory ───────────────────────────────────────────────────────

export async function listPublicDoctors(q: ListPublicDoctorsQuery) {
  const filter: QueryFilter<Doctor> = {};
  if (q.specialization) filter.specialization = q.specialization;
  if (q.hospital) filter.hospital = q.hospital;
  if (q.search) {
    // Names are stored as "Dr. …": "rah" should find "Dr. Rahman". Two anchored prefixes
    // in an $in still compile to index bounds on { nameLower: 1 }.
    const term = q.search.replace(/^dr\.?\s*/i, '');
    filter.nameLower = { $in: [prefixRegex(term), prefixRegex(`dr. ${term}`)] };
  }
  const sort = q.sort === 'name' ? { nameLower: 1 as const, _id: 1 as const } : parseSort(q.sort);
  const [docs, total] = await Promise.all([
    DoctorModel.find(filter).select(PUBLIC_PROJECTION).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    DoctorModel.countDocuments(filter),
  ]);
  return { data: docs.map(serialize), meta: buildPaginationMeta(q.page, q.limit, total) };
}

export async function getPublicDoctor(id: string) {
  const doctor = await DoctorModel.findById(id).select(PUBLIC_PROJECTION).lean();
  if (!doctor) throw ApiError.notFound('Doctor');
  return serialize(doctor);
}
