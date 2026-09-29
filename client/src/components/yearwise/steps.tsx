import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type StepId, AREAS, DEST, FREQ, MOTIVES, WEEKDAYS, V, count, fmt, getP, ninetyOpts, legacyPillarScores,
} from "@shared/yearwise";
import {
  useYearwise, Why, Note, Hint, Card, Tag, Grid, StepHeading, SubHead, TextField, AreaField, Field,
  SelectField, PillarSelect, TrackSelect, NumList, Chips, IfThenRow, LifeRating, ReflectionPanel,
} from "./fields";

export interface StepContent {
  eyebrow: string;
  time?: string;
  title: string;
  lede?: string;
  intro?: boolean; // renders its own header
  Body: () => ReactNode;
}

/* ================= Begin ================= */

function Welcome() {
  const { dates: d } = useYearwise();
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-success">Your year, on purpose</div>
        <h1 className="font-serif text-2xl font-semibold leading-tight sm:text-3xl">Look back, choose a direction, then hand it to Daily Compass.</h1>
        <p className="text-muted-foreground">
          About two hours, best done in three sittings. Part 1 looks back at the last twelve months. Part 2 decides what to stop, keep and start. Part 3 turns it into an annual target, up to three 90-day goals, habits and your first two weeks, exported as Daily Compass weekly-goal rows.
        </p>
      </div>
      <Grid cols={2}>
        <Field path="planStart" label="When does the plan start? (a Monday)" kind="date" />
        <Hint className="self-end pb-2">Leave blank to use next Monday. Every date in the export is worked out from this.</Hint>
      </Grid>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Looking back", `${d.revFrom} – ${d.revTo}`],
          ["Week 1 starts", fmt(d.w1)],
          ["First 90 days end", fmt(d.q)],
          ["Annual target by", fmt(d.yearEnd)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border bg-card p-3">
            <small className="block text-xs text-muted-foreground">{k}</small>
            <b className="text-sm">{v}</b>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Part 1 · ~45 min", "Photos and calendar open. Rough notes are fine."],
          ["Part 2 · ~30 min", "Stop, continue, start. Every stop gets a replacement."],
          ["Part 3 · ~45 min", "Targets, if–then plans, habits and two weeks of goals."],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-accent/60 p-3 text-sm">
            <b className="block">{k}</b>
            <span className="text-muted-foreground">{v}</span>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="text-base font-semibold">What ends up in Daily Compass</div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted">
              <tr><th className="p-2 font-semibold">Yearwise</th><th className="p-2 font-semibold">Daily Compass</th></tr>
            </thead>
            <tbody className="divide-y">
              <tr><td className="p-2">Life check-in (10 areas)</td><td className="p-2">Shows where a goal or habit is needed; goals are then tagged with your 6 P's</td></tr>
              <tr><td className="p-2">Annual target</td><td className="p-2">Annual target (tier 1)</td></tr>
              <tr><td className="p-2">90-day goals + if–then plans</td><td className="p-2">90-day goals (tier 2)</td></tr>
              <tr><td className="p-2">Habits, weekly review, first two weeks</td><td className="p-2">Weekly goals CSV (tier 3), in your template's columns</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ================= Part 1 ================= */

function Months() {
  const { dates } = useYearwise();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {dates.months.map((m) => (
        <div key={m.key} className="space-y-2 rounded-lg border bg-card p-3">
          <h4 className="text-sm font-semibold">{m.label}</h4>
          {[0, 1].map((i) => <MonthInput key={i} path={`months.${m.key}.${i}`} aria={`${m.label} moment ${i + 1}`} />)}
        </div>
      ))}
    </div>
  );
}

function MonthInput({ path, aria }: { path: string; aria: string }) {
  const { answers, set } = useYearwise();
  const v = getP(answers, path);
  return <Input value={v == null ? "" : String(v)} onChange={(e) => set(path, e.target.value)} aria-label={aria} />;
}

function Lows() {
  return (
    <div className="space-y-6">
      <NumList path="lows" n={5} label="The low points that stand out" placeholder="e.g. The bid that went quiet for six weeks" />
      <AreaField path="lowNeed" label="What did you need most in those moments?" placeholder="Rest, help, a clearer boundary, someone to think it through with…" />
    </div>
  );
}

function Highs() {
  return (
    <div className="space-y-6">
      <NumList path="highs" n={5} label="The high points that stand out" placeholder="e.g. Selected for the AM1207 PM role" />
      <AreaField path="highThreads" label="What did your best moments have in common?" placeholder="Who was there, what kind of work, how you felt…" />
    </div>
  );
}

function Lessons() {
  return (
    <div className="space-y-4">
      <Why>Writing about setbacks self-compassionately makes people more motivated to improve than self-criticism does (Breines &amp; Chen, 2012). The friend question is there for that.</Why>
      {[0, 1, 2].map((i) => {
        const p = `lessonsHigh.${i}`;
        return (
          <Card key={p}>
            <Tag>High {i + 1}</Tag>
            <TextField path={p + ".point"} ariaLabel={`High point ${i + 1}`} placeholder="Tap one from your list or type it" />
            <Chips src="highs" target={p + ".point"} />
            <AreaField path={p + ".learned"} label="What it taught me about myself" />
          </Card>
        );
      })}
      {[0, 1, 2].map((i) => {
        const p = `lessonsLow.${i}`;
        return (
          <Card key={p}>
            <Tag tone="low">Low {i + 1}</Tag>
            <TextField path={p + ".point"} ariaLabel={`Low point ${i + 1}`} placeholder="Tap one from your list or type it" />
            <Chips src="lows" target={p + ".point"} />
            <AreaField path={p + ".friend"} label="What would you say to a friend who went through this?" />
            <AreaField path={p + ".learned"} label="What it taught me about myself" />
          </Card>
        );
      })}
    </div>
  );
}

function Checkin() {
  const { answers } = useYearwise();
  const legacy = legacyPillarScores(answers);
  return (
    <div className="space-y-4">
      {legacy.length > 0 && (
        <Why label="Kept">Your earlier 6 P's scores are saved and included in the export: {legacy.map((x) => x[0] + " " + x[1]).join(", ")}.</Why>
      )}
      <div className="rounded-lg border bg-card px-4">
        {AREAS.map(([k, n]) => <LifeRating key={k} areaKey={k} name={n} />)}
      </div>
    </div>
  );
}

/* ================= Part 2 ================= */

function Future() {
  const { dates } = useYearwise();
  return (
    <div className="space-y-6">
      <Why>Writing about your best possible self reliably lifts optimism (Carrillo et al., 2019), and gives you material for your Starts.</Why>
      <AreaField path="bestSelf" label={`It's ${dates.endLabel}. What does a normal week look like?`} placeholder="Monday I'm… The work I'm doing is… At home…" />
      <NumList path="bestThree" n={3} label="The three things in that picture that matter most" />
    </div>
  );
}

function Lead({ children, optional }: { children: ReactNode; optional: boolean }) {
  return (
    <div className="flex items-center gap-2 font-semibold">
      {children}
      {optional && <Tag tone="opt">optional</Tag>}
    </div>
  );
}

function Stop() {
  return (
    <div className="space-y-4">
      <Why>Goals framed as doing something succeeded 59% of the time against 47% for goals framed as avoiding something (Oscarsson et al., 2020). The 'Instead' line turns each stop into a do-goal, and it can become a habit in Part 3.</Why>
      {[0, 1, 2].map((i) => {
        const p = `stop.${i}`;
        return (
          <Card key={p} accent="border-l-destructive">
            <Lead optional={i > 0}>I will stop…</Lead>
            <TextField path={p + ".what"} ariaLabel={`Stop ${i + 1}`} big placeholder={i === 0 ? "e.g. Checking email before 9am" : undefined} />
            <Grid cols={2}>
              <Field path={p + ".why"} label="Why does this need to stop?" />
              <Field path={p + ".cost"} label="What has it cost you so far?" />
            </Grid>
            <TextField path={p + ".instead"} label="Instead, I will…" placeholder="e.g. Do one hour of deep work first thing" />
          </Card>
        );
      })}
    </div>
  );
}

function Cont() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => {
        const p = `cont.${i}`;
        return (
          <Card key={p} accent="border-l-success">
            <Lead optional={i > 0}>I will continue…</Lead>
            <TextField path={p + ".what"} ariaLabel={`Continue ${i + 1}`} big placeholder={i === 0 ? "e.g. Riding three mornings a week" : undefined} />
            <Grid cols={2}>
              <Field path={p + ".proof"} label="What shows this is working?" />
              <Field path={p + ".keep"} label="One simple way to keep it going" />
            </Grid>
          </Card>
        );
      })}
    </div>
  );
}

