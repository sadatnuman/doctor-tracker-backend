import { GENDERS, PATIENT_CONDITIONS, PATIENT_STATUSES, SPECIALIZATIONS } from '../config/constants.js';
import { DoctorModel } from '../models/doctor.model.js';

/** Options for filter dropdowns and form selects. `distinct` is served from the indexes. */
export async function getFilterOptions() {
  const [specializations, hospitals] = await Promise.all([
    DoctorModel.distinct('specialization'),
    DoctorModel.distinct('hospital'),
  ]);
  const sorted = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
  return {
    specializations: sorted([...SPECIALIZATIONS, ...specializations]),
    hospitals: sorted(hospitals),
    conditions: PATIENT_CONDITIONS,
    statuses: PATIENT_STATUSES,
    genders: GENDERS,
  };
}
