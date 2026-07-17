# #agent-ops de-spam — diagnosis + fix spec (2026-07-16)

Operator mandate (2026-07-13, memory `feedback_git_backup_and_alert_hygiene_2026-07-13`):
"#agent-ops must be CHANGE-DRIVEN — kill the identical daily budget/systems-dashboard posts,
only post what changed or is genuinely important."

## Diagnosis (verified 2026-07-16 against live #agent-ops history + EC2)

- The spam is **NOT an EC2 fleet agent**. It is the n8n cloud workflow
  **`https://ias.app.n8n.cloud/workflow/4RjZebgrKOOFPmuT`** posting as **IMS Bot**
  (every dashboard post in the last 30 channel messages footers this one workflow id).
- Cadence: the "DAILY BUDGET & SYSTEMS DASHBOARD" posts **TWICE every morning at
  08:30:56 + 08:30:57 EDT** (duplicate executions/nodes one second apart, verified
  Jul 3 → Jul 16 without exception), plus occasional evening re-runs (Jul 5 23:00,
  Jul 12 23:00, Jul 13 20:44). ~27 of the last 30 channel messages are this dashboard.
- The weekly "Agent Team Weekly Cost Report" (EC2 `cost_monitor`, weekly) is NOT the
  spam and stays. `budget_alert_sweeper` (warning/critical only) also stays.
- The workflow is NOT in the `clinician-agent-burst/n8n-workflows/` export set (that
  set predates it), and no n8n API key was found on EC2 or in local project `.env`s —
  **applying the fix needs either the n8n UI (manual, ~5 min) or an n8n API key**.

## Fix spec (apply inside workflow 4RjZebgrKOOFPmuT)

1. **Kill the double-post**: open Executions for the workflow around 08:30 EDT — if two
   executions fire, there are two active triggers (or the workflow exists twice/has two
   schedule nodes); delete the extra trigger node. If one execution posts twice, the
   Slack node is duplicated in the canvas — delete one.
2. **Change-driven gate**: insert a Code node between the message builder and the Slack
   node:

   ```js
   // Post only when the dashboard MEANS something new.
   const msg = $json.text; // the rendered Slack message
   // Normalize away the always-changing noise: date header, day counter, timestamps.
   const body = msg
     .replace(/_[A-Z][a-z]+day, .*?_\n?/g, '')       // "_Thursday, July 16, 2026 — Day 16/31…_"
     .replace(/\[\d{4}-\d{2}-\d{2} [\d:]+ E[DS]T\]/g, '')
     .replace(/\d+ \/ [\d,]+ (credits|searches) used\s*\(\d+\/day\)/g, ''); // daily creep
   const crypto = require('crypto');
   const hash = crypto.createHash('sha256').update(body).digest('hex');
   const ws = $getWorkflowStaticData('global');
   const now = Date.now();
   const alertWorthy =
     /OVER BUDGET|BEHIND|:x: Errors: [1-9]/.test(msg) ||        // failures/overruns always post
     /[8-9]\d%|100%/.test(msg);                                  // any tracker ≥80%
   const changed = ws.lastHash !== hash;
   const weeklyHeartbeat = !ws.lastPost || now - ws.lastPost > 7 * 864e5;
   if (alertWorthy || changed || weeklyHeartbeat) {
     ws.lastHash = hash; ws.lastPost = now;
     return [{ json: $json }];   // → Slack node
   }
   return [];                     // suppress: nothing changed
   ```

   Properties: identical-content mornings are suppressed; any real change (systems list,
   budget status, errors, % milestone) posts; a weekly heartbeat proves liveness; and the
   duplicate second execution is suppressed by the hash even before step 1 lands.
3. Verify: run the workflow manually twice — first run posts, second run suppresses.

## Status

Investigation + spec complete. **Apply is blocked on n8n access** — Zach: either make the
edit per the spec (5 min in the n8n UI) or drop an n8n API key (n8n → Settings → API) into
`ias-dashboard/.env.local` as `N8N_API_KEY=` and say the word; Claude can then apply +
verify via the REST API.
