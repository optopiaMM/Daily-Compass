import { describe, it, expect } from "vitest";
import {
  deriveDates, iso, nextMonday, planStart, reviewMonths, habitWeeklyMins,
  WEAK_IF, WEAK_THEN, ifThenIssue, IF_MSG, migrateParents, parentTitle, stepProgress,
} from "./yearwise";

// Local-time dates, as the wizard uses.
const d = (s: string) => {
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day);
};

describe("date derivation", () => {
  it("next Monday is the coming Monday, or today on a Monday", () => {
    expect(iso(nextMonday(d("2026-09-29")))).toBe("2026-10-05"); // Tuesday
    expect(iso(nextMonday(d("2026-10-04")))).toBe("2026-10-05"); // Sunday
    expect(iso(nextMonday(d("2026-10-05")))).toBe("2026-10-05"); // Monday
  });

  it("defaults a blank plan start to next Monday", () => {
    expect(iso(planStart({}, d("2026-09-29")))).toBe("2026-10-05");
    expect(iso(planStart({ planStart: "" }, d("2026-09-29")))).toBe("2026-10-05");
  });

  it("snaps the plan start back to that week's Monday", () => {
    expect(iso(planStart({ planStart: "2026-10-05" }))).toBe("2026-10-05"); // Monday stays
    expect(iso(planStart({ planStart: "2026-10-08" }))).toBe("2026-10-05"); // Thursday
    expect(iso(planStart({ planStart: "2026-10-11" }))).toBe("2026-10-05"); // Sunday
  });

  it("derives week 1, week 2, 90-day end and annual target date", () => {
    const x = deriveDates({ planStart: "2026-10-05" });
    expect(iso(x.w1)).toBe("2026-10-05");
    expect(iso(x.w2)).toBe("2026-10-12");
    expect(iso(x.q)).toBe("2027-01-03");
    expect(iso(x.yearEnd)).toBe("2027-10-04");
    expect(x.endLabel).toBe("September 2027");
  });

  it("handles a start on the 1st and a January start", () => {
    const x = deriveDates({ planStart: "2027-02-01" });
    expect(iso(x.yearEnd)).toBe("2028-01-31");
    const j = deriveDates({ planStart: "2027-01-04" });
    expect(j.endLabel).toBe("December 2027");
  });

  it("looks back over the 12 months ending with the start month", () => {
    const ms = reviewMonths(d("2026-10-05"));
    expect(ms).toHaveLength(12);
    expect(ms[0]).toEqual({ key: "2025-11", label: "November 2025" });
    expect(ms[11]).toEqual({ key: "2026-10", label: "October 2026" });
    const x = deriveDates({ planStart: "2026-10-05" });
    expect(x.revFrom).toBe("November 2025");
    expect(x.revTo).toBe("October 2026");
  });
});

describe("habit frequency time maths", () => {
  it("multiplies minutes by the per-week multiplier", () => {
    expect(habitWeeklyMins(45, "4pw")).toBe(180);
    expect(habitWeeklyMins(180, "2pm")).toBe(90);
    expect(habitWeeklyMins(30, "daily")).toBe(210);
    expect(habitWeeklyMins(30, "weekdays")).toBe(150);
    expect(habitWeeklyMins(60, "weekly")).toBe(60);
    expect(habitWeeklyMins(60, "monthly")).toBe(15);
    expect(habitWeeklyMins("25", "3pw")).toBe(75);
  });

  it("rounds to whole minutes", () => {
    expect(habitWeeklyMins(10, "monthly")).toBe(3); // 2.5 → 3
  });

  it("gives no time for unscheduled habits or missing minutes", () => {
    expect(habitWeeklyMins(30, "asneeded")).toBeNull();
    expect(habitWeeklyMins(30, "rule")).toBeNull();
    expect(habitWeeklyMins("", "daily")).toBeNull();
  });

  it("counts once a week when no frequency is chosen", () => {
    expect(habitWeeklyMins(40, "")).toBe(40);
  });
});

describe("if–then quality check", () => {
  // The five examples from the spec (text as typed after the "If" / "then" labels).
  it("flags 'if I want this work' as weak", () => {
    expect(WEAK_IF.test("I want this work")).toBe(true);
    expect(ifThenIssue("I want this work", "I send the proposal")).toBe(IF_MSG.weakIf);
  });
  it("accepts 'if I catch myself putting off a call'", () => {
    expect(WEAK_IF.test("I catch myself putting off a call")).toBe(false);
    expect(ifThenIssue("I catch myself putting off a call", "I dial within 5 minutes")).toBe("");
  });
  it("flags 'then I need to eat better' as weak", () => {
    expect(WEAK_THEN.test("I need to eat better")).toBe(true);
    expect(ifThenIssue("it's 3pm", "I need to eat better")).toBe(IF_MSG.weakThen);
  });
  it("flags 'then I am limiting…' as weak", () => {
    expect(WEAK_THEN.test("I am limiting…")).toBe(true);
    expect(ifThenIssue("it's 3pm", "I am limiting…")).toBe(IF_MSG.weakThen);
  });
  it("accepts 'then I send it before lunch'", () => {
    expect(WEAK_THEN.test("I send it before lunch")).toBe(false);
    expect(ifThenIssue("I catch myself putting off the email", "I send it before lunch")).toBe("");
  });

  it("asks for a 'then' when only the 'if' is filled, and is quiet when both are blank", () => {
    expect(ifThenIssue("it's 3pm and I haven't called", "")).toBe(IF_MSG.missingThen);
    expect(ifThenIssue("", "")).toBe("");
  });
});

describe("parent references", () => {
  it("resolves g-refs to the current title and migrates legacy titles", () => {
    const a = {
      ninety: { 0: { title: "Win CUSP" }, 1: { title: "Ride 3x" } },
      habits: { 0: { parent: "Ride 3x" }, 1: { parent: "g0" } },
      weeks: { w1: { 0: { parent: "Win CUSP" } } },
    };
    const m = migrateParents(a);
    expect((m as any).habits[0].parent).toBe("g1");
    expect((m as any).habits[1].parent).toBe("g0");
    expect((m as any).weeks.w1[0].parent).toBe("g0");
    expect(parentTitle(m, "g1")).toBe("Ride 3x");
  });
});

describe("step progress", () => {
  it("counts months with any entry out of 12", () => {
    const a = { planStart: "2026-10-05", months: { "2026-10": { 0: "x" }, "2025-11": { 1: "y" }, "2024-01": { 0: "z" } } };
    expect(stepProgress("months", a)).toBeCloseTo(2 / 12);
  });
  it("counts required fields only", () => {
    expect(stepProgress("lows", { lows: { 0: "a", 3: "optional" }, lowNeed: "rest" })).toBe(0.5);
    expect(stepProgress("output", {})).toBeNull();
  });
});
