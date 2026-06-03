import { describe, it, expect } from 'vitest';
import {
  constantTimeEquals,
  deriveStatus,
  normalizeSpecialtySlug,
  derivePublicFacilityLabel,
  deriveDurationDisplay,
  nullifyDot,
  mapToImsJobsRow,
  validatePayloadShape,
  redactPayloadForStorage,
  evaluateFreshness,
  type LSWebhookPayload,
} from './locumsmart-webhook-logic';

// Synthetic test fixture modeled on the LS webhook payload shape captured
// 2026-05-08 from a temporary webhook.site subscription. Field shapes mirror
// the real payload but every UUID and the `key` field have been replaced
// with non-production values so this fixture cannot be used to forge a
// webhook against any live LS subscription.
const SAMPLE_PAYLOAD: LSWebhookPayload = {
  assignmentId: '00000000-0000-4000-8000-000000000001',
  assignmentNumber: 'A-TESTC-260508-00001',
  details: {
    assignmentId: '00000000-0000-4000-8000-000000000001',
    assignmentNumber: 'A-TESTC-260508-00001',
    status: 'Canceled',
    organizationId: '00000000-0000-4000-8000-000000000010',
    organization: 'Test Healthcare Corporation',
    facilities: [
      {
        facilityId: '00000000-0000-4000-8000-000000000020',
        facility: 'Test Medical Center',
        facilityCity: 'Test City',
        facilityState: 'FL',
        facilityZip: '00000',
        facilityTimeZone: 'Eastern',
        facilityMappingTimeZoneId: 'America/New_York',
        holidaysAllowed: ["New Year's Day", 'Memorial Day', '4th of July'],
      },
    ],
    providerType: 'Physician',
    specialties: [
      {
        specialtyId: '00000000-0000-4000-8000-000000000030',
        specialtyName: 'Interventional Neurology',
      },
    ],
    numProvidersRequested: 1,
    startDate: '2026-05-15',
    endDate: '2026-05-17',
    approximateDecisionDate: null,
    description: 'ER On Call Coverage dates needed',
    emrSystem: 'Cerner',
    requestType: 'Locum Tenens',
    coverageType: 'Call Only',
    coverageReason: 'Scheduling Need',
    callType: 'Beeper',
    callResponseTimeRequired: '.',
    callRatio: '.',
    practiceSetting: 'Inpatient',
    boardCertificationRequired: true,
    boardCertificationMinimum: 'Certified',
    fellowship: 'Required',
    requireBls: false,
    requireAcls: true,
    requireAtls: false,
    requirePals: false,
    requireAbls: false,
    requireOther: false,
    otherCertDetails: null,
    traumaLevel: 1,
    pedsLevel: 0,
    providerLicenseRequirement: 'Licensed in FL',
    estimatedCredentialingTime: '5',
    supervisionRequired: false,
    superviseOtherProviders: false,
    patientEncountersPerShift: 'tbd',
    temporaryPrivilegesAvailable: true,
    requireHospitalPrivileges: 'No',
    nearestAirport: null,
    createDate: '2026-05-08T16:19:54Z',
    lastModified: '2026-05-08T18:50:47Z',
  },
  key: 'TEST_KEY_NOT_A_REAL_LS_SECRET',
  operation: 'Cancel',
  message: 'Assignment Archived (Cancelled)',
};

describe('constantTimeEquals', () => {
  it('returns true for equal non-empty strings', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true);
  });
  it('returns false for non-equal same-length strings', () => {
    expect(constantTimeEquals('abc123', 'abc124')).toBe(false);
  });
  it('returns false for different-length strings', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });
  it('returns true for two empty strings', () => {
    expect(constantTimeEquals('', '')).toBe(true);
  });
  it('returns false when one input is not a string', () => {
    expect(constantTimeEquals('abc', 123 as unknown as string)).toBe(false);
    expect(constantTimeEquals(undefined as unknown as string, 'abc')).toBe(false);
    expect(constantTimeEquals(null as unknown as string, null as unknown as string)).toBe(false);
  });
  it('handles full LS-shaped Webhook Key length (48 chars, synthetic)', () => {
    // 48-char synthetic key matching the LS Webhook Key length (base64-UUID).
    // NOT a real subscription key.
    const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(key.length).toBe(48);
    expect(constantTimeEquals(key, key)).toBe(true);
    expect(constantTimeEquals(key, key.slice(0, -1) + 'X')).toBe(false);
  });
});

describe('deriveStatus', () => {
  it('maps Receive to active', () => {
    expect(deriveStatus('Receive')).toBe('active');
  });
  it('maps Update to active', () => {
    expect(deriveStatus('Update')).toBe('active');
  });
  it('maps Cancel to archived', () => {
    expect(deriveStatus('Cancel')).toBe('archived');
  });
  it('maps Archive to archived', () => {
    expect(deriveStatus('Archive')).toBe('archived');
  });
  it('is case-insensitive', () => {
    expect(deriveStatus('cancel')).toBe('archived');
    expect(deriveStatus('CANCEL')).toBe('archived');
  });
  it('treats hypothetical Close as archived', () => {
    expect(deriveStatus('Closed')).toBe('archived');
  });
  it('defaults unknown operations to active (do-no-harm bias for /jobs visibility)', () => {
    expect(deriveStatus('SomethingNew')).toBe('active');
  });
  it('returns active for null/empty operation', () => {
    expect(deriveStatus(null)).toBe('active');
    expect(deriveStatus('')).toBe('active');
    expect(deriveStatus(undefined)).toBe('active');
  });
});

describe('normalizeSpecialtySlug', () => {
  it('matches CRNA before generic anesthesia', () => {
    expect(normalizeSpecialtySlug('CRNA')).toBe('crna');
    expect(normalizeSpecialtySlug('Certified Registered Nurse Anesthetist')).toBe('crna');
  });
  it('matches anesthesiology variants', () => {
    expect(normalizeSpecialtySlug('Anesthesiology')).toBe('anesthesiology');
    expect(normalizeSpecialtySlug('General Anesthesia')).toBe('anesthesiology');
  });
  it('matches hospitalist', () => {
    expect(normalizeSpecialtySlug('Hospitalist')).toBe('hospitalist');
    expect(normalizeSpecialtySlug('Hospital Medicine')).toBe('hospitalist');
  });
  it('matches emergency-medicine', () => {
    expect(normalizeSpecialtySlug('Emergency Medicine')).toBe('emergency-medicine');
  });
  it('matches family-medicine', () => {
    expect(normalizeSpecialtySlug('Family Medicine')).toBe('family-medicine');
  });
  it('matches psychiatry', () => {
    expect(normalizeSpecialtySlug('Psychiatry')).toBe('psychiatry');
    expect(normalizeSpecialtySlug('Adolescent Psychiatry')).toBe('psychiatry');
  });
  it('matches ob-gyn variants', () => {
    expect(normalizeSpecialtySlug('OB/GYN')).toBe('ob-gyn');
    expect(normalizeSpecialtySlug('Obstetrics')).toBe('ob-gyn');
    expect(normalizeSpecialtySlug('Gynecology')).toBe('ob-gyn');
  });
  it('matches general-surgery', () => {
    expect(normalizeSpecialtySlug('General Surgery')).toBe('general-surgery');
  });
  it('matches radiology', () => {
    expect(normalizeSpecialtySlug('Radiology')).toBe('radiology');
  });
  it('matches pediatrics', () => {
    expect(normalizeSpecialtySlug('Pediatrics')).toBe('pediatrics');
    expect(normalizeSpecialtySlug('Pediatric Cardiology')).toBe('pediatrics');
  });
  it('matches cardiology', () => {
    expect(normalizeSpecialtySlug('Cardiology')).toBe('cardiology');
    // 'Cardiac Surgery' intentionally hits the surgery branch first: IMS has
    // no cardiac-surgery bucket, and cardiac surgeons aren't cardiologists
    // clinically, so general-surgery is the pragmatic bucket. Pure 'Cardiac'
    // still falls through to cardiology.
    expect(normalizeSpecialtySlug('Cardiac Surgery')).toBe('general-surgery');
    expect(normalizeSpecialtySlug('Cardiac Catheterization')).toBe('cardiology');
  });
  it('matches neurology including the captured payload value', () => {
    expect(normalizeSpecialtySlug('Neurology')).toBe('neurology');
    expect(normalizeSpecialtySlug('Interventional Neurology')).toBe('neurology');
  });
  it('falls through to other for unknown specialties', () => {
    expect(normalizeSpecialtySlug('Nephrology')).toBe('other');
    expect(normalizeSpecialtySlug('Dermatology')).toBe('other');
  });
  it('returns other for null or empty', () => {
    expect(normalizeSpecialtySlug(null)).toBe('other');
    expect(normalizeSpecialtySlug(undefined)).toBe('other');
    expect(normalizeSpecialtySlug('')).toBe('other');
  });
});

