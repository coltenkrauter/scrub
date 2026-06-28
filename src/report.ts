/**
 * Render report.md and a terminal summary from state. Pure (string in/out) so
 * the wording — especially the "never claim unconfirmed success" framing — is
 * unit-testable.
 */

import type { Broker, BrokerStatus, State } from "./types.js";
import { MANUAL_STATUSES } from "./types.js";

export interface Summary {
  done: number;
  submitted: number;
  pending: number;
  manual: number;
  not_found: number;
  error: number;
  new: number;
  total: number;
}

export function summarize(state: State): Summary {
  const s: Summary = {
    done: 0, submitted: 0, pending: 0, manual: 0,
    not_found: 0, error: 0, new: 0, total: 0,
  };
  for (const v of Object.values(state)) {
    s.total++;
    switch (v.status) {
      case "done": s.done++; break;
      case "submitted": s.submitted++; break;
      case "pending:confirm": s.pending++; break;
      case "manual:captcha":
      case "manual:login": s.manual++; break;
      case "not_found": s.not_found++; break;
      case "error": s.error++; break;
      case "new": s.new++; break;
    }
  }
  return s;
}

const STATUS_LABEL: Record<BrokerStatus, string> = {
  "new": "⏳ new",
  "not_found": "— not found",
  "submitted": "📨 submitted (unverified)",
  "pending:confirm": "✋ pending confirmation",
  "manual:captcha": "🤖 CAPTCHA — manual",
  "manual:login": "🔒 login — manual",
  "error": "⚠️ error",
  "done": "✅ verified removed",
};

/** One-line terminal summary. */
export function summaryLine(state: State): string {
  const s = summarize(state);
  return (
    `done ${s.done} · submitted ${s.submitted} · pending ${s.pending} · ` +
    `manual ${s.manual} · not_found ${s.not_found} · error ${s.error}` +
    (s.new ? ` · new ${s.new}` : "")
  );
}

/** The numbered list of things only the operator can do, each with its link. */
export function manualSteps(
  brokers: Broker[],
  state: State,
): { broker: Broker; status: BrokerStatus; action: string; link?: string }[] {
  const byId = new Map(brokers.map((b) => [b.id, b]));
  const steps: { broker: Broker; status: BrokerStatus; action: string; link?: string }[] = [];
  for (const [id, v] of Object.entries(state)) {
    if (!MANUAL_STATUSES.includes(v.status)) continue;
    const broker = byId.get(id);
    if (!broker) continue;
    const link = v.listingUrls[0] ?? broker.optOutUrl ?? broker.searchUrl;
    steps.push({
      broker,
      status: v.status,
      action: v.nextAction ?? "see report",
      link,
    });
  }
  return steps;
}

export function renderReport(
  brokers: Broker[],
  state: State,
  runTs: string,
  opts: { dryRun?: boolean } = {},
): string {
  const s = summarize(state);
  const byId = new Map(brokers.map((b) => [b.id, b]));
  const lines: string[] = [];

  lines.push("# Footprint Eraser — Run Report");
  lines.push("");
  lines.push(`- Run: \`${runTs}\`${opts.dryRun ? " **(dry run — nothing submitted)**" : ""}`);
  lines.push(`- Brokers tracked: ${s.total}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| ✅ Verified removed | ${s.done} |`);
  lines.push(`| 📨 Submitted (unverified) | ${s.submitted} |`);
  lines.push(`| ✋ Pending confirmation | ${s.pending} |`);
  lines.push(`| 🤖🔒 Manual (CAPTCHA/login) | ${s.manual} |`);
  lines.push(`| — Not found | ${s.not_found} |`);
  lines.push(`| ⚠️ Error | ${s.error} |`);
  if (s.new) lines.push(`| ⏳ New / not yet processed | ${s.new} |`);
  lines.push("");
  lines.push(
    "> Honesty note: **submitted ≠ removed.** A request is only counted as " +
      "*verified removed* once the listing can no longer be found, or you " +
      "confirmed it yourself.",
  );
  lines.push("");

  const steps = manualSteps(brokers, state);
  lines.push("## Remaining manual steps");
  lines.push("");
  if (steps.length === 0) {
    lines.push("_None — nothing is waiting on you right now._");
  } else {
    steps.forEach((step, i) => {
      const link = step.link ? ` — [open](${step.link})` : "";
      lines.push(`${i + 1}. **${step.broker.name}** — ${step.action}${link}`);
    });
  }
  lines.push("");

  lines.push("## Per-broker detail");
  lines.push("");
  lines.push("| Broker | Status | Last run | Listings | Next action |");
  lines.push("| --- | --- | --- | ---: | --- |");
  const ids = new Set([...brokers.map((b) => b.id), ...Object.keys(state)]);
  for (const id of ids) {
    const v = state[id];
    const broker = byId.get(id);
    const name = broker?.name ?? id;
    if (!v) {
      lines.push(`| ${name} | ⏳ new | — | 0 | — |`);
      continue;
    }
    const next = v.nextAction ? v.nextAction.replace(/\|/g, "\\|") : "—";
    lines.push(
      `| ${name} | ${STATUS_LABEL[v.status]} | ${v.lastRun ?? "—"} | ` +
        `${v.listingUrls.length} | ${next} |`,
    );
  }
  lines.push("");
  lines.push("---");
  lines.push(
    "_This tool acts only on the operator's own identity and never bypasses " +
      "CAPTCHAs, logins, or confirmation steps._",
  );
  lines.push("");

  return lines.join("\n");
}
