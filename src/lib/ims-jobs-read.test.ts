import { describe, it, expect } from 'vitest';
import {
  PUBLIC_JOB_COLUMNS,
  INTERNAL_JOB_COLUMNS,
  specialtyLabel,
  facilityHeadline,
  bodyParts,
  cardTitle,
  type JobRow,
} from './ims-jobs-read';

describe('privacy contract', () => {
  it('public allowlist contains no internal column', () => {
    const cols = PUBLIC_JOB_COLUMNS.split(',').map((c) => c.trim());
    for (const internal of INTERNAL_JOB_COLUMNS) {
      expect(cols).not.toContain(internal);
    }
  });

  it('allowlist is exactly the agreed public set', () => {
    expect(PUBLIC_JOB_COLUMNS.split(',').map((c) => c.trim()).sort()).toEqual(
      [
        'id', 'specialty_slug', 'specialty_name', 'facility_state',
        'facility_city', 'public_facility_label', 'length_category',
        'call_type', 'coverage_type',
      ].sort(),
    );
  });

  it('view helpers never surface an internal facility name', () => {
    const row: JobRow = {
      id: 'a1', specialty_slug: 'crna', specialty_name: 'CRNA',
      facility_state: 'OH', facility_city: 'Cincinnati',
      public_facility_label: 'Level 1 Trauma Center',
      length_category: 'medium', call_type: 'No call', coverage_type: 'Vacation',
    };
    const rendered = [
      facilityHeadline(row), bodyParts(row), cardTitle(row),
      specialtyLabel(row.specialty_slug),
    ].join(' | ');
    expect(rendered).toContain('Level 1 Trauma Center');
    expect(rendered).not.toMatch(/Mercy|Hospital A|555-|raw_payload/i);
  });
});