describe('derivePublicFacilityLabel', () => {
  it('uses trauma level when present and 1-5', () => {
    expect(derivePublicFacilityLabel({ traumaLevel: 1 })).toBe('Level 1 Trauma Center');
    expect(derivePublicFacilityLabel({ traumaLevel: 3 })).toBe('Level 3 Trauma Center');
  });
  it('ignores trauma level 0 (not a real trauma center designation)', () => {
    expect(derivePublicFacilityLabel({ traumaLevel: 0, practiceSetting: 'Inpatient' })).toBe('Hospital');
  });
  it('maps inpatient single-facility to Hospital', () => {
    expect(derivePublicFacilityLabel({ practiceSetting: 'Inpatient', facilities: [{ facility: 'X' }] })).toBe('Hospital');
  });
  it('maps inpatient multi-facility to Multi-Site Health System', () => {
    expect(derivePublicFacilityLabel({
      practiceSetting: 'Inpatient',
      facilities: [{ facility: 'X' }, { facility: 'Y' }],
    })).toBe('Multi-Site Health System');
  });
  it('maps outpatient single to Outpatient Surgery Center', () => {
    expect(derivePublicFacilityLabel({ practiceSetting: 'Outpatient' })).toBe('Outpatient Surgery Center');
  });
  it('maps outpatient multi to Multi-Site Outpatient Network', () => {
    expect(derivePublicFacilityLabel({
      practiceSetting: 'Outpatient',
      facilities: [{ facility: 'X' }, { facility: 'Y' }],
    })).toBe('Multi-Site Outpatient Network');
  });
  it('maps a combined inpatient + outpatient setting to Medical Center', () => {
    // LS commonly sends "Inpatient, Outpatient" (a facility that does both).
    // Before, exact-string matching fell through to "Healthcare Facility".
    expect(derivePublicFacilityLabel({ practiceSetting: 'Inpatient, Outpatient' })).toBe('Medical Center');
    expect(derivePublicFacilityLabel({ practiceSetting: 'Outpatient, Inpatient' })).toBe('Medical Center');
  });
  it('keeps trauma-center precedence over a combined setting', () => {
    expect(derivePublicFacilityLabel({ practiceSetting: 'Inpatient, Outpatient', traumaLevel: 2 })).toBe('Level 2 Trauma Center');
  });
  it('maps a multi-facility combined setting to Multi-Site Health System', () => {
    expect(derivePublicFacilityLabel({
      practiceSetting: 'Outpatient, Inpatient',
      facilities: [{ facility: 'X' }, { facility: 'Y' }],
    })).toBe('Multi-Site Health System');
  });
  it('falls back to Healthcare Facility when no signal present', () => {
    expect(derivePublicFacilityLabel({})).toBe('Healthcare Facility');
    expect(derivePublicFacilityLabel(null)).toBe('Healthcare Facility');
    expect(derivePublicFacilityLabel(undefined)).toBe('Healthcare Facility');
  });
  it('always returns a non-null string so the active-row CHECK passes', () => {
    expect(typeof derivePublicFacilityLabel({})).toBe('string');
    expect(derivePublicFacilityLabel({})!.length).toBeGreaterThan(0);
  });
});