function Start() {
  const { answers } = useYearwise();
  return (
    <div className="space-y-4">
      <Why>Goals you pursue because they matter to you make more progress than ones driven by 'should' (Koestner et al., 2008). Be honest in the motive box; it matters more than the wording of the goal.</Why>
      {[0, 1, 2].map((i) => {
        const p = `start.${i}`;
        return (
          <Card key={p} accent="border-l-amber-500">
            <Lead optional={i > 0}>I will start…</Lead>
            <TextField path={p + ".what"} ariaLabel={`Start ${i + 1}`} big placeholder={i === 0 ? "e.g. Publishing one LinkedIn article a month" : undefined} />
            <Grid cols={2}>
              <Field path={p + ".why"} label="Why do you want to start this?" />
              <Field path={p + ".adds"} label="What will it add to your life?" />
            </Grid>
            <Grid cols={2}>
              <PillarSelect path={p + ".pillar"} />
              <SelectField path={p + ".motive"} label="Mostly because…" options={MOTIVES} />
            </Grid>
            {V(answers, p + ".motive") === "should" && (
              <Note>Mostly "should". Consider whether a different start would pull you more; these tend to stall.</Note>
            )}
            <Grid cols={2}>
              <SelectField path={p + ".dest"} label="Where will this go in the plan?" options={DEST} />
            </Grid>
          </Card>
        );
      })}
    </div>
  );
}

