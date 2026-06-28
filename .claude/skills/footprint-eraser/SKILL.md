---
name: footprint-eraser
description: >-
  Scrub my data / remove me from data brokers / privacy sweep / check removal
  status. Finds where the OPERATOR'S OWN personal data is exposed on data-broker
  and people-search sites and removes it via each broker's own opt-out flow, on a
  schedule, tracking per-broker progress across runs. Use when the user says
  things like "scrub my data", "remove me from data brokers / people-search
  sites", "run a privacy sweep", or "check my removal status".
---

# Footprint Eraser

Remove the **operator's own** personal data from data brokers / people-search
sites using each broker's user-facing opt-out controls, and track progress in
`state.json` so each run picks up where the last left off.

## Non-negotiable rules — enforce these every run
1. **Own identity only.** Operate solely on the operator's own identity. If the
   profile's `fullName` does not plausibly match the person asking, **stop and
   confirm**. Never target anyone else.
2. **Never defeat a gate.** Never solve, bypass, or outsource a CAPTCHA. Never
   type credentials that weren't explicitly provided. Never guess logins.
3. **Never fake success.** Never fabricate a confirmation or claim an
   unconfirmed removal. "Submitted" is not "removed" — only mark a broker `done`
   when it is *verified* (the listing is gone, or the operator confirmed it).
4. **Use the front door.** Only use brokers' own opt-out/removal flows. Do not
   scrape whole sites. One broker at a time, human-paced, honoring robots and
   rate limits.
5. **PII never gets committed.** `profile.json`, `state.json`, `report.md`, and
   `shots/` are gitignored. Keep it that way.

## Files
- `.claude/footprint/profile.json` — operator identity (GITIGNORED; they fill it).
- `.claude/footprint/profile.example.json` — template (committed).
- `.claude/skills/footprint-eraser/brokers.json` — curated opt-out catalog.
- `.claude/footprint/state.json` — per-broker progress (GITIGNORED).
- `.claude/footprint/report.md` — latest run report (GITIGNORED).
- `.claude/footprint/shots/` — screenshots on every pause/error (GITIGNORED).

## Routine

### 1. Load inputs
- If `profile.json` is missing, copy `profile.example.json` → `profile.json`,
  tell the operator to fill in their real details, and **stop** until it exists.
- Read `profile.json`, `brokers.json`, and `state.json` (treat missing as `{}`).
- **Validate** the profile: real name present (not the example "Jane Q.
  Public"), valid email, and at least one corroborator (city/state, birthYear,
  relatives, or pastLocations). If it can't be corroborated, warn that discovery
  will conservatively find nothing, and offer to help fill it in.
- **Confirm ownership**: verify the `fullName` plausibly matches the operator.
  If unsure, ask. Do not proceed on someone else's identity.

### 2. Process brokers — one at a time
Run the engine. The TypeScript engine does steps below with the gates enforced
in code:

```
npm run sweep            # full run (asks you to confirm it's your identity)
npm run sweep -- --yes   # skip the interactive confirm (only if it's you)
npm run dry-run          # discover + report only, submits nothing
npm run sweep -- --broker spokeo   # just one broker
```

For each broker whose status isn't `done` / `not_found`:
- **Discover**: open the broker's search, find listings matching the profile by
  name **and** at least one corroborator (city/state, birthYear, relative).
  Record matching listing URLs. No confident match → `not_found`.
- **Opt out** by `method`:
  - `form` → open `optOutUrl`, fill from the profile, submit.
  - `url` → listing-specific removal flow; supply the matched listing URL.
  - `email` → draft the opt-out email from `template`; the operator sends it
    from their own mailbox (we never send with credentials we weren't given).
- **Gates — pause, never brute-force:**
  - CAPTCHA → `manual:captcha`; save the URL + a screenshot; tell the operator
    exactly what to click.
  - email/SMS confirmation → `pending:confirm`; note which inbox; advance to
    `done` on a later run once the listing is verifiably gone.
  - login required → `manual:login`; never guess credentials.
- **Record** in `state.json`: `status`, `lastRun` (the run timestamp passed in,
  not invented), matched listing URLs, and the next action.

### 3. Report — honestly
- The engine writes `report.md`. Summarize for the operator:
  counts by status (`done` / `submitted` / `pending` / `manual` / `not_found` /
  `error`) and a **numbered list of remaining manual steps**, each with its link.
- State plainly what actually submitted vs. what's blocked on the operator.
  **Never claim an unconfirmed removal succeeded.**

## Notes
- Re-verify broker URLs each run — brokers move their opt-out pages often; a
  moved page surfaces as `not_found` (verify by hand from the search URL).
- First run needs Chromium: `npm install && npm run browsers`.
- See `README.md` in this folder for the full will/won't list.
