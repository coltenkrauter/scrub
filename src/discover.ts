/**
 * Discovery: open a broker's own search and find listings that match the
 * operator's profile. We deliberately use the broker's normal search UI, fetch
 * a single results page, and stop — no crawling, no scraping whole sites.
 *
 * The matching itself lives in matching.ts (pure + tested). This module is just
 * the Playwright glue that turns a results page into candidate Listings.
 */

import type { Page } from "playwright";
import type { Broker, Listing, MatchResult, Profile } from "./types.js";
import { fillTemplate } from "./optout.js";
import { matchListings } from "./matching.js";

/** Build a broker search URL from its template and the profile. */
export function buildSearchUrl(broker: Broker, profile: Profile): string | null {
  if (!broker.searchUrl) return null;
  const first = profile.fullName.split(/\s+/)[0] ?? "";
  const last = profile.fullName.split(/\s+/).slice(-1)[0] ?? "";
  return fillTemplate(broker.searchUrl, profile, {
    firstName: encodeURIComponent(first),
    lastName: encodeURIComponent(last),
    fullName: encodeURIComponent(profile.fullName),
    city: encodeURIComponent(profile.currentCity ?? ""),
    state: encodeURIComponent(profile.currentState ?? ""),
  });
}

/** Parse an "Age 35" / "35 years old" style fragment into a number. */
export function parseAge(text: string): number | null {
  const m = text.match(/\bage[:\s]*?(\d{1,3})\b/i) ?? text.match(/\b(\d{1,3})\s*years?\s*old\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n < 120 ? n : null;
}

/** Parse "City, ST" out of a free-text fragment. */
export function parseLocation(text: string): { city?: string; state?: string } {
  const m = text.match(/([A-Za-z .'-]+),\s*([A-Z]{2})\b/);
  if (!m) return {};
  return { city: m[1]!.trim(), state: m[2] };
}

/**
 * Extract candidate listings from a results page. Uses per-broker selectors when
 * provided (more reliable), else a generic heuristic over anchor cards.
 *
 * Brokers move their markup constantly — when extraction returns nothing, that
 * is reported as `not_found`, never as an error, and the operator can verify by
 * hand from the search URL in the report.
 */
export async function extractListings(page: Page, broker: Broker): Promise<Listing[]> {
  const sel = broker.selectors;
  if (sel?.listing) {
    return page.$$eval(
      sel.listing,
      (cards, s) =>
        cards.map((card) => {
          const pick = (q?: string) =>
            q ? (card.querySelector(q)?.textContent ?? "").trim() : "";
          const linkEl = s.link
            ? (card.querySelector(s.link) as HTMLAnchorElement | null)
            : (card.querySelector("a") as HTMLAnchorElement | null);
          return {
            url: linkEl?.href ?? "",
            name: pick(s.name),
            location: pick(s.location),
            age: pick(s.age),
            raw: (card.textContent ?? "").trim().slice(0, 400),
          };
        }),
      sel,
    ).then((rows) =>
      rows.map((r) => {
        const loc = r.location ? parseLocationStr(r.location) : {};
        return {
          url: r.url,
          name: r.name || undefined,
          city: loc.city,
          state: loc.state,
          age: r.age ? Number(r.age.replace(/\D/g, "")) || null : null,
          raw: r.raw,
        } satisfies Listing;
      }),
    );
  }

  // Generic fallback: anchors that look like profile links, with nearby text.
  const rows = await page.$$eval("a", (anchors) =>
    anchors
      .filter((a) => /\/(person|profile|name|p|fp)\b|find-?people|people\//i.test(a.href))
      .slice(0, 40)
      .map((a) => ({
        url: a.href,
        text: (a.closest("li,article,div,tr")?.textContent ?? a.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 400),
        name: (a.textContent ?? "").replace(/\s+/g, " ").trim(),
      })),
  );

  return rows.map((r) => {
    const loc = parseLocation(r.text);
    return {
      url: r.url,
      name: r.name || undefined,
      city: loc.city,
      state: loc.state,
      age: parseAge(r.text),
      raw: r.text,
    } satisfies Listing;
  });
}

// Browser-context helper duplicated for $$eval serialization (string form below).
function parseLocationStr(text: string): { city?: string; state?: string } {
  const m = text.match(/([A-Za-z .'-]+),\s*([A-Z]{2})\b/);
  if (!m) return {};
  return { city: m[1]!.trim(), state: m[2] };
}

/**
 * Full discovery for one broker: navigate the search, extract candidates, and
 * return only confident matches against the operator's profile.
 */
export async function discover(
  page: Page,
  broker: Broker,
  profile: Profile,
  opts: { referenceYear: number; timeoutMs?: number },
): Promise<MatchResult[]> {
  const url = buildSearchUrl(broker, profile);
  if (!url) return [];
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs ?? 30_000 });
  await page.waitForTimeout(1_500); // let client-rendered results settle
  const listings = await extractListings(page, broker);
  return matchListings(profile, listings, { referenceYear: opts.referenceYear });
}
