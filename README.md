# scrub

**Personal digital-footprint eraser.** Finds where _your own_ personal data is
exposed on data brokers / people-search sites and removes it through each
broker's own opt-out flow — on a schedule, tracking per-broker progress across
runs.

It is deliberately conservative and honest: it acts **only on your own
identity**, **never** defeats a CAPTCHA / login / confirmation, and **never**
claims a removal worked until it's verified.

## Quickstart

```bash
# 1. Install deps + the Chromium browser Playwright drives
npm install
npm run browsers

# 2. Create your profile from the template, then fill in YOUR real details
cp .claude/footprint/profile.example.json .claude/footprint/profile.json
$EDITOR .claude/footprint/profile.json     # name, email, city/state, birthYear…

# 3. See what it would do — discovers + reports, submits nothing
npm run dry-run

# 4. Run for real (it confirms the profile is YOU before acting)
npm run sweep

# 5. Read the report
cat .claude/footprint/report.md
```

Or just ask Claude: **"scrub my data"**, **"remove me from data brokers"**,
**"run a privacy sweep"**, or **"check my removal status"** — that triggers the
`footprint-eraser` skill (`.claude/skills/footprint-eraser/SKILL.md`), which
drives the same engine.

The profile needs your name + email and **at least one corroborator**
(city/state, `birthYear`, a relative, or a past location). Without one, matching
finds nothing on purpose — it won't act on a same-named stranger.

## How it works

| File | Role |
| --- | --- |
| `src/types.ts` | Shared types; status lifecycle |
| `src/matching.ts` | Pure profile→listing matching (name **+** corroborator) |
| `src/discover.ts` | Opens a broker's search, extracts candidate listings |
| `src/optout.ts` | Form-fill, gate detection, email drafting |
| `src/state.ts` | Load/save `state.json` + status transitions |
| `src/report.ts` | Renders `report.md` + the terminal summary |
| `src/config.ts` | Paths, loaders, profile validation |
| `src/index.ts` | Orchestrator (one broker at a time, human-paced) |
| `.claude/skills/footprint-eraser/brokers.json` | Curated opt-out catalog |

Statuses: `not_found`, `submitted` (sent, **not** yet verified),
`pending:confirm` (you must click an email/SMS link), `manual:captcha`,
`manual:login`, `error`, and `done` (**verified** removed). A broker only
reaches `done` once its listing is verifiably gone.

### CLI flags
```
npm run sweep -- --dry-run         # discover + report only; submit nothing
npm run sweep -- --yes             # confirm "this is me" non-interactively (cron)
npm run sweep -- --broker spokeo   # one broker by id
npm run sweep -- --max 3           # at most N brokers this run
npm run sweep -- --headful         # watch the browser
```

## Will / won't

**✅ Will:** act only on your own identity (name + corroborator required); use
brokers' own opt-out flows; go one broker at a time, human-paced; pause at every
CAPTCHA/login/confirmation and tell you exactly what to click; draft opt-out
emails for you to send; track progress and only mark `done` when verified.

**🚫 Won't:** solve/bypass a CAPTCHA; type or guess credentials; fabricate a
confirmation or claim unconfirmed success; act on anyone else's identity; scrape
whole sites; auto-send email with credentials you didn't configure.

Full list: [`.claude/skills/footprint-eraser/README.md`](.claude/skills/footprint-eraser/README.md).

## Scheduling

A weekly sweep can run automatically (Monday morning, off the hour). See
[`docs/scheduling.md`](docs/scheduling.md) for how it's registered and whether
it's session-only or persistent on this host.

## Privacy

`profile.json`, `state.json`, `report.md`, and `shots/` contain personal data
and are **gitignored** — they never get committed. Only the example profile and
the broker catalog are tracked.

## Tests

```bash
npm test        # unit tests for matching, state, report, gates (no network)
```

Tests mock broker pages; nothing in the test suite touches the live network.

## Disclaimer

This automates _your own_ data-subject requests using brokers' public opt-out
controls. You are the operator acting on your own behalf. Re-verify broker URLs
periodically — brokers move their opt-out pages often.