describe('deriveDurationDisplay', () => {
  it('returns Ongoing when end is null', () => {
    expect(deriveDurationDisplay('2026-05-15', null)).toBe('Ongoing');
    expect(deriveDurationDisplay('2026-05-15', undefined)).toBe('Ongoing');
  });
  it('returns null when start is missing', () => {
    expect(deriveDurationDisplay(null, '2026-05-17')).toBeNull();
    expect(deriveDurationDisplay(undefined, '2026-05-17')).toBeNull();
  });
  it('returns null for invalid dates', () => {
    expect(deriveDurationDisplay('not-a-date', '2026-05-17')).toBeNull();
    expect(deriveDurationDisplay('2026-05-15', 'not-a-date')).toBeNull();
  });
  it('returns null when end is before start (defensive — schema CHECK also catches this)', () => {
    expect(deriveDurationDisplay('2026-05-17', '2026-05-15')).toBeNull();
  });
  it('formats short ranges in days (inclusive count)', () => {
    expect(deriveDurationDisplay('2026-05-15', '2026-05-15')).toBe('1 day');
    expect(deriveDurationDisplay('2026-05-15', '2026-05-17')).toBe('3 days');
  });
  it('formats one-week range', () => {
    expect(deriveDurationDisplay('2026-05-15', '2026-05-21')).toBe('1 week');
  });
  it('formats multi-week range', () => {
    expect(deriveDurationDisplay('2026-05-15', '2026-06-05')).toBe('3 weeks');
  });
  it('formats month-scale range', () => {
    expect(deriveDurationDisplay('2026-05-15', '2026-08-15')).toMatch(/months$/);
  });
  it('formats year-scale range', () => {
    expect(deriveDurationDisplay('2026-05-15', '2027-05-15')).toBe('1 year');
    expect(deriveDurationDisplay('2026-05-15', '2028-05-15')).toBe('2 years');
  });
});

describe('nullifyDot', () => {
  it('returns null for null/undefined', () => {
    expect(nullifyDot(null)).toBeNull();
    expect(nullifyDot(undefined)).toBeNull();
  });
  it('returns null for empty / whitespace / dot', () => {
    expect(nullifyDot('')).toBeNull();
    expect(nullifyDot('   ')).toBeNull();
    expect(nullifyDot('.')).toBeNull();
    expect(nullifyDot(' . ')).toBeNull();
  });
  it('passes through real values unchanged', () => {
    expect(nullifyDot('5')).toBe('5');
    expect(nullifyDot('2:1')).toBe('2:1');
    expect(nullifyDot('tbd')).toBe('tbd');
  });
});

describe('validatePayloadShape', () => {
  it('accepts the captured sample payload', () => {
    expect(validatePayloadShape(SAMPLE_PAYLOAD).ok).toBe(true);
  });
  it('rejects non-object input', () => {
    expect(validatePayloadShape(null).ok).toBe(false);
    expect(validatePayloadShape('string').ok).toBe(false);
    expect(validatePayloadShape([]).ok).toBe(false);
  });
  it('rejects missing assignmentId', () => {
    const p = { ...SAMPLE_PAYLOAD, assignmentId: '' };
    expect(validatePayloadShape(p).ok).toBe(false);
  });
  it('rejects missing operation', () => {
    const p = { ...SAMPLE_PAYLOAD, operation: '' };
    expect(validatePayloadShape(p).ok).toBe(false);
  });
  it('rejects missing key', () => {
    const p = { ...SAMPLE_PAYLOAD, key: '' };
    expect(validatePayloadShape(p).ok).toBe(false);
  });
  it('rejects missing details object', () => {
    const p = { ...SAMPLE_PAYLOAD, details: null as unknown as Record<string, unknown> };
    expect(validatePayloadShape(p).ok).toBe(false);
  });
});

