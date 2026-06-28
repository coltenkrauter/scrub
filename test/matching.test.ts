import { describe, it, expect } from "vitest";
import {
  normalize, nameTokens, nameMatches, locationMatches,
  birthYearFromAge, birthYearMatches, relativeOverlap, scoreMatch, matchListings,
} from "../src/matching.js";
import type { Profile, Listing } from "../src/types.js";

const me: Profile = {
  fullName: "Colten Krauter",
  aliases: ["Colt Krauter"],
  email: "coltenkrauter@gmail.com",
  birthYear: 1991,
  currentCity: "Austin",
  currentState: "TX",
  pastLocations: ["Denver, CO"],
  relatives: ["Jordan Krauter"],
};
const REF = 2026;

describe("normalize", () => {
  it("lowercases, strips punctuation, collapses space", () => {
    expect(normalize("  Colten  Q. Krauter! ")).toBe("colten q krauter");
    expect(normalize(undefined)).toBe("");
  });
});

describe("nameTokens", () => {
  it("splits first/middle/last", () => {
    expect(nameTokens("Colten M. Krauter")).toEqual({ first: "colten", last: "krauter", middle: ["m"] });
  });
});

describe("nameMatches", () => {
  it("matches exact and middle-name variants", () => {
    expect(nameMatches(me, "Colten Krauter")).toBe(true);
    expect(nameMatches(me, "Colten Michael Krauter")).toBe(true);
  });
  it("matches a first initial", () => {
    expect(nameMatches(me, "C Krauter")).toBe(true);
  });
  it("matches an alias", () => {
    expect(nameMatches(me, "Colt Krauter")).toBe(true);
  });
  it("rejects different last name and different person", () => {
    expect(nameMatches(me, "Colten Smith")).toBe(false);
    expect(nameMatches(me, "John Krauter")).toBe(false);
    expect(nameMatches(me, "")).toBe(false);
    expect(nameMatches(me, undefined)).toBe(false);
  });
});

describe("locationMatches", () => {
  it("matches current city/state", () => {
    expect(locationMatches(me, { url: "", city: "Austin", state: "TX" })).toBe(true);
  });
  it("matches a past location with full-name state", () => {
    expect(locationMatches(me, { url: "", city: "Denver", state: "Colorado" })).toBe(true);
  });
  it("does not match on state alone or a wrong city", () => {
    expect(locationMatches(me, { url: "", state: "TX" })).toBe(false);
    expect(locationMatches(me, { url: "", city: "Miami", state: "FL" })).toBe(false);
  });
});

describe("birthYear", () => {
  it("derives from age", () => {
    expect(birthYearFromAge(35, REF)).toBe(1991);
  });
  it("tolerates off-by-one ages", () => {
    expect(birthYearMatches(me, { url: "", age: 35 }, REF)).toBe(true); // 1991
    expect(birthYearMatches(me, { url: "", age: 34 }, REF)).toBe(true); // 1992, within 1
    expect(birthYearMatches(me, { url: "", age: 33 }, REF)).toBe(false); // 1993, off by 2
    expect(birthYearMatches(me, { url: "", birthYear: 1991 }, REF)).toBe(true);
  });
});

describe("relativeOverlap", () => {
  it("finds shared relatives case-insensitively", () => {
    expect(relativeOverlap(me, { url: "", relatives: ["jordan krauter", "x"] })).toEqual(["jordan krauter"]);
    expect(relativeOverlap(me, { url: "", relatives: ["Nobody"] })).toEqual([]);
  });
});

describe("scoreMatch — the safety gate", () => {
  it("name + corroborator => matched", () => {
    const r = scoreMatch(me, { url: "u", name: "Colten Krauter", city: "Austin", state: "TX" }, { referenceYear: REF });
    expect(r.matched).toBe(true);
    expect(r.score).toBeGreaterThan(0.5);
  });
  it("name ONLY => NOT matched (won't act on a same-named stranger)", () => {
    const r = scoreMatch(me, { url: "u", name: "Colten Krauter" }, { referenceYear: REF });
    expect(r.matched).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/name-only/i);
  });
  it("name match but wrong location and no other corroborator => NOT matched", () => {
    const r = scoreMatch(me, { url: "u", name: "Colten Krauter", city: "Miami", state: "FL" }, { referenceYear: REF });
    expect(r.matched).toBe(false);
  });
  it("different person => NOT matched", () => {
    const r = scoreMatch(me, { url: "u", name: "Bob Smith", city: "Austin", state: "TX" }, { referenceYear: REF });
    expect(r.matched).toBe(false);
  });
});

describe("matchListings", () => {
  it("filters to matches and sorts by score desc", () => {
    const listings: Listing[] = [
      { url: "weak", name: "Colten Krauter", city: "Austin", state: "TX" },
      { url: "strong", name: "Colten Krauter", city: "Austin", state: "TX", birthYear: 1991, relatives: ["Jordan Krauter"] },
      { url: "nope", name: "Colten Krauter" },
      { url: "stranger", name: "Bob Smith", city: "Austin", state: "TX" },
    ];
    const out = matchListings(me, listings, { referenceYear: REF });
    expect(out.map((m) => m.listing.url)).toEqual(["strong", "weak"]);
  });
});
