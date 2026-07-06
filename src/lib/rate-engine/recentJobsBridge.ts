// ⚠ CANONICAL LIVE COPY. This is the rate engine imstaffing.ai/hub serves; edit it here. The ias-dashboard twin is DEAD.
// Do NOT re-sync (scripts/sync-rate-engine.mjs is retired). Behavioral parity vs the frozen golden master: src/lib/hub/rate-engine-parity.test.ts.
import type { ParsedAssignment } from './types'

export interface FirebaseJob {
  requestNumber?: string
  specialty?: string
  status?: string
  hcoName?: string
  facilityName?: string
  facilityState?: string
  city?: string
  startDate?: string
  endDate?: string
  ongoing?: boolean | string
  startAsap?: boolean | string
  description?: string
  practiceSetting?: string
  callType?: string
  coverageType?: string
  scheduleDetails?: string
  created?: string
  _loggedAt?: string
}

function isTruthy(val: unknown): boolean {
  return val === true || String(val).toLowerCase() === 'true'
}

export function buildParsedFromJob(job: FirebaseJob): ParsedAssignment {
  const items: { label: string; value: string }[] = []
  if (job.practiceSetting) items.push({ label: 'Practice Setting', value: job.practiceSetting })
  if (job.callType) items.push({ label: 'Call Type', value: job.callType })
  if (job.coverageType) items.push({ label: 'Coverage Type', value: job.coverageType })
  if (job.scheduleDetails) items.push({ label: 'Schedule', value: job.scheduleDetails })

  return {
    assignmentNumber: job.requestNumber || '',
    specialty: job.specialty || '',
    status: job.status || '',
    hco: job.hcoName || '',
    startDate: job.startDate || '',
    endDate: job.endDate || (isTruthy(job.ongoing) ? 'Ongoing' : ''),
    facilities: [{ name: job.facilityName || '', state: job.facilityState || '', city: job.city || '' }],
    sections: items.length ? [{ title: 'Details', items }] : [],
    _rawText: job.description || '',
    _source: 'firebase',
  }
}
