import { describe, it, expect } from "vitest";
import {
  classifyGate, gateSignalsFromText, fillTemplate, buildEmail,
} from "../src/optout.js";
import type { Broker, Profile } from "../src/types.js";

const me: Profile = {
  fullName: "Colten Krauter",
  email: "coltenkrauter@gmail.com",
  phone: "+1 555 555 0123",
  currentCity: "Austin",
  currentState: "TX",
  birthYear: 1991,
};

describe("classifyGate — priority order", () => {
  it("captcha outranks everything", () => {
    expect(classifyGate({ hasCaptcha: true, hasLogin: true, hasConfirm: true })).toBe("captcha");
  });
  it("login outranks confirm", () => {
    expect(classifyGate({ hasCaptcha: false, hasLogin: true, hasConfirm: true })).toBe("login");
  });
  it("confirm when only confirm", () => {
    expect(classifyGate({ hasCaptcha: false, hasLogin: false, hasConfirm: true })).toBe("confirm");
  });
  it("none when clear", () => {
    expect(classifyGate({ hasCaptcha: false, hasLogin: false, hasConfirm: false })).toBe("none");
  });
});

describe("gateSignalsFromText", () => {
  it("detects a CAPTCHA mention", () => {
    expect(gateSignalsFromText("Please complete the reCAPTCHA", false).hasCaptcha).toBe(true);
  });
  it("detects a login wall via text or a password field", () => {
    expect(gateSignalsFromText("Sign in to continue", false).hasLogin).toBe(true);
    expect(gateSignalsFromText("nothing here", true).hasLogin).toBe(true);
  });
  it("detects a confirmation prompt", () => {
    expect(gateSignalsFromText("We've sent a verification email, click the link", false).hasConfirm).toBe(true);
  });
});

describe("fillTemplate", () => {
  it("substitutes profile + extra placeholders, leaves unknown ones intact", () => {
    const out = fillTemplate("Hi {firstName} from {city}, ref {broker} {unknown}", me, { broker: "Spokeo" });
    expect(out).toBe("Hi Colten from Austin, ref Spokeo {unknown}");
  });
});

describe("buildEmail", () => {
  const broker: Broker = {
    id: "mylife", name: "MyLife", method: "email",
    optOutEmail: "privacy@mylife.com",
    template: {
      subject: "Removal — {fullName}",
      body: "Name: {fullName}\nEmail: {email}\nListing: {listingUrl}\nFrom {broker}",
    },
  };
  it("addresses the broker inbox and fills the template", () => {
    const d = buildEmail(broker, me, "https://mylife.com/colten");
    expect(d.to).toBe("privacy@mylife.com");
    expect(d.subject).toBe("Removal — Colten Krauter");
    expect(d.body).toContain("Email: coltenkrauter@gmail.com");
    expect(d.body).toContain("Listing: https://mylife.com/colten");
    expect(d.body).toContain("From MyLife");
  });
  it("falls back to a generic template when none is provided", () => {
    const bare: Broker = { id: "x", name: "X Broker", method: "email", optOutEmail: "p@x.com" };
    const d = buildEmail(bare, me);
    expect(d.to).toBe("p@x.com");
    expect(d.body).toContain("Colten Krauter");
    expect(d.body).toContain("X Broker");
  });
});
