import { describe, it, expect } from 'vitest';
import { mapLsAnalytics, normalizeLsKpis, emptyKpis, type LsResultSet } from './ls-analytics';

// Representative subset of a real LocumSmart Sisense pull (values verbatim from
// the 2026-06-09 snapshot), covering each parse branch: scalar widgets, a
// monthly series with a *1Month headline column, $-by-specialty, the transposed
// invoiced totals, scheduling coverage, and a non-numeric ('N\\A') cell.
const fixture: LsResultSet[] = [
  { datasource: 'Recruitment', measures: ['OpenRequests'], headers: ['OpenRequests'], rows: [[147]] },
  { datasource: 'Bid', measures: ['ActiveBids'], headers: ['ActiveBids'], rows: [[11]] },
  { datasource: 'InvoiceLineItem', measures: ['RejectedInvoices'], headers: ['RejectedInvoices'], rows: [[17]] },
  { datasource: 'Timesheet', measures: ['RejectedTimesheets'], headers: ['RejectedTimesheets'], rows: [[0]] },
  {
    datasource: 'Recruitment',
    measures: ['Months in Date', 'FillRate', 'VendorFillRate1Month'],
    headers: ['Months in Date', 'FillRate', 'VendorFillRate1Month', 'VendorFillRate13Month', 'YYVendorFillRate', 'YYUp', 'YYDown'],
    // Deliberately out of order to prove the series is sorted by month.
    rows: [
      ['2026-05-01T00:00:00', 0.02040816326530612, 0.04, 0.0416, -0.99, 0, 1],
      ['2025-05-01T00:00:00', 0.034722222222222224, 0.04, 0.0416, -0.99, 0, 1],
    ],
  },
  {
    datasource: 'InvoiceLineItem',
    measures: ['Specialty', 'Total Line Item Amount'],
    headers: ['Specialty', 'Total Line Item Amount'],
    rows: [
      ['Anesthesiology', 2606171.16],
      ['Nurse Anesthetist (CRNA)', 3608934.03],
    ],
  },
  {
    datasource: 'InvoiceLineItem',
    measures: ['YYUp', 'YYDown', 'InvoicedThisYear', 'InvoicedPreviousYear', 'YYInvoiced'],
    headers: ['YYUp', 'YYDown', 'InvoicedThisYear', 'InvoicedPreviousYear', 'YYInvoiced'],
    rows: [[0], [1], [7182539.19], [8391223.64], [-0.14404150034059904]],
  },
  {
    datasource: 'Scheduling',
    measures: ['Months in Date', 'ConfirmedShifts', 'ConfirmedShiftsTotal', 'TargetedShifts', 'TargetedPercentage'],
    headers: ['Months in Date', 'ConfirmedShifts', 'ConfirmedShiftsTotal', 'TargetedShifts', 'TargetedPercentage'],
    rows: [
      ['2026-06-01T00:00:00', 4, 798, 767, 0.9611528822055138],
      ['2027-01-01T00:00:00', 'N\\A', 798, 767, 0.9611528822055138],
    ],
  },
];

describe('mapLsAnalytics', () => {
  const k = mapLsAnalytics(fixture, '2026-06-09T14:46:53.706Z');

  it('passes through capturedAt and scalar KPIs verbatim', () => {
    expect(k.capturedAt).toBe('2026-06-09T14:46:53.706Z');
    expect(k.openRequests).toBe(147);
    expect(k.activeBids).toBe(11);
    expect(k.rejectedInvoices).toBe(17);
    expect(k.rejectedTimesheets).toBe(0);
  });

  it('builds a month-sorted series with the latest value and the *1Month headline', () => {
    expect(k.fillRate.series.map((p) => p.month)).toEqual(['2025-05', '2026-05']);
    expect(k.fillRate.latestMonth).toBe('2026-05');
    expect(k.fillRate.latest).toBeCloseTo(0.0204081, 6);
    expect(k.fillRate.oneMonth).toBe(0.04);
  });

  it('returns an empty KPI for a measure absent from the pull (never fabricates)', () => {
    expect(k.bidAcceptance.series).toEqual([]);
    expect(k.bidAcceptance.latest).toBeNull();
    expect(k.bidAcceptance.oneMonth).toBeNull();
  });

  it('sorts $-by-specialty descending', () => {
    expect(k.revenueBySpecialty[0]).toEqual({ name: 'Nurse Anesthetist (CRNA)', amount: 3608934.03 });
    expect(k.revenueBySpecialty[1]).toEqual({ name: 'Anesthesiology', amount: 2606171.16 });
  });

  it('reads the transposed invoiced totals + YoY', () => {
    expect(k.invoicedThisYear).toBe(7182539.19);
    expect(k.invoicedPrevYear).toBe(8391223.64);
    expect(k.invoicedYoY).toBeCloseTo(-0.1440415, 6);
  });

  it('reads scheduling coverage', () => {
    expect(k.scheduling).not.toBeNull();
    expect(k.scheduling!.confirmedTotal).toBe(798);
    expect(k.scheduling!.targeted).toBe(767);
    expect(k.scheduling!.targetedPct).toBeCloseTo(0.96115, 5);
  });

  it('coerces non-numeric / missing cells to null and never throws on empty input', () => {
    const empty = mapLsAnalytics([], '2026-06-09T00:00:00.000Z');
    expect(empty.openRequests).toBeNull();
    expect(empty.fillRate.series).toEqual([]);
    expect(empty.revenueBySpecialty).toEqual([]);
    expect(empty.scheduling).toBeNull();
    expect(empty.invoicedThisYear).toBeNull();
  });
});

