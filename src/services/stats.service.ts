import { DoctorModel } from '../models/doctor.model.js';
import { PatientModel } from '../models/patient.model.js';
import { dateRange } from '../utils/query.js';
import type { OverviewQuery } from '../validators/stats.validator.js';

type Interval = 'day' | 'week' | 'month';
type CountRow = { _id: string; count: number };

const DAY = 24 * 60 * 60 * 1000;

function resolveRange(q: OverviewQuery) {
  const to = q.to ?? new Date();
  const from = q.from ?? new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth() + 1, 1));
  const span = (to.getTime() - from.getTime()) / DAY;
  const interval: Interval = q.interval ?? (span <= 45 ? 'day' : span <= 180 ? 'week' : 'month');
  return { from, to, interval, spanMs: to.getTime() - from.getTime() };
}

function truncate(date: Date, unit: Interval): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (unit === 'month') d.setUTCDate(1);
  if (unit === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
  return d;
}

function step(date: Date, unit: Interval): Date {
  const d = new Date(date);
  if (unit === 'day') d.setUTCDate(d.getUTCDate() + 1);
  if (unit === 'week') d.setUTCDate(d.getUTCDate() + 7);
  if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Emits every bucket in the range so charts show zero-value periods instead of gaps. */
function fillSeries(rows: { _id: Date; count: number }[], from: Date, to: Date, unit: Interval) {
  const byKey = new Map(rows.map((r) => [new Date(r._id).toISOString(), r.count]));
  const series: { date: string; count: number }[] = [];
  for (let cursor = truncate(from, unit); cursor <= to; cursor = step(cursor, unit)) {
    const key = cursor.toISOString();
    series.push({ date: key, count: byKey.get(key) ?? 0 });
  }
  return series;
}

const toCounts = <K extends string>(rows: CountRow[], key: K) =>
  rows.map((r) => ({ [key]: r._id, count: r.count }) as Record<K, string> & { count: number });

/**
 * All dashboard numbers in a handful of index-backed queries that run in parallel.
 * The heavy lifting is a single `$facet` pass over the patients in range.
 */
export async function getOverview(q: OverviewQuery) {
  const { from, to, interval, spanMs } = resolveRange(q);
  const inRange = { admissionDate: dateRange(from, to)! };
  const previousRange = { admissionDate: { $gte: new Date(from.getTime() - spanMs), $lt: from } };
  const timeBucket = { $dateTrunc: { date: '$admissionDate', unit: interval, startOfWeek: 'monday', timezone: 'UTC' } };

  const [totalDoctors, totalPatients, previousPeriodPatients, newDoctors, doctorFacets, patientFacets] =
    await Promise.all([
      DoctorModel.estimatedDocumentCount(),
      PatientModel.estimatedDocumentCount(),
      PatientModel.countDocuments(previousRange),
      DoctorModel.countDocuments({ createdAt: dateRange(from, to) }),
      DoctorModel.aggregate<{ bySpecialization: CountRow[] }>([
        {
          $facet: {
            bySpecialization: [
              { $group: { _id: '$specialization', count: { $sum: 1 } } },
              { $sort: { count: -1, _id: 1 } },
            ],
          },
        },
      ]),
      PatientModel.aggregate<{
        total: { n: number }[];
        timeline: { _id: Date; count: number }[];
        byCondition: CountRow[];
        byStatus: CountRow[];
        byGender: CountRow[];
        byAgeGroup: { _id: number | string; count: number }[];
        topDoctors: { _id: unknown; count: number; critical: number; doctor: { name: string; specialization: string } }[];
      }>([
        { $match: inRange },
        {
          $facet: {
            total: [{ $count: 'n' }],
            timeline: [{ $group: { _id: timeBucket, count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
            byCondition: [{ $group: { _id: '$condition', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
            byGender: [{ $group: { _id: '$gender', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
            byAgeGroup: [
              { $bucket: { groupBy: '$age', boundaries: [0, 18, 30, 45, 60, 75], default: 75, output: { count: { $sum: 1 } } } },
            ],
            topDoctors: [
              {
                $group: {
                  _id: '$doctor',
                  count: { $sum: 1 },
                  critical: { $sum: { $cond: [{ $eq: ['$status', 'Critical'] }, 1, 0] } },
                },
              },
              { $sort: { count: -1 } },
              { $limit: 10 },
              // Lookup runs only for the 10 winners, never for every patient.
              {
                $lookup: {
                  from: 'doctors',
                  localField: '_id',
                  foreignField: '_id',
                  pipeline: [{ $project: { name: 1, specialization: 1 } }],
                  as: 'doctor',
                },
              },
              { $unwind: '$doctor' },
            ],
          },
        },
      ]),
    ]);

  const p = patientFacets[0]!;
  const patientsInRange = p.total[0]?.n ?? 0;
  const ageLabels: Record<string, string> = { 0: '0–17', 18: '18–29', 30: '30–44', 45: '45–59', 60: '60–74', 75: '75+' };

  return {
    range: { from: from.toISOString(), to: to.toISOString(), interval },
    totals: {
      doctors: totalDoctors,
      patients: totalPatients,
      avgPatientsPerDoctor: totalDoctors ? Math.round((totalPatients / totalDoctors) * 10) / 10 : 0,
      patientsInRange,
      previousPeriodPatients,
      patientsChangePct: previousPeriodPatients
        ? Math.round(((patientsInRange - previousPeriodPatients) / previousPeriodPatients) * 1000) / 10
        : null,
      newDoctorsInRange: newDoctors,
      criticalInRange: p.byStatus.find((s) => s._id === 'Critical')?.count ?? 0,
    },
    patientsOverTime: fillSeries(p.timeline, from, to, interval),
    patientsPerDoctor: p.topDoctors.map((d) => ({
      doctorId: String(d._id),
      name: d.doctor.name,
      specialization: d.doctor.specialization,
      count: d.count,
      critical: d.critical,
    })),
    byCondition: toCounts(p.byCondition, 'condition'),
    byStatus: toCounts(p.byStatus, 'status'),
    byGender: toCounts(p.byGender, 'gender'),
    byAgeGroup: p.byAgeGroup.map((b) => ({ group: ageLabels[String(b._id)] ?? String(b._id), count: b.count })),
    doctorsBySpecialization: toCounts(doctorFacets[0]?.bySpecialization ?? [], 'specialization'),
  };
}