describe('mapToImsJobsRow', () => {
  it('maps the captured payload end-to-end', () => {
    const row = mapToImsJobsRow(SAMPLE_PAYLOAD);

    // Identity
    expect(row.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(row.assignment_number).toBe('A-TESTC-260508-00001');
    expect(row.status).toBe('archived'); // Cancel operation -> archived
    expect(row.ls_status).toBe('Canceled');
    expect(row.ls_operation).toBe('Cancel');

    // Organization & facility (INTERNAL)
    expect(row.organization).toBe('Test Healthcare Corporation');
    expect(row.organization_id).toBe('00000000-0000-4000-8000-000000000010');
    expect(row.facility_name).toBe('Test Medical Center');
    expect(row.facility_names).toEqual(['Test Medical Center']);
    expect(row.facility_city).toBe('Test City');
    expect(row.facility_state).toBe('FL');
    expect(row.facility_timezone).toBe('Eastern');
    expect(row.facility_mapping_timezone_id).toBe('America/New_York');
    expect(row.holidays_allowed).toEqual(["New Year's Day", 'Memorial Day', '4th of July']);

    // Public boundary. facility_name_public + public_description are
    // intentionally absent from the row so they survive recruiter dashboard
    // edits across LS retries (see ImsJobsRow type docstring).
    expect(row.public_facility_label).toBe('Level 1 Trauma Center'); // traumaLevel=1 wins
    expect('facility_name_public' in row).toBe(false);
    expect('public_description' in row).toBe(false);

    // Specialty
    expect(row.specialty_id).toBe('00000000-0000-4000-8000-000000000030');
    expect(row.specialty_name).toBe('Interventional Neurology');
    expect(row.specialty_slug).toBe('neurology');

    // Dates + duration
    expect(row.start_date).toBe('2026-05-15');
    expect(row.end_date).toBe('2026-05-17');
    expect(row.duration_display).toBe('3 days');

    // Schedule
    expect(row.coverage_type).toBe('Call Only');
    expect(row.call_type).toBe('Beeper');
    expect(row.call_response_time_required).toBeNull(); // dot nullified
    expect(row.call_ratio).toBeNull(); // dot nullified
    expect(row.practice_setting).toBe('Inpatient');

    // Requirements
    expect(row.board_certification_required).toBe(true);
    expect(row.fellowship).toBe('Required');
    expect(row.require_acls).toBe(true);
    expect(row.require_bls).toBe(false);
    expect(row.trauma_level).toBe(1);
    expect(row.peds_level).toBe(0);

    // Ops
    expect(row.estimated_credentialing_time).toBe('5');
    expect(row.patient_encounters_per_shift).toBe('tbd');
    expect(row.nearest_airport).toBeNull();

    // Timestamps
    expect(row.ls_create_date).toBe('2026-05-08T16:19:54Z');
    expect(row.ls_last_modified).toBe('2026-05-08T18:50:47Z');
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Audit. raw_payload contains the LS payload but the bearer secret is
    // redacted before storage (see redactPayloadForStorage).
    expect(row.raw_payload).not.toBe(SAMPLE_PAYLOAD); // distinct object — modification was applied
    expect(row.raw_payload.assignmentId).toBe(SAMPLE_PAYLOAD.assignmentId);
    expect(row.raw_payload.operation).toBe(SAMPLE_PAYLOAD.operation);
    expect(row.raw_payload.key).toBe('[REDACTED]');
    expect(row.raw_payload.key).not.toBe(SAMPLE_PAYLOAD.key);
  });

  it('maps a Receive operation to status=active', () => {
    const p: LSWebhookPayload = { ...SAMPLE_PAYLOAD, operation: 'Receive' };
    expect(mapToImsJobsRow(p).status).toBe('active');
  });

  it('maps an Update operation to status=active', () => {
    const p: LSWebhookPayload = { ...SAMPLE_PAYLOAD, operation: 'Update' };
    expect(mapToImsJobsRow(p).status).toBe('active');
  });

  it('handles missing facilities array gracefully', () => {
    const p: LSWebhookPayload = {
      ...SAMPLE_PAYLOAD,
      details: { ...SAMPLE_PAYLOAD.details, facilities: [] },
    };
    const row = mapToImsJobsRow(p);
    expect(row.facility_name).toBeNull();
    expect(row.facility_names).toBeNull();
    expect(row.facility_city).toBeNull();
    // public_facility_label still derives from traumaLevel/setting
    expect(row.public_facility_label).toBe('Level 1 Trauma Center');
  });

  it('handles missing specialties array gracefully', () => {
    const p: LSWebhookPayload = {
      ...SAMPLE_PAYLOAD,
      details: { ...SAMPLE_PAYLOAD.details, specialties: [] },
    };
    const row = mapToImsJobsRow(p);
    expect(row.specialty_id).toBeNull();
    expect(row.specialty_name).toBeNull();
    expect(row.specialty_slug).toBe('other'); // fallback satisfies active-row CHECK
  });
});

describe('redactPayloadForStorage', () => {
  it('replaces the key field with REDACTED marker', () => {
    const out = redactPayloadForStorage(SAMPLE_PAYLOAD);
    expect(out.key).toBe('[REDACTED]');
  });
  it('preserves all other top-level fields', () => {
    const out = redactPayloadForStorage(SAMPLE_PAYLOAD);
    expect(out.assignmentId).toBe(SAMPLE_PAYLOAD.assignmentId);
    expect(out.assignmentNumber).toBe(SAMPLE_PAYLOAD.assignmentNumber);
    expect(out.operation).toBe(SAMPLE_PAYLOAD.operation);
    expect(out.message).toBe(SAMPLE_PAYLOAD.message);
    expect(out.details).toEqual(SAMPLE_PAYLOAD.details);
  });
  it('does not mutate the input payload', () => {
    const before = SAMPLE_PAYLOAD.key;
    redactPayloadForStorage(SAMPLE_PAYLOAD);
    expect(SAMPLE_PAYLOAD.key).toBe(before); // input is untouched
  });
});

describe('evaluateFreshness', () => {
  it('applies when no stored row exists', () => {
    expect(evaluateFreshness({
      incomingLsLastModified: '2026-05-08T18:00:00Z',
      incomingStatus: 'active',
      storedLsLastModified: null,
      storedStatus: null,
    })).toEqual({ apply: true });
  });
  it('applies when incoming is strictly newer', () => {
    expect(evaluateFreshness({
      incomingLsLastModified: '2026-05-08T19:00:00Z',
      incomingStatus: 'active',
      storedLsLastModified: '2026-05-08T18:00:00Z',
      storedStatus: 'active',
    })).toEqual({ apply: true });
  });
  it('skips when incoming is strictly older (stale event)', () => {
    expect(evaluateFreshness({
      incomingLsLastModified: '2026-05-08T17:00:00Z',
      incomingStatus: 'active',
      storedLsLastModified: '2026-05-08T18:00:00Z',
      storedStatus: 'archived',
    })).toEqual({ apply: false, reason: 'stale' });
  });
  it('archived dominates active on same-timestamp tie', () => {
    expect(evaluateFreshness({
      incomingLsLastModified: '2026-05-08T18:00:00Z',
      incomingStatus: 'active',
      storedLsLastModified: '2026-05-08T18:00:00Z',
      storedStatus: 'archived',
    })).toEqual({ apply: false, reason: 'tie-archived-wins' });
  });
  it('applies when incoming is archived on same-timestamp tie (terminal events overwrite)', () => {
    expect(evaluateFreshness({
      incomingLsLastModified: '2026-05-08T18:00:00Z',
      incomingStatus: 'archived',
      storedLsLastModified: '2026-05-08T18:00:00Z',
      storedStatus: 'active',
    })).toEqual({ apply: true });
  });
  it('applies when incoming has no timestamp (skip the check rather than drop the event)', () => {
    expect(evaluateFreshness({
      incomingLsLastModified: null,
      incomingStatus: 'active',
      storedLsLastModified: '2026-05-08T18:00:00Z',
      storedStatus: 'archived',
    })).toEqual({ apply: true });
  });
  it('applies when timestamps fail to parse (defensive)', () => {
    expect(evaluateFreshness({
      incomingLsLastModified: 'not-a-date',
      incomingStatus: 'active',
      storedLsLastModified: '2026-05-08T18:00:00Z',
      storedStatus: 'archived',
    })).toEqual({ apply: true });
  });
});