/* ================= Part 3 ================= */

function Annual() {
  const { answers, dates } = useYearwise();
  return (
    <div className="space-y-5">
      <ReflectionPanel />
      <StepHeading n={1} title="Choose what the year is for" hint="The annual target should be the outcome that would change your lowest scores most. It can come from a start, or from your best-year picture. Something small you'll do every month is a habit, not an annual target." />
      <Chips src="annualsrc" target="annual.title" />
      <TextField path="annual.title" label="My annual target" placeholder="Short title, as it will appear in Daily Compass" />
      <StepHeading n={2} title="Make it an outcome" hint="A goal is an outcome that wouldn't happen unless you did something about it." />
      <AreaField path="annual.outcome" label={`By ${fmt(dates.yearEnd)}, what will be true?`} />
      <TextField path="annual.measure" label="How you'll measure it" hint="A number or a clear yes/no by a date. Vague targets can't be tracked." placeholder="e.g. 4 advisory clients on retainer, £X monthly recurring" />
      <Grid cols={2}>
        <PillarSelect path="annual.pillar" />
        <SelectField path="annual.motive" label="Mostly because…" options={MOTIVES} />
      </Grid>
      {V(answers, "annual.motive") === "should" && (
        <Note>A "should" target is a warning sign. Is there a version of this you want for its own sake?</Note>
      )}
      <StepHeading n={3} title="Check it fits your real life" hint="Time, energy, boundaries, support." />
      <AreaField path="annual.needs" label="What I need in place to succeed" />
    </div>
  );
}

