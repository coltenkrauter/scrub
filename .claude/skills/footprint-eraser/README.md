# footprint-eraser — what it will and won't do

A privacy tool that removes **your own** personal data from data brokers /
people-search sites using their own opt-out controls. It is intentionally
conservative: it would rather pause and hand you a link than do anything risky.

## ✅ Will
- Act **only on your own identity** — and require name + a corroborator
  (city/state, birth year, or a relative) before treating a listing as yours, so
  it won't act on a same-named stranger.
- Use each broker's **own opt-out / removal flow** (the privacy controls they
  publish for exactly this).
- Work **one broker at a time, human-paced**, with a delay between brokers to
  respect rate limits.
- **Pause at every gate** and tell you precisely what to do:
  - CAPTCHA → saves a screenshot + URL, marks `manual:captcha`.
  - Login wall → marks `manual:login`.
  - Email/SMS confirmation → marks `pending:confirm` and notes the inbox.
- **Draft** opt-out emails for email-based brokers for you to send yourself.
- Track per-broker progress in `state.json` and only mark a broker **`done` when
  the removal is verified** (the listing is gone on a later run).
- Keep all PII out of git (`profile.json`, `state.json`, `report.md`, `shots/`
  are gitignored).

## 🚫 Won't
- **Never** solve, bypass, or outsource a **CAPTCHA**.
- **Never** type or guess **credentials**, or log into your accounts.
- **Never** **fabricate a confirmation** or claim an unconfirmed removal worked.
- **Never** act on **anyone else's** identity.
- **Never** scrape whole sites or hammer brokers — it fetches a single search
  results page per broker, then stops.
- **Never** auto-send email using credentials you didn't explicitly configure.

## How matching stays safe
`src/matching.ts` requires a **name match _and_ at least one corroborator**
before a listing counts as yours. A name-only hit is reported but never acted
on. If your profile has no corroborating fields, discovery returns `not_found`
by design rather than guessing.
