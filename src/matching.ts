/**
 * Pure profile -> listing matching. No I/O, no network, no Playwright — so it
 * can be unit-tested in isolation and audited easily.
 *
 * Design goal: be CONSERVATIVE. A name alone is never enough to act on — common
 * names collide constantly, and acting on the wrong person would violate the
 * "own identity only" rule. We require the name to match AND at least one
 * independent corroborator (location, birth year, or a shared relative).
 */

import type { Listing, MatchResult, Profile } from "./types.js";

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalize(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a normalized name into tokens, dropping single-letter middle initials. */
export function nameTokens(name: string): { first: string; last: string; middle: string[] } {
  const tokens = normalize(name).split(" ").filter(Boolean);
  if (tokens.length === 0) return { first: "", last: "", middle: [] };
  if (tokens.length === 1) return { first: tokens[0]!, last: "", middle: [] };
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  const middle = tokens.slice(1, -1);
  return { first, last, middle };
}

/**
 * Does a candidate name plausibly match the operator? Compares against the
 * profile's fullName and any aliases. Requires first + last token to match;
 * middle names/initials are optional and never disqualify.
 */
export function nameMatches(profile: Profile, candidateName: string | undefined): boolean {
  if (!candidateName) return false;
  const cand = nameTokens(candidateName);
  if (!cand.first || !cand.last) return false;

  const candidates = [profile.fullName, ...(profile.aliases ?? [])].filter(Boolean);
  for (const known of candidates) {
    const k = nameTokens(known);
    if (!k.first || !k.last) continue;
    // First initial OR full first name; last name must match in full.
    const firstOk =
      k.first === cand.first ||
      (k.first.length === 1 && cand.first.startsWith(k.first)) ||
      (cand.first.length === 1 && k.first.startsWith(cand.first));
    const lastOk = k.last === cand.last;
    if (firstOk && lastOk) return true;
  }
  return false;
}

/** Collect the operator's known locations as normalized "city|state" hints. */
function knownLocations(profile: Profile): { city: string; state: string }[] {
  const out: { city: string; state: string }[] = [];
  if (profile.currentCity || profile.currentState) {
    out.push({ city: normalize(profile.currentCity), state: normalize(profile.currentState) });
  }
  for (const loc of profile.pastLocations ?? []) {
    // "Denver, CO" -> city "denver", state "co"
    const [city, state] = loc.split(",").map((p) => normalize(p));
    out.push({ city: city ?? "", state: state ?? "" });
  }
  return out;
}

export function locationMatches(profile: Profile, listing: Listing): boolean {
  const lc = normalize(listing.city);
  const ls = normalize(listing.state);
  if (!lc && !ls) return false;
  for (const known of knownLocations(profile)) {
    const cityOk = !!known.city && known.city === lc;
    const stateOk = !!known.state && (known.state === ls || abbrevMatches(known.state, ls));
    // City match is strong; a bare state match is weak, so require city when present.
    if (cityOk && (stateOk || !ls || !known.state)) return true;
    if (!lc && stateOk && known.city === "") return false; // never corroborate on state alone
  }
  return false;
}

/** Loose US state full-name <-> abbreviation tolerance for the common cases. */
function abbrevMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const map: Record<string, string> = {
    tx: "texas", co: "colorado", ca: "california", ny: "new york",
    fl: "florida", wa: "washington", il: "illinois", az: "arizona",
    ga: "georgia", nc: "north carolina", oh: "ohio", pa: "pennsylvania",
  };
  return map[a] === b || map[b] === a;
}

/** Derive a birth year from an age, given the run's reference year. */
export function birthYearFromAge(age: number, referenceYear: number): number {
  return referenceYear - age;
}

export function birthYearMatches(
  profile: Profile,
  listing: Listing,
  referenceYear: number,
): boolean {
  if (profile.birthYear == null) return false;
  let listingYear = listing.birthYear ?? null;
  if (listingYear == null && listing.age != null) {
    listingYear = birthYearFromAge(listing.age, referenceYear);
  }
  if (listingYear == null) return false;
  // Ages on broker sites are frequently off by a year (birthday not yet passed).
  return Math.abs(listingYear - profile.birthYear) <= 1;
}

export function relativeOverlap(profile: Profile, listing: Listing): string[] {
  const known = new Set((profile.relatives ?? []).map((r) => normalize(r)));
  const found: string[] = [];
  for (const rel of listing.relatives ?? []) {
    if (known.has(normalize(rel))) found.push(rel);
  }
  return found;
}

/**
 * Score a single listing against the operator's profile.
 *
 * matched === true requires: name match AND >=1 corroborator. This is the gate
 * that keeps the tool acting only on the operator's own identity.
 */
export function scoreMatch(
  profile: Profile,
  listing: Listing,
  opts: { referenceYear: number },
): MatchResult {
  const reasons: string[] = [];
  let score = 0;

  const nameOk = nameMatches(profile, listing.name);
  if (nameOk) {
    score += 0.5;
    reasons.push(`name matches "${listing.name}"`);
  }

  const locOk = locationMatches(profile, listing);
  if (locOk) {
    score += 0.25;
    reasons.push(`location matches (${listing.city ?? "?"}, ${listing.state ?? "?"})`);
  }

  const dobOk = birthYearMatches(profile, listing, opts.referenceYear);
  if (dobOk) {
    score += 0.2;
    reasons.push("birth year matches");
  }

  const rels = relativeOverlap(profile, listing);
  if (rels.length > 0) {
    score += 0.15 * rels.length;
    reasons.push(`shared relative(s): ${rels.join(", ")}`);
  }

  const corroborated = locOk || dobOk || rels.length > 0;
  const matched = nameOk && corroborated;
  if (nameOk && !corroborated) {
    reasons.push("name-only — NOT acted on (needs corroboration)");
  }

  return { listing, score: Math.min(score, 1), matched, reasons };
}

/** Score many listings, returning only confident matches, highest score first. */
export function matchListings(
  profile: Profile,
  listings: Listing[],
  opts: { referenceYear: number },
): MatchResult[] {
  return listings
    .map((l) => scoreMatch(profile, l, opts))
    .filter((m) => m.matched)
    .sort((a, b) => b.score - a.score);
}
