# Scheduling a weekly sweep

Goal: run a privacy sweep automatically every **Monday morning** and report what
advanced vs. what's still blocked. There are two ways to do it, with very
different persistence — pick based on whether you want it tied to Claude or
truly unattended on this host.

## TL;DR — persistence

| Option | Runs | Persistence | Auto-expires? |
| --- | --- | --- | --- |
| **A. Claude cron** (registered) | Inside a Claude Code session, when idle | Survives restarts (`.claude/scheduled_tasks.json`), **but** only fires while a Claude REPL is running | **Yes — after 7 days.** Must be re-armed. |
| **B. launchd** (recommended for real autonomy) | The `npm run sweep` engine, no Claude needed | Fully persistent on this host across reboots/logouts | No |

> **Short answer to "session-only or persistent on this host?"**
> The Claude cron is **durable (persisted to disk)** but **not truly unattended**:
> it only fires while a Claude session is open, and the scheduler auto-expires
> recurring jobs after **7 days**. For a genuinely persistent, Claude-independent
> weekly job, use **launchd (Option B)**.

## Option A — Claude cron (already registered)

A durable recurring job has been registered for **Mondays at 08:23 local**
(off the :00/:30 mark to avoid fleet-wide pile-ups). Its prompt invokes the
`footprint-eraser` skill and asks for the advanced-vs-blocked summary.

- It is written to `.claude/scheduled_tasks.json`, so it survives Claude
  restarts — but it only fires **while a Claude Code session is open and idle**,
  and the scheduler **auto-deletes recurring jobs after 7 days**.
- To keep it going, re-arm it (ask Claude to "schedule the weekly footprint
  sweep" again) roughly weekly, or use Option B.

Manage it from a Claude session: list with the cron tooling, or ask Claude to
delete/re-create it.

## Option B — launchd (persistent on this host, recommended)

This runs the engine directly on a schedule with no Claude session required.

1. Save this as `~/Library/LaunchAgents/design.creo.scrub.weekly.plist`
   (adjust the repo path if you move it):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>design.creo.scrub.weekly</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd /Users/coltenkrauter/Projects/scrub &amp;&amp; npm run sweep -- --yes &gt;&gt; .claude/footprint/cron.log 2&gt;&amp;1</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>8</integer>
    <key>Minute</key><integer>23</integer>
  </dict>
  <key>StandardErrorPath</key>
  <string>/Users/coltenkrauter/Projects/scrub/.claude/footprint/cron.log</string>
  <key>StandardOutPath</key>
  <string>/Users/coltenkrauter/Projects/scrub/.claude/footprint/cron.log</string>
</dict>
</plist>
```

2. Load it:

```bash
launchctl load ~/Library/LaunchAgents/design.creo.scrub.weekly.plist
# run once now to test:
launchctl start design.creo.scrub.weekly
# remove later:
launchctl unload ~/Library/LaunchAgents/design.creo.scrub.weekly.plist
```

`--yes` confirms the profile is your own identity non-interactively (only set
this up for your **own** profile). The run writes `.claude/footprint/report.md`
and appends progress to `.claude/footprint/cron.log`.

### crontab alternative

```cron
# Mondays 08:23 local — weekly footprint sweep
23 8 * * 1 cd /Users/coltenkrauter/Projects/scrub && /bin/zsh -lc 'npm run sweep -- --yes' >> .claude/footprint/cron.log 2>&1
```

## Reading results after a scheduled run

- `.claude/footprint/report.md` — counts by status + numbered manual steps with links.
- `.claude/footprint/state.json` — per-broker progress.
- `.claude/footprint/cron.log` — stdout/stderr from launchd/cron runs.

Scheduled runs still **pause at every CAPTCHA / login / confirmation** — those
land as `manual:*` / `pending:confirm` in the report for you to finish by hand.
Nothing is ever bypassed unattended.
