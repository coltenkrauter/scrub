/**
 * Opt-out strategies, one per broker `method`, plus gate detection.
 *
 * HARD RULES (enforced here, not just documented):
 *  - We NEVER solve, bypass, or outsource a CAPTCHA. If one appears we stop and
 *    hand it to the operator.
 *  - We NEVER type credentials. A login wall is a hard stop.
 *  - We NEVER fabricate a confirmation. A submit that isn't verifiably complete
 *    is reported as `submitted` or `pending:confirm`, never `done`.
 *  - Email opt-outs are DRAFTED. They are only sent if an explicit transport is
 *    configured by the operator — we never send credentials we weren't given.
 */

import type { Page } from "playwright";
import type { Broker, EmailDraft, Gate, Profile } from "./types.js";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested) — no Playwright, no network.
// ---------------------------------------------------------------------------

export interface GateSignals {
  hasCaptcha: boolean;
  hasLogin: boolean;
  hasConfirm: boolean;
}

/**
 * Decide which gate (if any) is blocking us, given boolean signals extracted
 * from a page. Order matters: a CAPTCHA outranks everything (we must stop), then
 * a login wall, then a "check your inbox" confirmation prompt.
 */
export function classifyGate(sig: GateSignals): Gate {
  if (sig.hasCaptcha) return "captcha";
  if (sig.hasLogin) return "login";
  if (sig.hasConfirm) return "confirm";
  return "none";
}

const CAPTCHA_HINTS = [
  "recaptcha", "g-recaptcha", "hcaptcha", "h-captcha", "cf-turnstile",
  "are you a human", "i'm not a robot", "captcha", "press and hold",
  "verify you are human",
];

const LOGIN_HINTS = [
  "sign in", "log in", "login", "create an account", "password",
  "your account", "member login",
];

const CONFIRM_HINTS = [
  "check your email", "verification email", "confirmation email",
  "we've sent", "we have sent", "click the link", "confirm your request",
  "verify your request", "a text message", "we sent you a code",
];

/** Lightweight text-based gate inference (used as a fallback to DOM checks). */
export function gateSignalsFromText(text: string, hasPasswordField: boolean): GateSignals {
  const t = text.toLowerCase();
  const has = (hints: string[]) => hints.some((h) => t.includes(h));
  return {
    hasCaptcha: has(CAPTCHA_HINTS),
    hasLogin: hasPasswordField || has(LOGIN_HINTS),
    hasConfirm: has(CONFIRM_HINTS),
  };
}

/** Substitute {placeholders} in a template from the profile. */
export function fillTemplate(tpl: string, profile: Profile, extra: Record<string, string> = {}): string {
  const map: Record<string, string> = {
    fullName: profile.fullName,
    firstName: profile.fullName.split(/\s+/)[0] ?? "",
    lastName: profile.fullName.split(/\s+/).slice(-1)[0] ?? "",
    email: profile.email,
    phone: profile.phone ?? "",
    city: profile.currentCity ?? "",
    state: profile.currentState ?? "",
    birthYear: profile.birthYear != null ? String(profile.birthYear) : "",
    ...extra,
  };
  return tpl.replace(/\{(\w+)\}/g, (m, key: string) => (key in map ? map[key]! : m));
}

/** Build the opt-out email for an `email`-method broker. Pure; does not send. */
export function buildEmail(broker: Broker, profile: Profile, listingUrl?: string): EmailDraft {
  const to = broker.optOutEmail ?? "";
  const subjectTpl = broker.template?.subject ?? "Opt-out / data removal request";
  const bodyTpl =
    broker.template?.body ??
    [
      "Hello,",
      "",
      "Under applicable privacy laws, I request the removal of my personal",
      "information from {broker} and that you do not sell or share it.",
      "",
      "Name: {fullName}",
      "Email: {email}",
      "Listing: {listingUrl}",
      "",
      "Please confirm once removed.",
      "Thank you,",
      "{fullName}",
    ].join("\n");
  const extra = { broker: broker.name, listingUrl: listingUrl ?? "(see attached)" };
  return {
    to,
    subject: fillTemplate(subjectTpl, profile, extra),
    body: fillTemplate(bodyTpl, profile, extra),
  };
}

// ---------------------------------------------------------------------------
// Playwright-driven detection & form filling.
// ---------------------------------------------------------------------------

/** Inspect a live page and classify any blocking gate. */
export async function detectGate(page: Page): Promise<Gate> {
  // DOM-level checks first (most reliable for CAPTCHA widgets / login forms).
  const hasCaptchaDom = await page
    .locator(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, ' +
        '.h-captcha, [data-sitekey], iframe[src*="turnstile"]',
    )
    .count()
    .then((n) => n > 0)
    .catch(() => false);

  const hasPasswordField = await page
    .locator('input[type="password"]')
    .count()
    .then((n) => n > 0)
    .catch(() => false);

  const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
  const sig = gateSignalsFromText(bodyText, hasPasswordField);
  if (hasCaptchaDom) sig.hasCaptcha = true;
  return classifyGate(sig);
}

/**
 * Best-effort generic form fill: map profile fields onto inputs by matching the
 * field's name/id/placeholder/label against known aliases. Returns the count of
 * fields we filled (so the caller can tell whether the form was understood).
 */
export async function fillForm(page: Page, profile: Profile): Promise<number> {
  const fields: { value: string | undefined; aliases: string[] }[] = [
    { value: profile.fullName, aliases: ["fullname", "full name", "name", "your name"] },
    { value: profile.fullName.split(/\s+/)[0], aliases: ["firstname", "first name", "fname", "given"] },
    { value: profile.fullName.split(/\s+/).slice(-1)[0], aliases: ["lastname", "last name", "lname", "surname", "family"] },
    { value: profile.email, aliases: ["email", "e-mail", "mail"] },
    { value: profile.phone, aliases: ["phone", "tel", "mobile"] },
    { value: profile.currentCity, aliases: ["city", "town"] },
    { value: profile.currentState, aliases: ["state", "region", "province"] },
  ];

  let filled = 0;
  for (const f of fields) {
    if (!f.value) continue;
    for (const alias of f.aliases) {
      const selector =
        `input[name*="${alias}" i], input[id*="${alias}" i], ` +
        `input[placeholder*="${alias}" i], textarea[name*="${alias}" i]`;
      const loc = page.locator(selector).first();
      const exists = await loc.count().then((n) => n > 0).catch(() => false);
      if (!exists) continue;
      try {
        await loc.fill(f.value, { timeout: 5_000 });
        filled++;
        break;
      } catch {
        /* try next alias */
      }
    }
  }
  return filled;
}
