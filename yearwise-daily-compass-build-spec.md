# Yearwise → Daily Compass: build spec

**Purpose:** add Yearwise to Daily Compass as its planning front end. Yearwise is the reflection and goal-setting exercise that sits above the four-tier cascade: once a year in full, a lighter version every 90 days. It replaces the standalone claude.ai prototype, whose code comes with this spec as `yearwise.html`.

**How to use this spec:** sections 1–6 describe what the module does and why. Section 7 contains Claude Code prompts, ready to paste and run in order. Every prompt starts by detecting the existing repo patterns rather than assuming them.

---

## 1. What Yearwise does

A guided exercise of about two hours, in three parts plus an output step. It turns a year's reflection into Daily Compass records.

| Part | Time | Steps | Produces |
|---|---|---|---|
| Before you start | 2 min | Plan start date (a Monday) | All dates for the plan |
| 1 · Look back | ~45 min | Month by month · Low points · High points · Lessons · Life check-in | Reflection data, 10 life-area scores |
| 2 · Choose direction | ~30 min | Best possible year · Stop · Continue · Start | Candidate goals and habits |
| 3 · Commit | ~45 min | Annual target · 90-day goals (WOOP) · Habits · First two weeks · Review & support | Tier 1–3 records, habits, if–then plans |
| Output | 5 min | Readiness check → commit to Daily Compass | Written records, and optional CSV/JSON/MD export |

### How it maps onto the cascade

| Yearwise | Daily Compass |
|---|---|
| Life check-in (10 areas, 1–10) | New `life_checkins` history, which shows where a goal or habit is needed |
| Annual target | Tier 1 annual target |
| 90-day goals + WOOP + if–then plans | Tier 2 90-day goals, plus new `if_then_plans` |
| Habits | New recurring `habits` table. These also generate weekly-goal rows until recurring activities exist |
| First two weeks | Tier 3 weekly goals (existing CSV columns) |
| Weekly review | New `weekly_reviews` table. Also generated as a priority-1 weekly goal each week |
| Stops, continues, starts, lessons | Stored with the session for the 90-day and annual reviews |

Goals are **tagged** with the 6 P's pillars. The **assessment** uses the 10 life areas. The two are deliberately separate.

---

## 2. Evidence base

Each step has a one-line "Why" note in the UI, based on the following research.

| Design choice | Evidence |
|---|---|
| Every Stop needs an "Instead, I will…" | Goals framed as doing something succeeded 58.9% of the time against 47.1% for goals framed as avoiding something, in a 1-year trial with n=1,066 (Oscarsson et al., 2020, *PLOS ONE*) |
| WOOP order on 90-day goals: outcome → inner obstacle → if–then | Mental contrasting with implementation intentions: g = 0.34 across 21 studies and ~16k people; self-administered versions are weaker, so the prompts must be tight (Wang et al., 2021, *Frontiers in Psychology*) |
| Weekly progress score plus a review loop | Monitoring progress improves attainment, d = 0.40 across 138 studies; the effect is stronger when progress is recorded physically and reported publicly (Harkin et al., 2016, *Psychological Bulletin*) |
| Habits have a fixed cue, and expectations are set at 2+ months | Median 59–66 days to form a habit, range 4–335; morning timing, a stable context and self-chosen habits help (Singh et al., 2024, *Healthcare*) |
| "Want or should?" check on starts and the annual target | Goals pursued for autonomous reasons make more progress (Koestner et al., 2008, *J Personality*) |
| Self-compassion prompt on low points | A self-compassionate framing of failure increases motivation to improve (Breines & Chen, 2012, *PSPB*) |
| Best-possible-year writing | Reliably raises optimism (Carrillo et al., 2019, *PLOS ONE*) |
| Tell someone whose judgement you respect, with a specific ask | Telling a higher-status audience raises commitment (Klein et al., 2020, *J Applied Psych*) |
| 90-day cycles and fresh-start prompts | Temporal landmarks increase aspirational behaviour (Dai, Milkman & Riis, 2014, *Management Science*) |
| At most 3 × 90-day goals, light-touch prompts | In the same resolutions trial, the "some support" group did better than the group given intensive goal-setting instruction |

