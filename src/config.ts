/**
 * Paths, loaders, and profile validation.
 *
 * validateProfile is pure (object in -> verdict out) so the "own identity only"
 * and completeness checks are unit-testable.
 */

import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Broker, Profile } from "./types.js";

/** Repo-root-relative paths. The skill and cron run from the repo root. */
export function paths(root: string = process.cwd()) {
  const footprint = resolve(root, ".claude/footprint");
  const skill = resolve(root, ".claude/skills/footprint-eraser");
  return {
    root,
    footprint,
    profile: resolve(footprint, "profile.json"),
    profileExample: resolve(footprint, "profile.example.json"),
    state: resolve(footprint, "state.json"),
    report: resolve(footprint, "report.md"),
    shots: resolve(footprint, "shots"),
    brokers: resolve(skill, "brokers.json"),
  };
}

/** The example identity that must NOT survive into a real profile. */
export const EXAMPLE_NAME = "Jane Q. Public";

export interface ProfileVerdict {
  ok: boolean;
  /** Blocking problems — the run must stop. */
  problems: string[];
  /** Non-blocking warnings — the run can proceed but matching is weaker. */
  warnings: string[];
}

/**
 * Validate a profile before any action. Blocks if it's missing core identity or
 * is still the shipped example. Warns (but allows) if there's nothing to
 * corroborate a match with — matching will then conservatively find nothing.
 */
export function validateProfile(p: Partial<Profile>): ProfileVerdict {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!p.fullName || !p.fullName.trim()) {
    problems.push("profile.fullName is empty");
  } else if (p.fullName.trim().toLowerCase() === EXAMPLE_NAME.toLowerCase()) {
    problems.push(
      `profile.fullName is still the example "${EXAMPLE_NAME}" — fill in your real name`,
    );
  }

  if (!p.email || !/.+@.+\..+/.test(p.email)) {
    problems.push("profile.email is missing or not an email address");
  }

  const hasCity = !!(p.currentCity && p.currentState);
  const hasYear = p.birthYear != null;
  const hasRelatives = !!(p.relatives && p.relatives.length > 0);
  const hasPast = !!(p.pastLocations && p.pastLocations.length > 0);
  if (!hasCity && !hasYear && !hasRelatives && !hasPast) {
    warnings.push(
      "profile has no city/state, birthYear, relatives, or pastLocations — " +
        "matches cannot be corroborated, so discovery will report not_found to " +
        "stay safe. Add at least one to enable matching.",
    );
  }

  return { ok: problems.length === 0, problems, warnings };
}

export function loadProfile(path: string): Profile {
  if (!existsSync(path)) {
    throw new Error(`profile not found at ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as Profile;
}

export function loadBrokers(path: string): Broker[] {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(data)) throw new Error("brokers.json must be an array");
  return data as Broker[];
}

/** If profile.json is missing, seed it from the example and signal the caller. */
export function ensureProfileScaffold(profilePath: string, examplePath: string): boolean {
  if (existsSync(profilePath)) return false;
  if (!existsSync(examplePath)) throw new Error(`missing ${examplePath}`);
  copyFileSync(examplePath, profilePath);
  return true; // freshly created — operator must fill it in
}