describe('mapLsAnalytics — bulletproofing', () => {
  it('never throws on non-array / undefined input; returns a complete empty shape', () => {
    const a = mapLsAnalytics(undefined as unknown as LsResultSet[], '2026-06-09');
    expect(a).toEqual(emptyKpis('2026-06-09'));
  });

  it('tolerates malformed/null result sets without throwing, still parsing good ones', () => {
    const junk = [
      null,
      { datasource: 'x', measures: [], headers: null, rows: null },
      { headers: ['OpenRequests'], rows: [[147]] },
      { headers: ['Months in Date', 'FillRate', 'VendorFillRate1Month'], rows: [['nope', 'x', null], null] },
    ] as unknown as LsResultSet[];
    const a = mapLsAnalytics(junk, 'c');
    expect(a.openRequests).toBe(147); // good set still parsed despite the null entry
    expect(a.fillRate.series).toEqual([]); // 'nope' isn't a date -> skipped, no throw
  });

  it('reads the columnar invoiced layout (single row, measures as columns)', () => {
    const sets: LsResultSet[] = [{
      datasource: 'InvoiceLineItem',
      measures: ['YYUp', 'YYDown', 'InvoicedThisYear', 'InvoicedPreviousYear', 'YYInvoiced'],
      headers: ['YYUp', 'YYDown', 'InvoicedThisYear', 'InvoicedPreviousYear', 'YYInvoiced'],
      rows: [[0, 1, 7182539.19, 8391223.64, -0.144]],
    }];
    const a = mapLsAnalytics(sets, 'c');
    expect(a.invoicedThisYear).toBe(7182539.19);
    expect(a.invoicedPrevYear).toBe(8391223.64);
  });
});

describe('normalizeLsKpis (read-side guard)', () => {
  it('returns a complete empty shape for non-object input', () => {
    expect(normalizeLsKpis(null)).toEqual(emptyKpis(''));
    expect(normalizeLsKpis('oops', 'cap').capturedAt).toBe('cap');
    expect(normalizeLsKpis(42).fillRate.series).toEqual([]);
  });

  it('fills missing fields and coerces wrong types, keeping the valid data', () => {
    const n = normalizeLsKpis({
      capturedAt: '2026-06-09',
      openRequests: 147,
      activeBids: 'not-a-number',
      fillRate: { latestMonth: '2026-05', latest: 0.02, oneMonth: 0.04, series: [{ month: '2026-05', value: 0.02 }, { month: 7, value: 1 }, null] },
      revenueBySpecialty: [{ name: 'CRNA', amount: 100 }, { name: 5, amount: 1 }, { amount: 2 }],
      scheduling: { confirmedTotal: 798 },
    });
    expect(n.openRequests).toBe(147);
    expect(n.activeBids).toBeNull();
    expect(n.bidAcceptance.series).toEqual([]);
    expect(n.fillRate.latest).toBe(0.02);
    expect(n.fillRate.series).toEqual([{ month: '2026-05', value: 0.02 }]);
    expect(n.revenueBySpecialty).toEqual([{ name: 'CRNA', amount: 100 }]);
    expect(n.scheduling).toEqual({ confirmedTotal: 798, targeted: null, targetedPct: null });
  });

  it('round-trips a real mapLsAnalytics output unchanged', () => {
    const mapped = mapLsAnalytics(fixture, '2026-06-09T14:46:53.706Z');
    expect(normalizeLsKpis(mapped)).toEqual(mapped);
  });
});
