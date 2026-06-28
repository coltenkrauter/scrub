/**
 * Shared types for the footprint eraser.
 *
 * Safety invariants encoded here:
 *  - We never represent a removal as "done" unless it has been *verified*
 *    (the listing is gone, or a confirmation step the user completed). A merely
 *    submitted request is `submitted`, awaiting effect — never claimed as success.
 *  - Every blocking state that requires a human (CAPTCHA, login, email/SMS
 *    confirmation) is a first-class status, not an error to be retried or
 *    bypassed.
 */

/** How a broker exposes its opt-out / removal control. */
export type BrokerMethod = "form" | "url" | "email";

/**
 * Lifecycle of a single broker for the operator's identity.
 *
 *  new            — not yet processed this cycle
 *  not_found      — searched; no listing matching the operator was found
 *  submitted      — removal request submitted; effect not yet verified
 *  pending:confirm— request needs the operator to click an email/SMS link
 *  manual:captcha — a CAPTCHA blocks automation; operator must complete it
 *  manual:login   — an account login is required; we never guess credentials
 *  error          — something failed unexpectedly (screenshot saved)
 *  done           — VERIFIED removed (listing gone on a later run, or confirmed)
 */
export type BrokerStatus =
  | "new"
  | "not_found"
  | "submitted"
  | "pending:confirm"
  | "manual:captcha"
  | "manual:login"
  | "error"
  | "done";

/** Statuses that still need a human before the broker can reach `done`. */
export const MANUAL_STATUSES: BrokerStatus[] = [
  "pending:confirm",
  "manual:captcha",
  "manual:login",
];

/** Statuses we consider terminal for a run (no further automated work). */
export const TERMINAL_STATUSES: BrokerStatus[] = ["not_found", "done"];

/** A blocking gate detected on a broker page. */
export type Gate = "captcha" | "login" | "confirm" | "none";

/** A curated broker opt-out catalog entry (brokers.json). */
export interface Broker {
  id: string;
  name: string;
  method: BrokerMethod;
  /** Search page used during discovery (may contain {placeholders}). */
  searchUrl?: string;
  /** Opt-out form / removal flow (form & url methods). */
  optOutUrl?: string;
  /** Opt-out inbox (email method). */
  optOutEmail?: string;
  /** Email subject/body template (email method); supports {placeholders}. */
  template?: {
    subject: string;
    body: string;
  };
  /** Optional per-broker CSS selectors to make discovery less brittle. */
  selectors?: {
    /** A listing/result card container. */
    listing?: string;
    /** Link to the full profile within a card. */
    link?: string;
    /** Name text within a card. */
    name?: string;
    /** Location text within a card. */
    location?: string;
    /** Age text within a card. */
    age?: string;
  };
  notes?: string;
}

/** The operator's own identity (profile.json — GITIGNORED). */
export interface Profile {
  fullName: string;
  aliases?: string[];
  email: string;
  phone?: string;
  birthYear?: number | null;
  currentCity?: string;
  currentState?: string;
  pastLocations?: string[];
  relatives?: string[];
}

/** A candidate listing surfaced during discovery. */
export interface Listing {
  url: string;
  name?: string;
  city?: string;
  state?: string;
  /** Some sites show an age instead of a birth year. */
  age?: number | null;
  birthYear?: number | null;
  relatives?: string[];
  /** Raw text snippet for debugging / audit. */
  raw?: string;
}

/** Result of scoring a listing against the operator's profile. */
export interface MatchResult {
  listing: Listing;
  score: number;
  matched: boolean;
  reasons: string[];
}

/** One transition in a broker's audit history. */
export interface HistoryEntry {
  ts: string;
  status: BrokerStatus;
  note?: string;
}

/** Persisted per-broker progress (state.json — GITIGNORED). */
export interface BrokerState {
  status: BrokerStatus;
  /** ISO timestamp of the last run that touched this broker (passed in). */
  lastRun: string | null;
  /** URLs of listings matched to the operator. */
  listingUrls: string[];
  /** Human-readable next action (a link to click, an inbox to check, …). */
  nextAction?: string;
  /** Screenshots captured at pauses/errors (paths under shots/). */
  screenshots?: string[];
  notes?: string;
  history?: HistoryEntry[];
}

/** The whole state file: brokerId -> progress. */
export type State = Record<string, BrokerState>;

/** A drafted opt-out email (never sent without explicit transport config). */
export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
}
