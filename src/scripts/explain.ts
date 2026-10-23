/**
 * Prints the winning query plan for the main list/search/filter queries so you
 * can confirm they are index scans (IXSCAN) rather than collection scans.
 *   npm run explain
 */
import type { Model } from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { DoctorModel } from '../models/doctor.model.js';
import { PatientModel } from '../models/patient.model.js';
import { prefixRegex } from '../utils/query.js';

type Plan = { stage?: string; indexName?: string; inputStage?: Plan; inputStages?: Plan[] };

function describe(plan: Plan): string {
  const children = plan.inputStages ?? (plan.inputStage ? [plan.inputStage] : []);
  const self = plan.stage === 'IXSCAN' ? `IXSCAN(${plan.indexName})` : (plan.stage ?? '?');
  return children.length ? `${self} ← ${children.map(describe).join(' + ')}` : self;
}

async function explain(label: string, model: Model<any>, filter: object, sort: Record<string, 1 | -1>) {
  const result = (await model.find(filter).sort(sort).limit(10).explain('executionStats')) as any;
  const stats = result.executionStats;
  console.log(
    `${label.padEnd(44)} ${describe(result.queryPlanner.winningPlan.queryPlan ?? result.queryPlanner.winningPlan)}\n` +
      `${''.padEnd(44)} docsExamined=${stats.totalDocsExamined} keysExamined=${stats.totalKeysExamined} returned=${stats.nReturned} ${stats.executionTimeMillis}ms\n`,
  );
}

async function main() {
  await connectDB();
  const doctor = await DoctorModel.findOne().lean();
  const lastMonth = { $gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) };

  await explain('Doctors: default list (newest first)', DoctorModel, {}, { createdAt: -1 });
  await explain('Doctors: search "dr. a"', DoctorModel, { $or: [{ nameLower: prefixRegex('dr. a') }, { email: prefixRegex('dr. a') }] }, { createdAt: -1 });
  await explain('Doctors: filter by specialization', DoctorModel, { specialization: 'Cardiology' }, { createdAt: -1 });
  await explain('Patients: default list (latest admission)', PatientModel, {}, { admissionDate: -1 });
  await explain('Patients: by doctor', PatientModel, { doctor: doctor?._id }, { admissionDate: -1 });
  await explain('Patients: condition filter', PatientModel, { condition: { $in: ['Asthma'] } }, { admissionDate: -1 });
  await explain('Patients: admission date range', PatientModel, { admissionDate: lastMonth }, { admissionDate: -1 });
  await explain('Patients: search "jo"', PatientModel, { $or: [{ nameLower: prefixRegex('jo') }, { email: prefixRegex('jo') }] }, { admissionDate: -1 });

  await disconnectDB();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDB();
  process.exit(1);
});
