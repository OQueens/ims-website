// Pure mapping for the LocumSmart Sisense KPI snapshot.
//
// The hub's `ims_ls_analytics` table stores the tidied `LsKpis` object this
// module produces from the raw JAQL result sets pulled from LocumSmart's OWN
// analytics (analytics.locumsmart.net). These are LS's own computed numbers —
// fill rate, bid-acceptance, speed-to-bid, market share, rejection rates,
// days-to-payment, $ invoiced, $ by specialty — surfaced verbatim. We do NOT
// re-derive any metric here (no fabrication); we only locate each measure in the
// result sets and reshape it for the Analytics view.
//
// Each Sisense KPI widget returns one result set: `headers` are the column
// titles and `rows` the values. A monthly-series widget carries the primary
// measure as a per-month column plus a constant `*1Month` "current period"
// column (LS's rolling headline figure) — we keep both: `series` (the per-month
// values) and `oneMonth` (LS's rolling number), and `latest` = the most recent
// month's value with its `latestMonth` label.

export interface LsResultSet {
  datasource: string;
  measures: string[];
  headers: string[] | null;
  rows: Array<Array<string | number | null>> | null;
  status?: number;
}

export interface LsSeriesPoint { month: string; value: number | null; }

export interface LsKpi {
  latestMonth: string | null; // 'YYYY-MM' of the most recent series point
  latest: number | null;      // value at latestMonth
  oneMonth: number | null;    // LS's rolling "current period" figure (the *1Month column)
  series: LsSeriesPoint[];     // trailing monthly values
}

export interface LsKpis {
  capturedAt: string;
  openRequests: number | null;
  activeBids: number | null;
  rejectedInvoices: number | null;
  rejectedTimesheets: number | null;
  fillRate: LsKpi;
  bidAcceptance: LsKpi;
  speedToBidHrs: LsKpi;
  marketShare: LsKpi;
  tsRejectRate: LsKpi;
  invRejectRate: LsKpi;
  daysToPayment: LsKpi;
  requestsReceived: LsKpi;
  providerCount: LsKpi;
  invoicedThisYear: number | null;
  invoicedPrevYear: number | null;
  invoicedYoY: number | null;
  revenueBySpecialty: Array<{ name: string; amount: number }>;
  scheduling: { confirmedTotal: number | null; targeted: number | null; targetedPct: number | null } | null;
}

const emptyKpi = (): LsKpi => ({ latestMonth: null, latest: null, oneMonth: null, series: [] });

/** A complete, all-null LsKpis (every field present) — the honest empty/error
 *  state. Keeping the full shape means the view can read any field without a
 *  guard, even when a pull failed or returned nothing. */
export const emptyKpis = (capturedAt = ''): LsKpis => ({
  capturedAt,
  openRequests: null,
  activeBids: null,
  rejectedInvoices: null,
  rejectedTimesheets: null,
  fillRate: emptyKpi(),
  bidAcceptance: emptyKpi(),
  speedToBidHrs: emptyKpi(),
  marketShare: emptyKpi(),
  tsRejectRate: emptyKpi(),
  invRejectRate: emptyKpi(),
  daysToPayment: emptyKpi(),
  requestsReceived: emptyKpi(),
  providerCount: emptyKpi(),
  invoicedThisYear: null,
  invoicedPrevYear: null,
  invoicedYoY: null,
  revenueBySpecialty: [],
  scheduling: null,
});

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Coerce a JAQL cell to a finite number, or null (handles 'N\\A', '', null). */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 'YYYY-MM' from a JAQL date cell like '2025-05-01T00:00:00'. */
function monthOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** Find the result set whose headers contain ALL of `needs` (order-independent).
 *  Null-safe: skips non-object / header-less entries rather than throwing. */
function findSet(sets: LsResultSet[], needs: string[]): LsResultSet | undefined {
  return sets.find((s) => {
    const h = s && Array.isArray(s.headers) ? s.headers : [];
    return needs.every((n) => h.includes(n));
  });
}

/** Build an LsKpi from a monthly-series set: month col + primary col + the
 *  constant `oneMonth` col. Returns EMPTY_KPI when the set/columns are absent. */
