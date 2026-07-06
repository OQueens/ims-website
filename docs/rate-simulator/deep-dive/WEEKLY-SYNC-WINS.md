# Rate Simulator — Wins & Innovation Log

> A plain-English running log of what we have shipped and what we are building on the rate
> simulator, written for a weekly sync (no jargon, no code names). Read a few lines aloud, or
> forward it. Newest entry on top. Keep appending as things land.
>
> Context in one sentence: the rate simulator is the tool our recruiters use to price a locum
> placement, and the goal is for it to be unbelievably accurate for every specialty, for the rate
> we would actually pay the physician, and for where that rate sits in the market.

---

## 2026-07-03 — Deep-dive complete: a full map of the tool and the roadmap to "unbelievably accurate"

We ran a large multi-agent research pass on the rate simulator: it mapped exactly how the tool
works today, researched every angle of how to make it more accurate, fact-checked its own findings
so no made-up numbers survived, and produced a prioritized roadmap. Here is what came out of it, in
human terms.

### What is already strong today (things we can say with confidence)

- **The tool only moves a rate when the evidence is real.** A live market number replaces our
  researched estimate only when we have several independent data points from at least two different
  agencies. One agency, or one thin data point, cannot swing a quote. Very few tools in our space
  treat accuracy this seriously.
- **When we do not have good data, the tool says so instead of guessing.** It will show
  "insufficient data" rather than invent a number. No fabricated rates, ever.
- **We caught and fixed a real bug before it could misquote anyone.** A recent change was quietly
  flattening the premiums for night shifts and hard-to-staff rural locations on certain quotes. We
  found it, fixed it, and added tests so it cannot come back.
- **We made the tool honest about its own confidence.** It no longer claims "high confidence"
  unless live market data actually backs the number up. We would rather be honestly uncertain than
  confidently wrong.
- **We cut our data-gathering costs to near zero.** We moved to a self-hosted tool for collecting
  public rate data that costs essentially nothing at any volume, replacing an option that would
  have run into the hundreds or thousands of dollars a month.
- **A big piece of our edge is already built and just needs turning on.** The plumbing to record
  where every quoted number came from, and to learn from our own placements, is already in place in
  the system. It is not yet switched on, but the hard part is done.

### What is coming (the innovation, in plain terms)

- **"Where does this offer sit in the market?" done for real.** Today the percentile figures a
  recruiter sees are a rough approximation. We are building true market distributions so a recruiter
  can say "this offer is around the 35th percentile, and here is the number to counter with to reach
  the middle of the market." When the data is thin, it will widen honestly rather than fake
  precision.
- **The tool will learn from what we actually pay.** We are wiring it to calibrate against our own
  real placements and to raise a flag when a quote drifts from what we end up paying. This is the
  single most valuable thing we can do, and it is data no competitor can ever copy because only a
  real staffing operation has it.
- **Coverage for every specialty we staff.** Right now our live market data only reaches about a
  fifth of our specialty slots because of a naming mismatch between the tool that gathers data and
  the tool that prices it. One translation layer fixes that and unlocks live data for seven of our
  top fifteen specialties with no extra data gathering at all. We also have an honest plan to add
  the specialties we are missing entirely (radiation oncology, cardiothoracic surgery, nurse
  midwives, and more), only where we can cite a real source.
- **A "why this number?" panel.** We can show exactly what data stands behind each quote. No
  competitor shows their work. Because our method is genuinely rigorous, being fully transparent
  about it becomes a selling point rather than a risk.
- **Rates that keep up with time.** The market moves with the seasons, with surge events (a strike
  can triple temporary-staffing pay), and with multi-year shortages in specific specialties. We are
  building the tool to quote where the market is heading, not where it was last year.
- **Location precision below the state level.** Metro versus rural versus critical-access hospitals
  pay very differently, and that is core to locum work. We are adding that granularity in a way the
  data can actually support.
- **Harder to game.** We are closing the ways an outside agency could nudge our numbers up (for
  example by posting inflated "up to $X" ads, or the same posting across many cities) without real
  evidence behind it.
- **The rate engine, everywhere.** We are packaging the accurate core so it can power a Slack tool,
  an internal system, or an outside-facing service, with every surface pulling from one trusted
  source instead of drifting apart.
- **Becoming the only accuracy-audited rate tool in the field.** We will be able to publish how
  close our quotes were to what actually booked. Nobody else in our space does this, and it is only
  possible because we run real placements.

### The one-line strategic takeaway for a boss

Our rate tool is already more disciplined and more honest than anything public in our space, and the
next wave of work turns three things nobody can copy into features recruiters feel every day: our
own real placement outcomes, a fully traceable "here is why" behind every number, and a
transparency standard we can actually stand behind.

---

<!--
APPENDING GUIDE (for future sessions): add a new dated section at the TOP, under the intro, above
the most recent entry. Keep it plain-English, 1-2 sentences per item, no code names, no em-dashes
(house copy rule). Split each entry into "Shipped" and "Coming" where it helps. Source of truth for
detail is 00-MASTER-REPORT.md + BACKLOG.md in this same folder.
-->
