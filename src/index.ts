/**
 * Footprint Eraser — orchestrator.
 *
 * Runs the sweep: for each broker that isn't finished, one at a time and
 * human-paced, discover matching listings for the OPERATOR'S OWN identity, then
 * drive the broker's opt-out flow — pausing (never bypassing) at any CAPTCHA,
 * login, or confirmation gate. Writes state.json + report.md.
 *
 * Flags:
 *   --dry-run        discover + report only; never submit anything
 *   --yes            confirm operator-owns-this-identity non-interactively (cron)
 *   --broker <id>    limit to a single broker
 *   --max <n>        process at most N brokers this run
 *   --headful        show the browser (default headless)
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Browser, Page } from "playwright";
import type { Broker, MatchResult, Profile, State } from "./types.js";
import {
  paths, loadBrokers, loadProfile, validateProfile, ensureProfileScaffold, EXAMPLE_NAME,
} from "./config.js";
import {
  loadState, saveState, isComplete,
  recordListings, recordNotFound, recordSubmitted, recordPendingConfirm,
  recordGate, recordError,
} from "./state.js";
import { discover } from "./discover.js";
import { detectGate, fillForm, buildEmail } from "./optout.js";
import { renderReport, summaryLine } from "./report.js";

interface Args {
  dryRun: boolean;
  yes: boolean;
  broker?: string;
  max?: number;
  headful: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, yes: false, headful: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") a.dryRun = true;
    else if (arg === "--yes" || arg === "-y") a.yes = true;
    else if (arg === "--headful") a.headful = true;
    else if (arg === "--broker") a.broker = argv[++i];
    else if (arg === "--max") a.max = Number(argv[++i]);
  }
  return a;
}

/** Politeness delay between brokers — human-paced, respects rate limits. */
const BROKER_DELAY_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Confirm the operator owns this identity (own-identity-only rule). */
async function confirmOwner(profile: Profile, args: Args): Promise<boolean> {
  if (process.env.SCRUB_CONFIRM_OWNER === "1" || args.yes) return true;
  if (!process.stdin.isTTY) {
    console.error(
      "Refusing to run non-interactively without confirmation that this profile " +
        "is YOUR OWN identity. Re-run with --yes (or SCRUB_CONFIRM_OWNER=1) only " +
        "if the profile below is you.\n  Profile: " + profile.fullName,
    );
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question(
    `This will act on the identity "${profile.fullName}". ` +
      `Is this YOUR OWN identity? [y/N] `,
  );
  rl.close();
  return /^y(es)?$/i.test(ans.trim());
}

async function processBroker(
  page: Page,
  broker: Broker,
  profile: Profile,
  state: State,
  ctx: { runTs: string; dryRun: boolean; shotsDir: string; referenceYear: number },
): Promise<State> {
  const shot = async (tag: string): Promise<string> => {
    const file = resolve(ctx.shotsDir, `${broker.id}-${tag}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
    return file;
  };

  // 1) Discover matching listings (own identity only).
  let matches: MatchResult[] = [];
  try {
    matches = await discover(page, broker, profile, { referenceYear: ctx.referenceYear });
  } catch (err) {
    const s = await shot("discover-error");
    return recordError(state, broker.id, ctx.runTs, `discovery failed: ${String(err)}`, s);
  }

  if (matches.length === 0) {
    console.log(`  ${broker.name}: no matching listing found`);
    return recordNotFound(state, broker.id, ctx.runTs);
  }

  const urls = matches.map((m) => m.listing.url).filter(Boolean);
  console.log(`  ${broker.name}: matched ${matches.length} listing(s)`);
  state = recordListings(state, broker.id, urls, ctx.runTs);

  if (ctx.dryRun) {
    console.log(`  ${broker.name}: dry-run — would opt out via ${broker.method}`);
    return state; // status stays; report shows it as a candidate
  }

  // 2) Opt out by method, pausing at every gate.
  try {
    if (broker.method === "email") {
      const draft = buildEmail(broker, profile, urls[0]);
      // We do NOT send credentials we weren't given. Draft + hand off.
      return recordPendingConfirm(
        state, broker.id, ctx.runTs,
        `your mail client (send the drafted opt-out to ${draft.to})`,
      );
    }

    const target = broker.method === "url" ? (urls[0] ?? broker.optOutUrl) : broker.optOutUrl;
    if (!target) {
      return recordError(state, broker.id, ctx.runTs, "no opt-out URL configured");
    }
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });

    let gate = await detectGate(page);
    if (gate === "captcha") {
      const s = await shot("captcha");
      return recordGate(state, broker.id, "captcha", ctx.runTs, {
        url: page.url(), screenshot: s,
        action: `solve the CAPTCHA yourself at ${page.url()}, then re-run`,
      });
    }
    if (gate === "login") {
      const s = await shot("login");
      return recordGate(state, broker.id, "login", ctx.runTs, {
        url: page.url(), screenshot: s,
        action: `log in yourself at ${page.url()} (no credentials are guessed), then re-run`,
      });
    }

    const filled = await fillForm(page, profile);
    if (filled === 0) {
      const s = await shot("form-unrecognized");
      return recordGate(state, broker.id, "login", ctx.runTs, {
        url: page.url(), screenshot: s,
        action: `couldn't auto-fill the form — complete it by hand at ${page.url()}`,
      });
    }

    // Submit.
    const submit = page
      .locator('button[type="submit"], input[type="submit"], button:has-text("submit"), button:has-text("opt out"), button:has-text("remove")')
      .first();
    if (await submit.count().then((n) => n > 0).catch(() => false)) {
      await submit.click({ timeout: 10_000 }).catch(() => {});
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    }

    // Re-check for a post-submit gate / confirmation.
    gate = await detectGate(page);
    const s = await shot("after-submit");
    if (gate === "captcha") {
      return recordGate(state, broker.id, "captcha", ctx.runTs, {
        url: page.url(), screenshot: s,
        action: `a CAPTCHA appeared after submit — solve it at ${page.url()}, then re-run`,
      });
    }
    if (gate === "confirm") {
      return recordPendingConfirm(state, broker.id, ctx.runTs, `${profile.email} (broker confirmation)`);
    }
    // Submitted, but we will NOT claim removal until it's verified on a later run.
    return recordSubmitted(state, broker.id, ctx.runTs, `submitted via ${broker.method}; screenshot ${s}`);
  } catch (err) {
    const s = await shot("optout-error");
    return recordError(state, broker.id, ctx.runTs, `opt-out failed: ${String(err)}`, s);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const P = paths();
  const runTs = new Date().toISOString();
  const referenceYear = new Date().getUTCFullYear();

  // Profile: scaffold from example if missing, then stop for the operator.
  const created = ensureProfileScaffold(P.profile, P.profileExample);
  if (created) {
    console.error(
      `Created ${P.profile} from the template. Fill in YOUR OWN details ` +
        `(replace "${EXAMPLE_NAME}"), then run again.`,
    );
    process.exit(2);
  }

  const profile = loadProfile(P.profile);
  const verdict = validateProfile(profile);
  for (const w of verdict.warnings) console.warn(`warning: ${w}`);
  if (!verdict.ok) {
    console.error("Profile is not ready:");
    for (const p of verdict.problems) console.error(`  - ${p}`);
    process.exit(2);
  }

  if (!(await confirmOwner(profile, args))) {
    console.error("Aborted: identity not confirmed.");
    process.exit(3);
  }

  const allBrokers = loadBrokers(P.brokers);
  let state = loadState(P.state);
  mkdirSync(P.shots, { recursive: true });

  // Select brokers that still need work, one at a time.
  let queue = allBrokers.filter((b) => !isComplete(state[b.id]));
  if (args.broker) queue = queue.filter((b) => b.id === args.broker);
  if (args.max != null) queue = queue.slice(0, args.max);

  console.log(
    `Footprint sweep ${args.dryRun ? "(DRY RUN) " : ""}for "${profile.fullName}" — ` +
      `${queue.length} broker(s) to process.`,
  );

  let browser: Browser | undefined;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: !args.headful });
  } catch (err) {
    console.error(
      "Could not launch Chromium. Install browsers with `npm run browsers`.\n" + String(err),
    );
    process.exit(4);
  }

  try {
    for (const broker of queue) {
      // One context per broker — isolation, no cookie bleed between sites.
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      try {
        state = await processBroker(page, broker, profile, state, {
          runTs, dryRun: args.dryRun, shotsDir: P.shots, referenceYear,
        });
      } finally {
        await context.close().catch(() => {});
      }
      saveState(P.state, state); // persist after every broker
      await sleep(BROKER_DELAY_MS); // human-paced, respect rate limits
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const report = renderReport(allBrokers, state, runTs, { dryRun: args.dryRun });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(P.report, report, "utf8");

  console.log("\n" + summaryLine(state));
  console.log(`Report: ${P.report}`);
  if (args.dryRun) console.log("(dry run — nothing was submitted)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