function seriesKpi(sets: LsResultSet[], monthCol: string, primaryCol: string, oneMonthCol: string): LsKpi {
  const set = findSet(sets, [monthCol, primaryCol, oneMonthCol]);
  if (!set || !set.headers || !Array.isArray(set.rows)) return emptyKpi();
  const mi = set.headers.indexOf(monthCol);
  const pi = set.headers.indexOf(primaryCol);
  const oi = set.headers.indexOf(oneMonthCol);
  const series: LsSeriesPoint[] = [];
  for (const row of set.rows) {
    if (!Array.isArray(row)) continue;
    const month = monthOf(row[mi]);
    if (!month) continue;
    series.push({ month, value: num(row[pi]) });
  }
  series.sort((a, b) => a.month.localeCompare(b.month));
  const last = series.length ? series[series.length - 1] : null;
  // `oneMonth` is a constant column (LS's rolling headline) — same on every row.
  const oneMonth = Array.isArray(set.rows[0]) ? num(set.rows[0][oi]) : null;
  return { latestMonth: last?.month ?? null, latest: last?.value ?? null, oneMonth, series };
}

/** A single-cell scalar widget (e.g. ['OpenRequests'] -> rows [[147]]). */
function scalar(sets: LsResultSet[], measure: string): number | null {
  const set = sets.find((s) => {
    const h = s && Array.isArray(s.headers) ? s.headers : [];
    return h.length === 1 && h[0] === measure;
  });
  if (!set || !Array.isArray(set.rows) || !Array.isArray(set.rows[0])) return null;
  return num(set.rows[0][0]);
}

export function mapLsAnalytics(resultSets: LsResultSet[], capturedAt: string): LsKpis {
  // Never throws on an unexpected Sisense payload — degrades to the honest empty
  // state instead of crashing the hub SSR.
  try {
    return buildLsKpis(Array.isArray(resultSets) ? resultSets : [], capturedAt);
  } catch {
    return emptyKpis(capturedAt);
  }
}

function buildLsKpis(sets: LsResultSet[], capturedAt: string): LsKpis {
  // ── $ invoiced — robust to BOTH the transposed (one single-cell row per
  // measure) and the columnar (one row, measures as columns) Sisense layouts. ─
  const inv = findSet(sets, ['InvoicedThisYear', 'InvoicedPreviousYear']);
  const invCell = (measure: string): number | null => {
    if (!inv || !inv.headers || !Array.isArray(inv.rows) || !inv.rows.length) return null;
    const idx = inv.headers.indexOf(measure);
    if (idx === -1) return null;
    // Transposed: rows aligned 1:1 with headers, each a single cell.
    if (inv.rows.length === inv.headers.length && inv.rows.every((r) => Array.isArray(r) && r.length === 1)) {
      return num(inv.rows[idx][0]);
    }
    // Columnar: a single row with the measure as a column.
    const r0 = inv.rows[0];
    if (Array.isArray(r0) && idx < r0.length) return num(r0[idx]);
    const row = inv.rows[idx];
    return Array.isArray(row) ? num(row[0]) : null;
  };

  // ── $ by specialty ────────────────────────────────────────────────────────
  const bySpec = findSet(sets, ['Specialty', 'Total Line Item Amount']);
  const revenueBySpecialty: Array<{ name: string; amount: number }> = [];
  if (bySpec?.headers && Array.isArray(bySpec.rows)) {
    const si = bySpec.headers.indexOf('Specialty');
    const ai = bySpec.headers.indexOf('Total Line Item Amount');
    for (const row of bySpec.rows) {
      if (!Array.isArray(row)) continue;
      const name = typeof row[si] === 'string' ? (row[si] as string) : null;
      const amount = num(row[ai]);
      if (name && amount !== null) revenueBySpecialty.push({ name, amount });
    }
    revenueBySpecialty.sort((a, b) => b.amount - a.amount);
  }

  // ── Scheduling coverage ───────────────────────────────────────────────────
  const sched = findSet(sets, ['ConfirmedShiftsTotal', 'TargetedShifts', 'TargetedPercentage']);
  let scheduling: LsKpis['scheduling'] = null;
  if (sched?.headers && Array.isArray(sched.rows) && Array.isArray(sched.rows[0])) {
    const r0 = sched.rows[0];
    scheduling = {
      confirmedTotal: num(r0[sched.headers.indexOf('ConfirmedShiftsTotal')]),
      targeted: num(r0[sched.headers.indexOf('TargetedShifts')]),
      targetedPct: num(r0[sched.headers.indexOf('TargetedPercentage')]),
    };
  }

  return {
    capturedAt,
    openRequests: scalar(sets, 'OpenRequests'),
    activeBids: scalar(sets, 'ActiveBids'),
    rejectedInvoices: scalar(sets, 'RejectedInvoices'),
    rejectedTimesheets: scalar(sets, 'RejectedTimesheets'),
    fillRate: seriesKpi(sets, 'Months in Date', 'FillRate', 'VendorFillRate1Month'),
    bidAcceptance: seriesKpi(sets, 'Months in Date', 'BidAcceptanceRate', 'BidAcceptance1Month'),
    speedToBidHrs: seriesKpi(sets, 'Months in Date', 'TimeToFirstBid', 'TimeToFirstBid1Month'),
    marketShare: seriesKpi(sets, 'Months in Date', 'MarketShare', 'MarketShare1Month'),
    tsRejectRate: seriesKpi(sets, 'Months in Date', 'TSRejectedRate', 'TSRejectedRate1Month'),
    invRejectRate: seriesKpi(sets, 'Months in Date', 'InvRejectedRate', 'InvRejectedRate1Month'),
    // NOTE: LS labels the series column 'HoursToPayment' but the values are DAYS
    // (they match the 'DaystoPayment*' headline columns) — a LocumSmart misnomer.
    daysToPayment: seriesKpi(sets, 'Months in Date', 'HoursToPayment', 'DaystoPayment1Month'),
    requestsReceived: seriesKpi(sets, 'Months in Date', 'RequestsReceived', 'Requests1Month'),
    providerCount: seriesKpi(sets, 'Months in Date', 'Provider', 'ProviderCount1Month'),
    invoicedThisYear: invCell('InvoicedThisYear'),
    invoicedPrevYear: invCell('InvoicedPreviousYear'),
    invoicedYoY: invCell('YYInvoiced'),
    revenueBySpecialty,
    scheduling,
  };
}

