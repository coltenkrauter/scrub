import { describe, it, expect } from "vitest";
import { validateProfile, EXAMPLE_NAME } from "../src/config.js";
import type { Profile } from "../src/types.js";

describe("validateProfile — the own-identity / readiness gate", () => {
  it("blocks the shipped example identity", () => {
    const v = validateProfile({ fullName: EXAMPLE_NAME, email: "you@example.com", currentCity: "Austin", currentState: "TX" });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/example/i);
  });
  it("blocks an empty name", () => {
    expect(validateProfile({ fullName: "", email: "a@b.com" }).ok).toBe(false);
  });
  it("blocks a missing/invalid email", () => {
    expect(validateProfile({ fullName: "Colten Krauter", email: "" }).ok).toBe(false);
    expect(validateProfile({ fullName: "Colten Krauter", email: "nope" }).ok).toBe(false);
  });
  it("warns (but allows) when there is nothing to corroborate a match", () => {
    const v = validateProfile({ fullName: "Colten Krauter", email: "c@k.com" });
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/corroborat/i);
  });
  it("passes cleanly with name + email + a corroborator", () => {
    const p: Profile = {
      fullName: "Colten Krauter", email: "c@k.com", currentCity: "Austin", currentState: "TX",
    };
    const v = validateProfile(p);
    expect(v.ok).toBe(true);
    expect(v.warnings).toEqual([]);
  });
});