function Ninety() {
  const { dates } = useYearwise();
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">For {fmt(dates.start)} to {fmt(dates.q)}. At least one should move the annual target. Three is the ceiling; fewer is fine.</p>
      <Why>Mental contrasting with if–then plans (WOOP: wish, outcome, obstacle, plan) has a reliable effect on goal attainment, g ≈ 0.34 across 21 studies (Wang et al., 2021). The order matters: picture the outcome, then the obstacle inside you, then the plan.</Why>
      <ReflectionPanel />
      {[0, 1, 2].map((i) => {
        const p = `ninety.${i}`;
        return (
          <Card key={p}>
            <div className="flex gap-2">
              <Tag>90-day goal {i + 1}</Tag>
              {i > 0 && <Tag tone="opt">optional</Tag>}
            </div>
            <Chips src="ninetysrc" target={p + ".title"} />
            <TextField path={p + ".title"} ariaLabel={`90-day goal ${i + 1} title`} big placeholder={i === 0 ? "Short title, as it will appear in Daily Compass" : undefined} />
            <Grid cols={3}>
              <PillarSelect path={p + ".pillar"} />
              <TrackSelect path={p + ".track"} />
              <SelectField path={p + ".annual"} label="Moves the annual target?" options={[["yes", "Yes"], ["no", "No, it's a balance goal"]]} />
            </Grid>
            <Field path={p + ".done"} label={`Done by ${fmt(dates.q)} means…`} kind="text" placeholder="Include a number or a yes/no, e.g. signed PO for 2 days a week" />
            <SubHead>WOOP</SubHead>
            <Grid cols={2}>
              <Field path={p + ".outcome"} label="Best outcome: what changes if you pull this off?" />
              <Field path={p + ".obstacle"} label="Main obstacle in you: a habit, feeling or belief" placeholder="e.g. I let client work eat the mornings" />
            </Grid>
            <SubHead>If–then plans</SubHead>
            <Hint>
              <b>If</b> = the moment your obstacle shows up: a time, a place, a feeling or a thought. <b>Then</b> = one action you can take right then. Not "if I want X, then I need to Y", but "if I catch myself putting off the email, then I send it before lunch".
            </Hint>
            {[1, 2, 3].map((k) => <IfThenRow key={k} path={p} k={k} />)}
          </Card>
        );
      })}
    </div>
  );
}

function AddRow({ path, def, children }: { path: string; def: number; children: ReactNode }) {
  const { answers, set } = useYearwise();
  return (
    <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => set(path + ".n", count(answers, path, def) + 1)}>
      {children}
    </Button>
  );
}

function Habits() {
  const { answers } = useYearwise();
  const n = count(answers, "habits", 3);
  const parents = ninetyOpts(answers);
  return (
    <div className="space-y-4">
      <Why>Habits take a median of about two months to form, and much longer for some people. A consistent time and place, and doing them in the morning, speeds that up (Singh et al., 2024).</Why>
      <ReflectionPanel />
      {Array.from({ length: n }, (_, i) => {
        const p = `habits.${i}`;
        return (
          <Card key={p}>
            <Tag>Habit {i + 1}</Tag>
            <Chips src="habitsrc" target={p + ".what"} />
            <TextField path={p + ".what"} ariaLabel={`Habit ${i + 1}`} big placeholder="Tap a suggestion above, or type one" />
            <Field path={p + ".cue"} label="When and where exactly?" kind="text" placeholder="After my first coffee, at my desk" />
            <Grid cols={4}>
              <SelectField path={p + ".freq"} label="How often" options={FREQ.map((f) => [f.key, f.label] as const)} />
              <PillarSelect path={p + ".pillar"} />
              <Field path={p + ".mins"} label="Mins each time" kind="num" placeholder="30" />
              <SelectField path={p + ".parent"} label="Supports" options={parents} blank="No 90-day goal" />
            </Grid>
          </Card>
        );
      })}
      <AddRow path="habits" def={3}>+ Add a habit</AddRow>
    </div>
  );
}

