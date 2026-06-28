/**
 * Per-broker progress persistence and transitions.
 *
 * The transition helpers are pure (state in -> new state out) so they can be
 * unit-tested without touching disk. I/O is isolated to load/save.
 *
 * Key rule encoded here: a removal only becomes `done` when VERIFIED — either a
 * previously-submitted listing is no longer found, or the operator confirms a
 * pending step. We never flip straight to `done` just because we clicked submit.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BrokerState, BrokerStatus, Gate, State } from "./types.js";

export function loadState(path: string): State {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as State;
}

export function saveState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

/** Ensure a broker has a state entry; returns a shallow copy of the map. */
export function ensureBroker(state: State, id: string): State {
  if (state[id]) return state;
  return {
    ...state,
    [id]: { status: "new", lastRun: null, listingUrls: [] },
  };
}

function withEntry(
  state: State,
  id: string,
  mutate: (e: BrokerState) => BrokerState,
): State {
  const ensured = ensureBroker(state, id);
  const prev = ensured[id]!;
  const next = mutate({ ...prev, listingUrls: [...prev.listingUrls] });
  return { ...ensured, [id]: next };
}

function pushHistory(e: BrokerState, status: BrokerStatus, ts: string, note?: string): BrokerState {
  const history = [...(e.history ?? []), { ts, status, note }];
  return { ...e, history };
}

/**
 * Discovery found no matching listing. If we had previously SUBMITTED or had a
 * PENDING confirmation, a now-empty result is positive evidence the removal took
 * effect -> `done`. Otherwise it's simply `not_found`.
 */
export function recordNotFound(state: State, id: string, ts: string): State {
  return withEntry(state, id, (e) => {
    const verifiedGone = e.status === "submitted" || e.status === "pending:confirm";
    const status: BrokerStatus = verifiedGone ? "done" : "not_found";
    const note = verifiedGone
      ? "no listing found after prior submission — verified removed"
      : "no matching listing found";
    return {
      ...pushHistory(e, status, ts, note),
      status,
      lastRun: ts,
      nextAction: undefined,
    };
  });
}

/** Record matched listing URLs (discovery hit). Status is left for opt-out. */
export function recordListings(state: State, id: string, urls: string[], ts: string): State {
  return withEntry(state, id, (e) => ({
    ...pushHistory(e, e.status, ts, `matched ${urls.length} listing(s)`),
    lastRun: ts,
    listingUrls: Array.from(new Set([...e.listingUrls, ...urls])),
  }));
}

/** A removal request was submitted; effect not yet verified. */
export function recordSubmitted(state: State, id: string, ts: string, note?: string): State {
  return withEntry(state, id, (e) => ({
    ...pushHistory(e, "submitted", ts, note ?? "removal request submitted"),
    status: "submitted",
    lastRun: ts,
    nextAction: "re-run later to verify the listing is gone",
  }));
}

/** Request needs the operator to confirm via an inbox (email/SMS link). */
export function recordPendingConfirm(state: State, id: string, ts: string, inbox: string): State {
  return withEntry(state, id, (e) => ({
    ...pushHistory(e, "pending:confirm", ts, `awaiting confirmation in ${inbox}`),
    status: "pending:confirm",
    lastRun: ts,
    nextAction: `check ${inbox} and click the confirmation link, then re-run`,
  }));
}

/** A gate (CAPTCHA / login) blocks automation; route to the operator. */
export function recordGate(
  state: State,
  id: string,
  gate: Exclude<Gate, "none" | "confirm">,
  ts: string,
  opts: { url?: string; screenshot?: string; action: string },
): State {
  const status: BrokerStatus = gate === "captcha" ? "manual:captcha" : "manual:login";
  return withEntry(state, id, (e) => ({
    ...pushHistory(e, status, ts, opts.action),
    status,
    lastRun: ts,
    nextAction: opts.action,
    screenshots: opts.screenshot
      ? Array.from(new Set([...(e.screenshots ?? []), opts.screenshot]))
      : e.screenshots,
    listingUrls: opts.url
      ? Array.from(new Set([...e.listingUrls, opts.url]))
      : e.listingUrls,
  }));
}

export function recordError(
  state: State,
  id: string,
  ts: string,
  message: string,
  screenshot?: string,
): State {
  return withEntry(state, id, (e) => ({
    ...pushHistory(e, "error", ts, message),
    status: "error",
    lastRun: ts,
    notes: message,
    screenshots: screenshot
      ? Array.from(new Set([...(e.screenshots ?? []), screenshot]))
      : e.screenshots,
  }));
}

/** Operator has confirmed a pending step out-of-band -> verified done. */
export function markDone(state: State, id: string, ts: string, note?: string): State {
  return withEntry(state, id, (e) => ({
    ...pushHistory(e, "done", ts, note ?? "confirmed removed"),
    status: "done",
    lastRun: ts,
    nextAction: undefined,
  }));
}

/** Is this broker finished for good (no more automated work needed)? */
export function isComplete(s: BrokerState | undefined): boolean {
  return s?.status === "done" || s?.status === "not_found";
}