---

## 3. Screens, prompts and fields

Field keys are the prototype's state paths. They are the recommended JSON keys for the session's `answers` column.
**R** = required for section progress, **O** = optional.

### 3.0 Before you start
- `planStart` (date, R). Snap it to that week's Monday; if blank, default to the next Monday.
- Show the derived dates:
  - look-back period: the 12 calendar months ending with the start month
  - week 1 = start
  - week 2 = start + 7 days
  - 90-day end = start + 90 days
  - annual target by = the same date next year, minus 1 day

### 3.1 Month by month (warm-up, ~10 min)
- Prompt: *"Go through your photos and calendar month by month. Note the big moments, the hard ones and the small ordinary ones. You are just collecting, not judging."*
- `months.<YYYY-MM>.0/1` (text, O). There are two lines per month, for the 12 months of the look-back period.
- Progress = months with at least one entry ÷ 12.

### 3.2 Low points (Question 1, ~8 min)
- *"What were the low points?"* Lede: *"Write them down plainly. Naming what knocked you down is where changing it starts."*
- `lows.0–4` (text; the first 3 are R).
- `lowNeed` (textarea, R): *"What did you need most in those moments?"*

### 3.3 High points (Question 2, ~8 min)
- `highs.0–4` (text; the first 3 are R).
- `highThreads` (textarea, R): *"What did your best moments have in common?"*

### 3.4 Lessons (Question 3, ~10 min)
- Three high cards, `lessonsHigh.i.point` and `lessonsHigh.i.learned`. `point` can be picked from chips showing `highs`.
- Three low cards, `lessonsLow.i.point`, `lessonsLow.i.friend` (O) and `lessonsLow.i.learned`.
  - `friend` prompt: *"What would you say to a friend who went through this?"*

### 3.5 Life check-in (~12 min)
- For each of 10 areas: `life.<key>.score` (1–10), `life.<key>.why` (R) and `life.<key>.plus2` (O, *"+2 by <end month> would look like…"*).
- Area keys: `health` Health · `work` Work · `money` Money · `love` Love life · `friends` Friendships · `happiness` Happiness · `fun` Fun · `spirit` Spirituality · `meaning` Meaning & purpose · `selflove` Self-love.
- The scale runs 1–10, labelled "Struggling" to "Thriving". Clicking the selected value again clears it.

### 3.6 Best possible year (~8 min)
- `bestSelf` (textarea, R): *"It's <end month>. What does a normal week look like?"* Written in the present tense.
- `bestThree.0–2` (R): *"The three things in that picture that matter most."*

### 3.7 Stop (Question 4, ~8 min)
- Three cards; the first is R and the rest O.
- Fields: `stop.i.what`, `stop.i.why` (*"Why does this need to stop?"*), `stop.i.cost` (*"What has it cost you so far?"*) and `stop.i.instead` (*"Instead, I will…"*).
- Rule: every stop needs an `instead`, which becomes a habit candidate.

### 3.8 Continue (Question 5, ~6 min)
- Fields: `cont.i.what`, `cont.i.proof` (*"What shows this is working?"*) and `cont.i.keep` (*"One simple way to keep it going"*).
- `what` becomes a habit candidate.