/** Coerce an LsKpi-shaped value from untrusted storage into a complete LsKpi. */
function normKpi(x: unknown): LsKpi {
  if (!x || typeof x !== 'object') return emptyKpi();
  const o = x as Record<string, unknown>;
  const series: LsSeriesPoint[] = Array.isArray(o.series)
    ? o.series
        .filter((p): p is { month: unknown; value: unknown } => !!p && typeof p === 'object' && typeof (p as { month?: unknown }).month === 'string')
        .map((p) => ({ month: (p as { month: string }).month, value: numOrNull((p as { value?: unknown }).value) }))
    : [];
  return { latestMonth: strOrNull(o.latestMonth), latest: numOrNull(o.latest), oneMonth: numOrNull(o.oneMonth), series };
}

/**
 * Defensive read of the `kpis` jsonb pulled from `ims_ls_analytics`. The hub
 * trusts only the SERVICE-ROLE source, but a malformed / older-schema row must
 * never crash the SSR — so this guarantees a complete LsKpis (every field
 * present, wrong types coerced to null) the view can read without guards.
 */
export function normalizeLsKpis(raw: unknown, fallbackCapturedAt = ''): LsKpis {
  if (!raw || typeof raw !== 'object') return emptyKpis(fallbackCapturedAt);
  const o = raw as Record<string, unknown>;
  const sched = o.scheduling;
  return {
    capturedAt: strOrNull(o.capturedAt) ?? fallbackCapturedAt,
    openRequests: numOrNull(o.openRequests),
    activeBids: numOrNull(o.activeBids),
    rejectedInvoices: numOrNull(o.rejectedInvoices),
    rejectedTimesheets: numOrNull(o.rejectedTimesheets),
    fillRate: normKpi(o.fillRate),
    bidAcceptance: normKpi(o.bidAcceptance),
    speedToBidHrs: normKpi(o.speedToBidHrs),
    marketShare: normKpi(o.marketShare),
    tsRejectRate: normKpi(o.tsRejectRate),
    invRejectRate: normKpi(o.invRejectRate),
    daysToPayment: normKpi(o.daysToPayment),
    requestsReceived: normKpi(o.requestsReceived),
    providerCount: normKpi(o.providerCount),
    invoicedThisYear: numOrNull(o.invoicedThisYear),
    invoicedPrevYear: numOrNull(o.invoicedPrevYear),
    invoicedYoY: numOrNull(o.invoicedYoY),
    revenueBySpecialty: Array.isArray(o.revenueBySpecialty)
      ? o.revenueBySpecialty.filter(
          (s): s is { name: string; amount: number } =>
            !!s && typeof s === 'object' && typeof (s as { name?: unknown }).name === 'string' && typeof (s as { amount?: unknown }).amount === 'number' && Number.isFinite((s as { amount: number }).amount),
        )
      : [],
    scheduling:
      sched && typeof sched === 'object'
        ? {
            confirmedTotal: numOrNull((sched as Record<string, unknown>).confirmedTotal),
            targeted: numOrNull((sched as Record<string, unknown>).targeted),
            targetedPct: numOrNull((sched as Record<string, unknown>).targetedPct),
          }
        : null,
  };
}
