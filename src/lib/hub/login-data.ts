// Login-aside data: the one honest, live, non-sensitive figure shown on the
// public /hub/login page — the active requisition count. It is counted the SAME
// way the dashboard counts it (aggregateHub().activeReqs === rows.length of the
// status='active' ims_jobs select, capped at 1000), so the two screens can never
// disagree. We deliberately AVOID a { count:'exact', head:true } head request
// here: that returns count:null in the Cloudflare Workers runtime (the
// Content-Range header the count is read from isn't surfaced), which silently
// hid the figure in prod even though /jobs + the dashboard — both row-selects —
// read the same feed fine. Selecting only `id` keeps the read light (and the ids
// never reach the HTML).

/** Shape of a Supabase row-select result (only the fields we read). */
export interface ActiveReqRowsResult {
  data: unknown[] | null;
  error: unknown | null;
}

/**
 * Turn an active-reqs row-select result into an honest number-or-null.
 * Returns null (→ caller hides the figure) on ANY uncertainty — a query error or
 * a missing/non-array data field. NEVER fabricates a placeholder number
 * (CLAUDE.md no-fake-data). The count is the number of returned active rows — a
 * real 0 is a valid honest count — matching aggregateHub().activeReqs exactly.
 */
export function countActiveReqs(res: ActiveReqRowsResult | null | undefined): number | null {
  if (!res || res.error) return null;
  if (!Array.isArray(res.data)) return null;
  return res.data.length;
}
