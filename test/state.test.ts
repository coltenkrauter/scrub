import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadState, saveState, ensureBroker, isComplete,
  recordNotFound, recordListings, recordSubmitted, recordPendingConfirm,
  recordGate, recordError, markDone,
} from "../src/state.js";
import type { State } from "../src/types.js";

const TS1 = "2026-06-27T10:00:00.000Z";
const TS2 = "2026-07-04T10:00:00.000Z";

const dirs: string[] = [];
function tmpFile(): string {
  const d = mkdtempSync(join(tmpdir(), "scrub-state-"));
  dirs.push(d);
  return join(d, "state.json");
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("load/save", () => {
  it("returns {} when the file is missing", () => {
    expect(loadState(tmpFile())).toEqual({});
  });
  it("round-trips through disk", () => {
    const f = tmpFile();
    const s: State = { spokeo: { status: "submitted", lastRun: TS1, listingUrls: ["u"] } };
    saveState(f, s);
    expect(loadState(f)).toEqual(s);
  });
});

describe("ensureBroker", () => {
  it("creates a new entry but leaves existing ones untouched", () => {
    const a = ensureBroker({}, "spokeo");
    expect(a.spokeo).toEqual({ status: "new", lastRun: null, listingUrls: [] });
    const b = ensureBroker(a, "spokeo");
    expect(b.spokeo).toBe(a.spokeo);
  });
});

describe("recordNotFound", () => {
  it("new -> not_found", () => {
    const s = recordNotFound({}, "spokeo", TS1);
    expect(s.spokeo!.status).toBe("not_found");
    expect(s.spokeo!.lastRun).toBe(TS1);
  });
  it("submitted -> done (verified gone)", () => {
    let s = recordSubmitted({}, "spokeo", TS1);
    s = recordNotFound(s, "spokeo", TS2);
    expect(s.spokeo!.status).toBe("done");
    expect(s.spokeo!.history?.at(-1)?.note).toMatch(/verified removed/i);
  });
  it("pending:confirm -> done (verified gone)", () => {
    let s = recordPendingConfirm({}, "spokeo", TS1, "inbox");
    s = recordNotFound(s, "spokeo", TS2);
    expect(s.spokeo!.status).toBe("done");
  });
});

describe("transitions", () => {
  it("recordListings accumulates unique urls without changing status", () => {
    let s = recordListings({}, "spokeo", ["a", "b"], TS1);
    s = recordListings(s, "spokeo", ["b", "c"], TS2);
    expect(s.spokeo!.listingUrls).toEqual(["a", "b", "c"]);
    expect(s.spokeo!.status).toBe("new");
  });
  it("recordSubmitted sets submitted + a verify next action", () => {
    const s = recordSubmitted({}, "spokeo", TS1);
    expect(s.spokeo!.status).toBe("submitted");
    expect(s.spokeo!.nextAction).toMatch(/verify/i);
  });
  it("recordPendingConfirm notes the inbox", () => {
    const s = recordPendingConfirm({}, "spokeo", TS1, "you@example.com");
    expect(s.spokeo!.status).toBe("pending:confirm");
    expect(s.spokeo!.nextAction).toMatch(/you@example\.com/);
  });
  it("recordGate(captcha) -> manual:captcha with screenshot + action", () => {
    const s = recordGate({}, "tps", "captcha", TS1, {
      url: "https://x/removal", screenshot: "/shots/tps-captcha.png", action: "solve the CAPTCHA",
    });
    expect(s.tps!.status).toBe("manual:captcha");
    expect(s.tps!.screenshots).toContain("/shots/tps-captcha.png");
    expect(s.tps!.nextAction).toBe("solve the CAPTCHA");
    expect(s.tps!.listingUrls).toContain("https://x/removal");
  });
  it("recordGate(login) -> manual:login", () => {
    const s = recordGate({}, "wp", "login", TS1, { action: "log in yourself" });
    expect(s.wp!.status).toBe("manual:login");
  });
  it("recordError captures the message + screenshot", () => {
    const s = recordError({}, "x", TS1, "boom", "/shots/x-error.png");
    expect(s.x!.status).toBe("error");
    expect(s.x!.notes).toBe("boom");
    expect(s.x!.screenshots).toContain("/shots/x-error.png");
  });
  it("markDone -> done", () => {
    const s = markDone({}, "x", TS1, "user confirmed");
    expect(s.x!.status).toBe("done");
  });
});

describe("isComplete", () => {
  it("done and not_found are complete; others are not", () => {
    expect(isComplete({ status: "done", lastRun: null, listingUrls: [] })).toBe(true);
    expect(isComplete({ status: "not_found", lastRun: null, listingUrls: [] })).toBe(true);
    expect(isComplete({ status: "submitted", lastRun: null, listingUrls: [] })).toBe(false);
    expect(isComplete(undefined)).toBe(false);
  });
});

describe("immutability", () => {
  it("does not mutate the input state", () => {
    const before: State = {};
    const after = recordSubmitted(before, "spokeo", TS1);
    expect(before).toEqual({});
    expect(after).not.toBe(before);
  });
});
