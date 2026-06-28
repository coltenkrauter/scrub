import { describe, it, expect } from "vitest";
import { summarize, summaryLine, manualSteps, renderReport } from "../src/report.js";
import type { Broker, State } from "../src/types.js";

const brokers: Broker[] = [
  { id: "spokeo", name: "Spokeo", method: "url", optOutUrl: "https://spokeo.com/optout" },
  { id: "tps", name: "TruePeopleSearch", method: "form", optOutUrl: "https://tps/removal" },
  { id: "mylife", name: "MyLife", method: "email", optOutEmail: "privacy@mylife.com" },
  { id: "acxiom", name: "Acxiom", method: "form", optOutUrl: "https://acxiom/optout" },
];

const state: State = {
  spokeo: { status: "done", lastRun: "t", listingUrls: ["https://spokeo.com/p/1"] },
  tps: { status: "manual:captcha", lastRun: "t", listingUrls: ["https://tps/p/2"], nextAction: "solve the CAPTCHA at https://tps/p/2" },
  mylife: { status: "pending:confirm", lastRun: "t", listingUrls: [], nextAction: "send the drafted email to privacy@mylife.com" },
  acxiom: { status: "submitted", lastRun: "t", listingUrls: [] },
};

describe("summarize", () => {
  it("counts by status", () => {
    const s = summarize(state);
    expect(s.done).toBe(1);
    expect(s.manual).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.submitted).toBe(1);
    expect(s.total).toBe(4);
  });
});

describe("summaryLine", () => {
  it("renders a one-liner", () => {
    expect(summaryLine(state)).toMatch(/done 1 .* submitted 1 .* pending 1 .* manual 1/);
  });
});

describe("manualSteps", () => {
  it("returns only the human-blocked brokers, each with a link", () => {
    const steps = manualSteps(brokers, state);
    expect(steps.map((s) => s.broker.id).sort()).toEqual(["mylife", "tps"]);
    const tps = steps.find((s) => s.broker.id === "tps")!;
    expect(tps.link).toBe("https://tps/p/2");
  });
});

describe("renderReport", () => {
  const md = renderReport(brokers, state, "2026-06-27T10:00:00Z");
  it("includes the honesty note that submitted != removed", () => {
    expect(md).toMatch(/submitted.*removed/i);
  });
  it("numbers the remaining manual steps with links", () => {
    expect(md).toMatch(/1\. \*\*(TruePeopleSearch|MyLife)\*\*/);
    expect(md).toContain("[open](https://tps/p/2)");
  });
  it("lists every broker in the detail table", () => {
    for (const b of brokers) expect(md).toContain(b.name);
  });
  it("marks dry runs", () => {
    expect(renderReport(brokers, state, "t", { dryRun: true })).toMatch(/dry run/i);
  });
});