function Weeks() {
  const { answers, dates } = useYearwise();
  const parents = ninetyOpts(answers);
  const weeks: [string, Date, number][] = [["w1", dates.w1, 3], ["w2", dates.w2, 2]];
  return (
    <div className="space-y-4">
      {weeks.map(([w, date, def], wi) => {
        const n = count(answers, "weeks." + w, def);
        return (
          <div key={w} className="space-y-4">
            <div className="flex items-baseline justify-between gap-2 border-b pb-2 pt-2">
              <h2 className="font-serif text-xl font-semibold">Week {wi + 1}</h2>
              <span className="text-sm text-muted-foreground">w/c {fmt(date)}</span>
            </div>
            {Array.from({ length: n }, (_, i) => {
              const p = `weeks.${w}.${i}`;
              return (
                <Card key={p}>
                  <TextField path={p + ".title"} ariaLabel={`Week ${wi + 1} goal ${i + 1}`} big placeholder={wi === 0 && i === 0 ? "e.g. Draft article 1 outline" : undefined} />
                  <Field path={p + ".desc"} label="Description" kind="text" />
                  <Grid cols={4}>
                    <PillarSelect path={p + ".pillar"} />
                    <TrackSelect path={p + ".track"} />
                    <SelectField path={p + ".priority"} label="Priority" options={[["1", "1 · must do"], ["2", "2 · should"], ["3", "3 · nice to have"]]} />
                    <Field path={p + ".mins"} label="Minutes" kind="num" placeholder="60" />
                  </Grid>
                  <Grid cols={2}>
                    <SelectField path={p + ".parent"} label="90-day goal" options={parents} blank="None" />
                    <Field path={p + ".notes"} label="Notes" kind="text" />
                  </Grid>
                </Card>
              );
            })}
            <AddRow path={"weeks." + w} def={def}>+ Add a goal to week {wi + 1}</AddRow>
          </div>
        );
      })}
      <Grid cols={2}>
        <SelectField path="addHabits" label="Add your habits to each week's rows?" options={[["yes", "Yes"], ["no", "No"]]} blank="Yes (default)" />
      </Grid>
    </div>
  );
}

function Rhythm() {
  return (
    <div className="space-y-5">
      <Why>Tracking progress improves goal attainment (d = 0.40 across 138 studies), more so when it's written down and shared with someone (Harkin et al., 2016). Telling someone whose opinion you respect raises commitment (Klein et al., 2020).</Why>
      <Grid cols={3}>
        <SelectField path="review.day" label="Weekly review day" options={WEEKDAYS} />
        <Field path="review.time" label="Time" kind="text" placeholder="08:00" />
        <Field path="review.mins" label="Minutes" kind="num" placeholder="20" />
      </Grid>
      <Hint>Each review: what got done, what slipped and why, a 1–10 score for progress on each 90-day goal, and next week's goals.</Hint>
      <TextField path="tell.who" label="Who will you tell about the annual target?" hint="Pick someone whose judgement you respect." placeholder="Name" />
      <AreaField path="tell.ask" label="What specific help will you ask them for?" placeholder="e.g. Ask me at the end of each month whether article 1 is out" />
      <Grid cols={2}>
        <SelectField path="tell.freq" label="How often will you update them?" options={[["fortnightly", "Fortnightly"], ["monthly", "Monthly"], ["quarterly", "At the 90-day mark"]]} />
      </Grid>
      <TextField path="firstStep" label="Your first small step, which you'll do today or tomorrow" placeholder="Something that takes under 15 minutes" />
    </div>
  );
}

/* ================= Output (built in the next stage) ================= */

function Output() {
  return (
    <div className="space-y-4">
      <Card>
        <p>The readiness check, weekly-goal preview, exports and "Commit to Daily Compass" are the next build stage.</p>
        <Hint>Your answers are saved to this session as you go, so nothing here needs doing yet.</Hint>
      </Card>
      <p className="border-l-4 border-success pl-4 font-serif text-lg italic">
        Come back to this at the 90-day mark: re-score the ten life areas, run stop / continue / start again, and set the next three goals.
      </p>
    </div>
  );
}

export const STEP_CONTENT: Record<StepId, StepContent> = {
  welcome: { eyebrow: "", title: "", intro: true, Body: Welcome },
  months: {
    eyebrow: "Warm-up", time: "10 min", title: "Scroll back through the last twelve months",
    lede: "Go through your photos and calendar month by month. Note the big moments, the hard ones and the small ordinary ones. You are just collecting, not judging.",
    Body: Months,
  },
  lows: {
    eyebrow: "Question 1", time: "8 min", title: "What were the low points?",
    lede: "Write them down plainly. Naming what knocked you down is where changing it starts.",
    Body: Lows,
  },
  highs: {
    eyebrow: "Question 2", time: "8 min", title: "What were the high points?",
    lede: "Which days would you happily live again?",
    Body: Highs,
  },
  lessons: {
    eyebrow: "Question 3", time: "10 min", title: "What did the year teach you about yourself?",
    lede: "Take three highs and three lows and name the lesson in each.",
    Body: Lessons,
  },
  checkin: {
    eyebrow: "Check-in", time: "12 min", title: "Where does each part of your life stand right now?",
    lede: "Score each area from 1 to 10 on gut feel. Say why, then describe what two points better would look like by next year. Low scores tell you where a goal or habit is needed.",
    Body: Checkin,
  },
  future: {
    eyebrow: "Imagine", time: "8 min", title: "It's a year from now and it went well",
    lede: "Picture an ordinary week at the end of the year ahead, after things went as well as they realistically could. Write it in the present tense.",
    Body: Future,
  },
  stop: {
    eyebrow: "Question 4", time: "8 min", title: "What will you stop doing?",
    lede: "Drop what no longer serves you. Quit because it doesn't fit your values, not because you're scared of it. Every stop needs something to do instead.",
    Body: Stop,
  },
  cont: {
    eyebrow: "Question 5", time: "6 min", title: "What will you keep doing?",
    lede: "You're not starting from scratch. Carry forward the habits, people and choices that are already working.",
    Body: Cont,
  },
  start: {
    eyebrow: "Question 6", time: "10 min", title: "What will you start doing?",
    lede: "Something new brings energy. Use your low-scoring life areas and your best-possible-year picture for ideas.",
    Body: Start,
  },
  annual: {
    eyebrow: "Tier 1", time: "10 min", title: "Pick one annual target",
    lede: "Turn one start into the single outcome the year is for. You can have other goals, but this one gets first claim on your time.",
    Body: Annual,
  },
  ninety: { eyebrow: "Tier 2", time: "15 min", title: "Set up to three 90-day goals", Body: Ninety },
  habits: {
    eyebrow: "Recurring", time: "8 min", title: "Turn stops and keeps into habits",
    lede: "Pick the replacements, keeps and starts that should happen on repeat. Give each a fixed time and place. Replacements you use only when tempted can be set to \"When needed\" so they don't count as planned time.",
    Body: Habits,
  },
  weeks: {
    eyebrow: "Tier 3", time: "12 min", title: "Plan your first two weeks",
    lede: "Break the 90-day goals into dated weekly goals. Put your very first small step in week 1. Priority 1 is must-do, 3 is nice to have.",
    Body: Weeks,
  },
  rhythm: {
    eyebrow: "Keep it going", time: "6 min", title: "Set your review rhythm and tell someone",
    lede: "The plan only works if you look at it. A short weekly review goes into every week's goals automatically.",
    Body: Rhythm,
  },
  output: { eyebrow: "Output", title: "Your plan, ready for Daily Compass", Body: Output },
};