### 3.9 Start (Question 6, ~10 min)
- Fields:
  - `start.i.what`
  - `start.i.why`
  - `start.i.adds`
  - `start.i.pillar` (6 P's)
  - `start.i.motive`: `want` | `mixed` | `should`
  - `start.i.dest`: `annual` | `ninety` | `habit` | `week` | `later`, from the prompt *"Where will this go in the plan?"*
- If `motive = should`, show a note: *"Mostly 'should'. Consider whether a different start would pull you more; these tend to stall."*

### 3.10 Annual target (Tier 1, ~10 min)
- The **reflection panel** appears at the top (see §4.4).
- Step 1 prompt: *"The annual target should be the outcome that would change your lowest scores most. It can come from a start, or from your best-year picture. Something small you'll do every month is a habit, not an annual target."*
- Chips: starts plus best-three.
- Fields:
  - `annual.title`
  - `annual.outcome` (*"By <date>, what will be true?"*)
  - `annual.measure` (*"How you'll measure it"*; must contain a number or a clear yes/no)
  - `annual.pillar`
  - `annual.motive`
  - `annual.needs`

### 3.11 90-day goals (Tier 2, ~15 min)
- The reflection panel appears at the top. Up to 3 cards; goal 1 is R and goals 2–3 are O. Chips: starts with `dest ∈ {ninety, ""}` plus best-three.
- Fields:
  - `title`
  - `pillar`
  - `track`: IBM/Nuvantiq | QASR | Agilia | CUSP | SE Water | Other → `trackOther`, free text
  - `annual`: `yes` | `no` (a "no" is a balance goal)
  - `done` (*"Done by <90-day end> means…"*; must contain a number)
  - WOOP: `outcome` (*"Best outcome: what changes if you pull this off?"*) and `obstacle` (*"Main obstacle in you: a habit, feeling or belief"*)
  - If–then plans: `if1/then1` (R), `if2/then2` and `if3/then3` (O)
- Guide text shown above the if–then plans: *"If = the moment your obstacle shows up: a time, a place, a feeling or a thought. Then = one action you can take right then. Not 'if I want X, then I need to Y', but 'if I catch myself putting off the email, then I send it before lunch'."*
- Live if–then quality check: see §4.3.

### 3.12 Habits (~8 min)
- The reflection panel appears at the top. Rows are dynamic (default 3, with "+ Add a habit").
- Chips: every stop's `instead`, every continue's `what`, and starts with `dest ∈ {habit, ""}`.
- Fields:
  - `habits.i.what`
  - `cue` (*"When and where exactly?"*)
  - `freq`
  - `pillar`
  - `mins` (per occurrence)
  - `parent`: a 90-day goal reference, stored as `g0` / `g1` / `g2`, **not** as the title
- Frequency options, with their per-week multiplier for time maths:

| key | label | ×/week |
|---|---|---|
| daily | Every day | 7 |
| weekdays | Weekdays | 5 |
| 4pw | 4× a week | 4 |
| 3pw | 3× a week | 3 |
| 2pw | 2× a week | 2 |
| weekly | Once a week | 1 |
| 2pm | 2× a month | 0.5 |
| monthly | Once a month | 0.25 |
| asneeded | When needed (a replacement, not scheduled) | 0 (no time) |
| rule | A rule for every day (no time block) | 0 (no time) |

### 3.13 First two weeks (Tier 3, ~12 min)
- Week 1 (w/c start) and week 2 (w/c start + 7), with dynamic rows: 3 by default in week 1 and 2 in week 2.
- Fields per row:
  - `title`
  - `desc`
  - `pillar`
  - `track`
  - `priority`: 1 must do / 2 should / 3 nice to have
  - `mins`
  - `parent` (`gN`)
  - `notes`
- `addHabits`: yes (the default) or no. Controls whether habits generate weekly rows.

### 3.14 Review & support (~6 min)
- `review.day` (Mon–Sun), `review.time` (free text) and `review.mins` (default 20).
- `tell.who`, `tell.ask` (*"What specific help will you ask them for?"*) and `tell.freq` (fortnightly | monthly | quarterly).
- `firstStep`: *"Your first small step, which you'll do today or tomorrow."*

### 3.15 Output
- Readiness checklist (§4.2), then a preview of the weekly-goal rows and planned hours per week.
- Actions: **Commit to Daily Compass** (new), Download CSV, Download JSON, Copy summary (MD).

---

## 4. Logic

### 4.1 Dates
- `start = monday(planStart ?? nextMonday())`
- `w1 = start`, `w2 = start + 7d`, `q_end = start + 90d`, `year_end = start + 1y − 1d`
- Look-back months are the 12 calendar months ending with `start`'s month.
- All dates are written as `YYYY-MM-DD` in local time.

### 4.2 Readiness checks
Each check shows ✓ or !. None of them block the commit; they only warn.
1. The annual target has a title and a measure. Warn if the measure contains no digit.
2. There is at least one 90-day goal, and at least one has `annual = yes`.
3. Every 90-day goal has a pillar and at least one complete if–then plan.
4. Warn for each 90-day goal whose `done` contains no digit.
5. Warn for each 90-day goal with weak if–then plans (§4.3), and give the count.
6. Every stop has an `instead`.
7. Warn for each start whose `dest ≠ later` that isn't matched in the annual target, a 90-day title, a habit or a weekly-goal title. Match on exact text, or on at least 2 shared words longer than 3 letters.
8. Week 1 has at least one goal. List by title any weekly goal missing a pillar or `mins`.
9. The weekly review day is set.
10. Warn if any start or the annual target has `motive = should`.
11. List life areas scoring 5 or below, lowest first: *"Check a goal or habit addresses at least the lowest."*

### 4.3 If–then quality check
Weak "if", which states a wish rather than a moment:
`/^\s*(i\s+(want|need|would like|wish|should)|i'?d like)\b/i`

Weak "then", which states an intention or consequence rather than an action:
`/^\s*i\s+(need|have|should|must|ought)\s+to\b|^\s*i\s+(need|should|must)\b|^\s*(i am|i'm|it will|it'll|that will|that's)\b/i`

Messages, shown live under each plan:
- Weak if: *"The 'if' is a wish, not a moment. Name when the obstacle shows up: a time, a place, a feeling or a thought."*
- Weak then: *"The 'then' is an intention or a consequence, not an action. Name one thing you'll physically do right then."*
- Missing then: *"Add the 'then': one specific action."*

### 4.4 Reflection panel
The panel sits on the annual target, 90-day goal and habit screens, and is open by default. It shows:
- life areas scoring 5 or below, with each area's `+2` text
- `bestThree`
- `highThreads`
- `lowNeed`
- all start `what` entries

Its purpose is to stop Part 1 insight getting lost between the reflection and the goals.

### 4.5 Parent references
- Store the 90-day goal parent as a stable reference (`g0`–`g2` in the prototype, a real FK in Daily Compass), never as the title.
- Migration for legacy title strings: if a stored parent equals a current 90-day title, replace it with that goal's reference.

### 4.6 Weekly-goal row generation
For each week (w1, w2):
1. Output every planned row with a title:
   - `status = not_started`
   - priority defaults to 2
   - `parent_90day_goal` is the resolved title in the CSV, or the FK in the database
2. If `addHabits ≠ no`, add one row per habit:
   - `goal_title = "Habit: " + what`
   - `goal_description = cue · short frequency label`
   - `priority = 2`
   - `time_estimate_mins = round(mins × per-week multiplier)`, blank when the multiplier is 0
   - `notes = "Recurring habit (<short label>)"`
3. If `review.day` is set, add:
   - `goal_title = "Weekly review and progress scores"`
   - pillar Personal Development and Learning
   - priority 1
   - `mins = review.mins || 20`
   - description `"<day> <time>: done / slipped / why; score each 90-day goal 1–10; set next week"`

CSV columns, unchanged from the existing template:
`week_start_date, pillar, track, goal_title, goal_description, priority, time_estimate_mins, parent_90day_goal, status, notes`

### 4.7 JSON export schema (prototype)
```json
{
  "plan": {"start_date":"", "ninety_day_end":"", "year_end":""},
  "life_scores": [{"area":"", "score":0, "why":"", "plus_two":""}],
  "reflection": {"highs_common_thread":"", "needed_in_lows":"", "best_year_top_three":[], "lessons":[]},
  "starts": [{"start":"", "pillar":"", "motive":"", "goes_to":""}],
  "annual_target": {"title":"", "outcome":"", "measure":"", "pillar":"", "motive":"", "needs":"", "due":""},
  "ninety_day_goals": [{"title":"", "pillar":"", "track":"", "moves_annual_target":true, "start_date":"", "end_date":"", "definition_of_done":"",
                        "woop": {"outcome":"", "obstacle":"", "if_then_plans":[{"if":"", "then":""}]}}],
  "habits": [{"habit":"", "cue":"", "frequency":"", "minutes_each":0, "pillar":"", "parent_90day_goal":""}],
  "stops": [{"stop":"", "instead":""}],
  "continues": [{"continue":"", "keep_going":""}],
  "review": {"day":"", "time":"", "minutes":20},
  "accountability": {"who":"", "ask":"", "update":""},
  "first_step": "",
  "weekly_goals": [/* CSV rows as objects */]
}
```

---

## 5. Data model (proposed; adapt to the existing schema)

Claude Code must **detect** the existing tables and naming conventions first (§7, Prompt A). The tables below are the target shape.

| Table | Key columns | Notes |
|---|---|---|
| `yearwise_sessions` | id, user_id, kind (`annual` \| `quarterly`), plan_start, status (`draft` \| `committed`), answers JSONB, created_at, updated_at, committed_at | One row per exercise. Answers autosave as JSONB keyed as in §3 |
| `life_checkins` | id, user_id, session_id, area_key, score (1–10), why, plus_two, created_at | One row per area per session, so trends can be shown |
| annual target (existing) | + `measure`, `motive`, `session_id` if missing | Tier 1 |
| 90-day goal (existing) | + `definition_of_done`, `woop_outcome`, `woop_obstacle`, `track`, `moves_annual`, `session_id`, `start_date`, `end_date` if missing | Tier 2 |
| `if_then_plans` | id, ninety_day_goal_id, if_text, then_text, sort | 1–3 per goal |
| `habits` | id, user_id, title, cue, freq_key, mins_each, pillar, parent_90day_goal_id, active, created_at | New. Until recurring activities exist, habits generate weekly goals |
| weekly goal (existing) | + `source` (`manual` \| `yearwise` \| `habit` \| `review`), `habit_id` nullable | Tier 3. The existing CSV template stays valid |
| `weekly_reviews` | id, user_id, week_start, done_notes, slipped_notes, why_notes, created_at | One per week |
| `weekly_review_scores` | id, review_id, ninety_day_goal_id, score (1–10) | The progress score that drives the trend line |

Values to check before building:
- **Pillars:** the prototype writes the full names (`Personal Development and Learning`). Map them to however Daily Compass stores pillars.
- **Tracks:** add CUSP and SE Water, and allow free text (or an "Other" option plus a text column).

---

## 6. Follow-through features

These are what make the evidence work. Without them, Yearwise is just a nicer goal form.

1. **Weekly review screen**, opened from the auto-generated priority-1 weekly goal. It asks:
   - What got done? What slipped, and why?
   - A 1–10 progress score per active 90-day goal
   - Next week's goals, created inline as tier-3 records

   It shows each goal's if–then plans as a reminder.
2. **Progress trend** on each 90-day goal: a sparkline of the weekly scores, next to the existing done/not-done status.
3. **Recurring habits:** generate each week's habit rows automatically, or add proper recurring activities with a streak count. Recommended order: auto-generation first, streaks later.
4. **90-day review** (a `quarterly` session), a short version of Yearwise:
   - re-score the 10 life areas, showing the previous scores alongside
   - Stop / Continue / Start
   - close or roll over the 90-day goals
   - set the next up-to-3 goals, with WOOP
5. **Fresh-start prompt:** if no review has been logged for 2+ weeks, show "New week, fresh start" on the next Monday or on the 1st of the month, rather than a broken streak.
6. **Accountability note:** at the frequency in `tell.freq`, generate a short plain-text progress update (goal, score trend, next step) that the user can copy and send.

---

## 7. Claude Code prompts

Run these in order. Each prompt depends on the ones before it, as noted. Attach `yearwise.html` as the reference implementation where the prompt says so.

### Prompt A: Discovery (no code changes)
```
Before changing anything, inspect this repo and report back. Do not modify files.

1. Stack: framework(s), router, ORM/schema tool (we run `npm run db:push`), where the schema is defined, how API routes are structured, how auth/session identifies the user.
2. The goals cascade: find the tables/models for annual target, 90-day goals, weekly goals and daily activities. List each table's columns and types, FKs between tiers, and how pillar, track, priority, status and time_estimate_mins are stored (enum? text? lookup table?). Give the exact stored values for pillars and BD tracks.
3. The CSV weekly-goals upload: where it's implemented, how it resolves parent_90day_goal (by title? id?), and how it validates pillar/track.
4. UI conventions: component library, form patterns, how pages are added to navigation, any existing autosave pattern.
5. Tests: framework and where tests live.

Output a short report with file paths, then a proposed mapping from the attached spec's §5 data model onto the existing schema: what exists, what columns to add, what new tables to create, using this repo's naming conventions. Stop and wait for my approval.
```

### Prompt B: Schema (depends on A approved)
```
Implement the approved data model from Prompt A's mapping (spec §5), following this repo's existing schema conventions exactly.

- New tables: yearwise_sessions (answers as JSONB), life_checkins, if_then_plans, habits, weekly_reviews, weekly_review_scores — names adjusted to repo convention.
- Add missing columns to the existing annual target, 90-day goal and weekly goal tables as agreed (measure, motive, definition_of_done, woop_outcome, woop_obstacle, moves_annual, session_id, start/end dates, source, habit_id).
- Add CUSP and SE Water to BD tracks, and support a free-text track (either an "Other" value + track_other column, or make track free text if it's already text).
- Pillar and track values must match what the existing app stores (from Prompt A).
- All changes additive and idempotent; nothing destructive to existing data. Apply with `npm run db:push`.
- Add types/validators for each new table in the style used elsewhere.

Report the diff summary and confirm the push succeeded.
```

### Prompt C: Yearwise wizard UI with autosave (depends on B)
```
Build the Yearwise exercise as a multi-step page in Daily Compass. The attached yearwise.html is the reference implementation: match its steps, prompts, fields, chips, "Why" notes and behaviour (spec §3 and §4); use this repo's components and styling, not its CSS.

- Route: /yearwise (list of sessions + "Start annual review") and /yearwise/:sessionId/:step.
- Left nav of steps grouped Part 1 / Part 2 / Part 3 / Output with per-step progress rings (progress = required fields filled ÷ required fields; month-by-month = months with any entry ÷ 12).
- Answers autosave to yearwise_sessions.answers (JSONB) on a ~900ms debounce, one write at a time; show "Saving… / Saved".
- Implement exactly: date derivation (§4.1), the 10 life-area check-in (§3.5), start destination selector (§3.9), reflection panel (§4.4) on annual/90-day/habits steps, chips sources (§3.4, §3.10–3.12), dynamic rows for habits and weekly goals, BD track with "Other" free text, habit frequency options and multipliers (§3.12), parent references by id not title (§4.5), live if–then quality check with the regexes and messages in §4.3.
- Keep prompts' wording as in the spec. Mobile layout must work at 400px.

Add unit tests for: date derivation, frequency time maths, if–then regexes (include the examples "if I want this work" → weak; "if I catch myself putting off a call" → ok; "then I need to eat better" → weak; "then I am limiting…" → weak; "then I send it before lunch" → ok).
```

### Prompt D: Readiness check, export and commit (depends on C)
```
Build the Output step for Yearwise.

1. Readiness checklist exactly as spec §4.2 (warnings don't block).
2. Preview of generated weekly-goal rows (spec §4.6) with planned hours per week.
3. Exports: CSV in the existing weekly-goals template columns; JSON per spec §4.7; Markdown summary (life check-in table, lessons, what matters, starts→destination, annual target, 90-day goals with WOOP and if–then, stop→instead, continue, habits, review & support, CSV block).
4. "Commit to Daily Compass" in a single transaction:
   - create/update the annual target (tier 1) with measure, motive, session_id;
   - create 90-day goals (tier 2) with done/WOOP/track/moves_annual/dates, and their if_then_plans;
   - create habits;
   - create weeks 1–2 weekly goals (tier 3) from planned rows (source='yearwise'), habit rows (source='habit', habit_id), and the weekly review row (source='review'), with parent FKs resolved;
   - write life_checkins rows;
   - mark the session committed.
   Re-committing a session must update the same records, not duplicate them (key on session_id + position).
5. After commit, link to the normal weekly view for week 1.

Tests: commit creates the expected counts; re-commit is idempotent; parent FKs resolve; habit time maths (4pw × 45 = 180; 2pm × 180 = 90; asneeded/rule = null).
```

### Prompt E: Weekly review and progress trend (depends on D)
```
Add the weekly review loop (spec §6.1–6.2, §6.5).

- The auto-generated "Weekly review and progress scores" weekly goal opens a review screen: done / slipped / why, a 1–10 score per active 90-day goal (show that goal's if–then plans alongside), and inline creation of next week's weekly goals (with pillar, priority, mins, parent). Saving marks the review goal done.
- Store in weekly_reviews and weekly_review_scores.
- On each 90-day goal, show a small trend line of weekly scores and the latest score.
- Each Monday, auto-create next week's habit rows and review row (source='habit'/'review') if not present — use whatever scheduling mechanism the app already has; if none, generate on first load of the week.
- Fresh-start: if no review for 2+ weeks, show a "New week, fresh start" banner on Monday or the 1st of the month instead of any streak/overdue language.
```

### Prompt F: 90-day review (depends on E)
```
Add a quarterly Yearwise session (kind='quarterly'), reachable from a banner when a 90-day goal's end date is within 7 days or past.

Steps: re-score the 10 life areas (show the previous session's score alongside), Stop / Continue / Start (short form), close or roll over each current 90-day goal with a one-line reflection and its final score trend, then set up to 3 new 90-day goals with WOOP and if–then plans (reuse the Prompt C components and the §4.3 check), then two weeks of weekly goals, then the same readiness check and commit as Prompt D. The annual target carries forward unless edited.
```

---

## 8. Acceptance checklist
- [ ] Every prompt and field in §3 is present, with the same keys in `answers`
- [ ] The if–then check flags the five test phrases in Prompt C correctly
- [ ] The CSV export matches the existing template, and the existing CSV upload accepts it
- [ ] Commit writes tiers 1–3, if–then plans, habits and life check-ins in one transaction; re-commit doesn't duplicate
- [ ] Parent links survive renaming a 90-day goal
- [ ] No start is silently dropped: the readiness check flags any start not used anywhere
- [ ] Weekly review scores appear as a trend on each 90-day goal
- [ ] The 90-day review shows previous life scores next to the new ones
- [ ] Works at 400px width

## 9. Reference files
- `yearwise.html` is the working prototype, with every screen, prompt and piece of export logic. Treat it as the source of truth for copy and behaviour.
- Existing prototype data can be exported from the prototype's Output step as JSON and imported into a draft `yearwise_sessions` row, if you want to carry the current plan across.
