import type { Answers } from "@shared/yearwise";

// Shaped like a real session: 3 goals, habits of every time type, two weeks.
export const answers: Answers = {
  planStart: "2026-09-28",
  life: {
    health: { score: 4, why: "Unfit" },
    work: { score: 6, why: "OK" },
    friends: { score: 3, why: "Few new ones", plus2: "Two new friends" },
  },
  annual: { title: "Work 3 days a week on strategic water work", measure: "3 days a week for 6+ months", pillar: "Profit", motive: "want" },
  ninety: {
    0: {
      title: "Gain regular interesting work", pillar: "Profit", track: "other", trackOther: "Water", annual: "yes",
      done: "Signed commitment for 2+ days a week", outcome: "3 days a week", obstacle: "Reluctance to sell",
      if1: "I catch myself drifting", then1: "I book a coach slot", if2: "a call ends", then2: "I write the next action",
    },
    1: { title: "Make new friends", pillar: "People", annual: "no", done: "3 new friends", if1: "Friday comes", then1: "I text someone" },
    2: { title: "Get fit", pillar: "Personal", track: "QASR", annual: "no", done: "10k in 50 min", if1: "the alarm goes", then1: "I put my kit on" },
  },
  habits: {
    n: 5,
    0: { what: "Gym and touch rugby", cue: "Mon/Wed/Fri/Sat", freq: "4pw", mins: "45", pillar: "Personal", parent: "g2" },
    1: { what: "Meet a friend", cue: "Twice a month", freq: "2pm", mins: "180", pillar: "People", parent: "g1" },
    2: { what: "Read a book", cue: "When distracted", freq: "asneeded", mins: "30", pillar: "Personal Development & Learning" },
    3: { what: "No crisps", cue: "Every day", freq: "rule", mins: "", pillar: "Personal" },
    4: { what: "Pipeline outreach", cue: "Monday after coaching", freq: "weekly", mins: "60", pillar: "Profit", parent: "g0" },
  },
  weeks: {
    w1: {
      n: 3,
      0: { title: "AI coaching session", pillar: "Profit", priority: "1", mins: "30", parent: "g0" },
      1: { title: "Arrange a meetup", pillar: "People", mins: "90", parent: "g1" },
      2: { title: "Book date night", pillar: "People", priority: "1", mins: "15" },
    },
    w2: {
      0: { title: "Follow up CUSP", pillar: "Profit", track: "CUSP", mins: "30", parent: "g0" },
    },
  },
  review: { day: "Monday", time: "09:00", mins: "30" },
};
