# IMS temp-site — audit punch-list

Scratch file (gitignored intent — not committed). Browse http://localhost:4319/
with this open side-by-side. Jot shorthand under each page; don't worry about
polish. I read this back and execute in batches, Codex-reviewed, no push.

**Format per item (one line is fine):**
`- [section/element] what's wrong  →  what you want instead`
Add `!!` at the start for "this one matters most".

Example:
`- !! [hero] heading feels too tight  →  more air, smaller second line`
`- [footer] marquee text too big on mobile`

---

## / (homepage)
sections: nav · hero · proof row · trust strip · 3-up cluster · "roster you can
vouch for" (pine) · pamphlet flip · placement cards · pull-quote (pine) · FAQ ·
footer
-

## /clinicians
sections: hero · hard-credit cards · benefits · timeline (pine) · referral (pine) · FAQ
-

## /facilities
sections: hero · model cards · coverage stats · request panel (pine) · FAQ
-

## /story
-

## /jobs
sections: filter bar · job list · empty state
-

## /contact
sections: left rail (seal/phone/assurances) · the form
-

## /thank-you  &  /couldnt-send
-

---

## Auto-found (impeccable detect — already triaged, you can ignore)
- `src/styles/tokens.css:54` bounce-easing — in STALE dark-system code
  (BaseLayout/tokens.css), NOT in the temp-site render path
  (IMSLayout → ims.css). Zero visible effect on localhost:4319. Leave it.
- Live render path: detector found **0** anti-patterns. Clean.

## Cross-cutting (applies everywhere — note once here)
- logo:
- color / blue accent:
- typography / spacing:
- mobile (resize narrow):
- copy / tone:
