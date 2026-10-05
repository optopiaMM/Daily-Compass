import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, MessageSquarePlus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Sparkline from "@/components/sparkline";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatDateNice, getWeekStartDate } from "@/lib/dateUtils";
import { SIX_P_CATEGORIES, type IfThenPlan, type NinetyDayGoal, type WeeklyGoal, type WeeklyReview } from "@shared/schema";
import { addDaysISO, type ScorePoint } from "@shared/weekly-review";

// What GET /api/weekly-review/:week returns.
type GoalWithTrend = NinetyDayGoal & { plans: IfThenPlan[]; history: ScorePoint[] };
interface ReviewContext {
  weekStartDate: string;
  review: WeeklyReview | null;
  scores: Record<number, number>;
  goals: GoalWithTrend[];
}

interface NextGoalDraft { key: number; goalTitle: string; pillar: string; priority: string; mins: string; parent: string }

const NONE = "__none";
const PRIORITIES: [string, string][] = [["1", "1 · must do"], ["2", "2 · should"], ["3", "3 · nice to have"]];
const blankGoal = (key: number): NextGoalDraft => ({ key, goalTitle: "", pillar: "", priority: "2", mins: "", parent: NONE });

// Weekly review (Yearwise spec §6.1): a checklist of the week's goals (ticks written
// back to the goals on save, with an optional note each), a 1–10 score per active
// 90-day goal with its if–then plans alongside, and next week's goals.
export default function ReviewPage() {
  const { weekStart } = useParams<{ weekStart: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(weekStart ?? "");
  const week = valid ? getWeekStartDate(weekStart) : "";
  const nextWeek = valid ? addDaysISO(week, 7) : "";

  const { data: ctx, isLoading } = useQuery<ReviewContext>({ queryKey: ["/api/weekly-review", week], enabled: valid });
  const { data: thisWeekGoals } = useQuery<WeeklyGoal[]>({ queryKey: ["/api/weekly-goals", week], enabled: valid });
  const { data: nextWeekGoals } = useQuery<WeeklyGoal[]>({ queryKey: ["/api/weekly-goals", nextWeek], enabled: valid });

  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [noteOpen, setNoteOpen] = useState<Set<number>>(new Set());
  const [scores, setScores] = useState<Record<number, number>>({});
  const [nextGoals, setNextGoals] = useState<NextGoalDraft[]>([blankGoal(0)]);
  const [hydrated, setHydrated] = useState(false);

  // The week's goals, minus the review goal itself (saving the review ticks it).
  const checklist = useMemo(() => (thisWeekGoals ?? []).filter((g) => g.source !== "review"), [thisWeekGoals]);

  // Ticks start from each goal's current completed flag; notes from the saved review.
  useEffect(() => {
    if (!ctx || !thisWeekGoals || hydrated) return;
    setChecked(Object.fromEntries(checklist.map((g) => [g.id, g.completed])));
    const saved = ctx.review?.goalNotes ?? {};
    const own = Object.fromEntries(checklist.filter((g) => saved[g.id]).map((g) => [g.id, saved[g.id]]));
    setNotes(own);
    setNoteOpen(new Set(Object.keys(own).map(Number)));
    setScores(ctx.scores);
    setHydrated(true);
  }, [ctx, thisWeekGoals, checklist, hydrated]);

  const goalsToAdd = nextGoals.filter((g) => g.goalTitle.trim());
  const missingPillar = goalsToAdd.some((g) => !g.pillar);
  const tickedCount = checklist.filter((g) => checked[g.id]).length;
  const goalTitle = useMemo(() => new Map((ctx?.goals ?? []).map((g) => [String(g.id), g.goalText])), [ctx]);

  const save = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/weekly-review", {
        weekStartDate: week,
        goals: checklist.map((g) => ({ id: g.id, completed: !!checked[g.id], note: notes[g.id]?.trim() || null })),
        scores: Object.entries(scores).map(([id, score]) => ({ ninetyDayGoalId: Number(id), score })),
        nextGoals: goalsToAdd.map((g) => ({
          goalTitle: g.goalTitle.trim(),
          pillar: g.pillar,
          priority: Number(g.priority) || null,
          timeEstimateMins: g.mins.trim() ? Math.max(0, Math.round(Number(g.mins))) || 0 : null,
          ninetyDayGoalId: g.parent === NONE ? null : Number(g.parent),
        })),
      });
    },
    onSuccess: () => {
      for (const k of [["/api/weekly-goals", week], ["/api/weekly-goals", nextWeek], ["/api/weekly-review", week], ["/api/weekly-goal-templates", nextWeek]]) {
        queryClient.invalidateQueries({ queryKey: k });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/ninety-day-goals/trends"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fresh-start"] });
      toast({ title: "Review saved", description: goalsToAdd.length ? `${goalsToAdd.length} goal${goalsToAdd.length === 1 ? "" : "s"} added to next week.` : undefined });
      navigate("/");
    },
    onError: (err: Error) => toast({ title: "Couldn't save the review", description: err.message, variant: "destructive" }),
  });

  const setGoal = (key: number, patch: Partial<NextGoalDraft>) =>
    setNextGoals((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Today
        </Link>
        {!valid ? (
          <p className="text-muted-foreground">That isn't a date. Use /review/YYYY-MM-DD.</p>
        ) : isLoading || !ctx ? (
          <p className="text-muted-foreground text-sm">Loading your week...</p>
        ) : (
          <>
            <header className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-success">Weekly review</p>
              <h1 className="font-serif text-2xl font-semibold">Week of {formatDateNice(week)}</h1>
              {ctx.review && <p className="text-xs text-muted-foreground">Already reviewed. Saving again updates it.</p>}
            </header>

            <section className="space-y-3" data-testid="review-checklist">
              <div>
                <h2 className="font-serif text-lg">How did the week go?</h2>
                <p className="text-xs text-muted-foreground">
                  {checklist.length
                    ? `${tickedCount} of ${checklist.length} done. Tick or untick to match what happened; it updates This week's goals when you save.`
                    : "No goals were set for this week."}
                </p>
              </div>
              {checklist.length > 0 && (
                <ul className="rounded-lg border bg-card divide-y">
                  {checklist.map((g) => {
                    const id = `goal-${g.id}`;
                    const showNote = noteOpen.has(g.id);
                    return (
                      <li key={g.id} className="p-3 space-y-2" data-testid={`review-check-${g.id}`}>
                        <div className="flex items-start gap-3">
                          <Checkbox
                            id={id}
                            checked={!!checked[g.id]}
                            onCheckedChange={(v) => setChecked((prev) => ({ ...prev, [g.id]: v === true }))}
                            className="mt-0.5"
                            data-testid={`checkbox-goal-${g.id}`}
                          />
                          <label htmlFor={id} className={cn("flex-1 text-sm leading-snug cursor-pointer", checked[g.id] && "text-muted-foreground line-through")}>
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-2 no-underline inline-block">{g.category}</span>
                            {g.goalText}
                          </label>
                          {!showNote && (
                            <button
                              type="button"
                              onClick={() => setNoteOpen((prev) => new Set(prev).add(g.id))}
                              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
                              data-testid={`button-add-note-${g.id}`}
                            >
                              <MessageSquarePlus className="h-3.5 w-3.5" /> Note
                            </button>
                          )}
                        </div>
                        {showNote && (
                          <div className="flex items-start gap-2 pl-7">
                            <Textarea
                              autoFocus={!notes[g.id]}
                              rows={2}
                              placeholder="What happened, or why it slipped"
                              value={notes[g.id] ?? ""}
                              onChange={(e) => setNotes((prev) => ({ ...prev, [g.id]: e.target.value }))}
                              className="text-sm"
                              aria-label={`Note for ${g.goalText}`}
                              data-testid={`input-note-${g.id}`}
                            />
                            <Button
                              variant="ghost" size="icon" aria-label="Remove note"
                              onClick={() => {
                                setNotes((prev) => { const next = { ...prev }; delete next[g.id]; return next; });
                                setNoteOpen((prev) => { const next = new Set(prev); next.delete(g.id); return next; });
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="font-serif text-lg">Progress on your 90-day goals</h2>
                <p className="text-xs text-muted-foreground">1 = no movement, 10 = on track to finish. Leave one blank to skip it this week.</p>
              </div>
              {ctx.goals.length === 0 && <p className="text-sm text-muted-foreground italic">No active 90-day goals this week.</p>}
              {ctx.goals.map((g) => (
                <div key={g.id} className="rounded-lg border bg-card p-4 space-y-3" data-testid={`review-goal-${g.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium leading-snug">{g.goalText}</p>
                      {g.definitionOfDone && <p className="text-xs text-muted-foreground mt-0.5">Done when: {g.definitionOfDone}</p>}
                    </div>
                    <Sparkline history={g.history} className="shrink-0" />
                  </div>
                  {g.plans.length > 0 && (
                    <ul className="space-y-1 rounded bg-muted/40 p-2 text-xs">
                      {g.plans.map((p) => (
                        <li key={p.id}><span className="text-muted-foreground">If</span> {p.ifText}, <span className="text-muted-foreground">then</span> {p.thenText}</li>
                      ))}
                    </ul>
                  )}
                  <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label={`Score for ${g.goalText}`}>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                      const on = scores[g.id] === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setScores((prev) => {
                            const next = { ...prev };
                            if (on) delete next[g.id]; else next[g.id] = n;
                            return next;
                          })}
                          className={cn(
                            "h-8 rounded border text-sm tabular-nums hover-elevate",
                            on ? "bg-success text-success-foreground border-success" : "bg-background",
                          )}
                          data-testid={`button-score-${g.id}-${n}`}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="font-serif text-lg">Next week's goals</h2>
                <p className="text-xs text-muted-foreground">
                  Week of {formatDateNice(nextWeek)}.
                  {(nextWeekGoals?.length ?? 0) > 0 && ` ${nextWeekGoals!.length} already set, including your habits.`}
                </p>
              </div>
              {nextGoals.map((g) => (
                <div key={g.key} className="rounded-lg border bg-card p-3 space-y-2" data-testid={`next-goal-${g.key}`}>
                  <div className="flex gap-2">
                    <Input
                      placeholder="What will you do?"
                      value={g.goalTitle}
                      onChange={(e) => setGoal(g.key, { goalTitle: e.target.value })}
                      data-testid={`input-next-title-${g.key}`}
                    />
                    <Button
                      variant="ghost" size="icon" aria-label="Remove"
                      onClick={() => setNextGoals((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== g.key) : [blankGoal(g.key + 1)]))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Select value={g.pillar || undefined} onValueChange={(v) => setGoal(g.key, { pillar: v })}>
                      <SelectTrigger aria-label="Pillar" className={cn(g.goalTitle.trim() && !g.pillar && "border-destructive")}>
                        <SelectValue placeholder="Pillar" />
                      </SelectTrigger>
                      <SelectContent>
                        {SIX_P_CATEGORIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={g.priority} onValueChange={(v) => setGoal(g.key, { priority: v })}>
                      <SelectTrigger aria-label="Priority"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PRIORITIES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number" min={0} inputMode="numeric" placeholder="Mins"
                      value={g.mins} onChange={(e) => setGoal(g.key, { mins: e.target.value })} aria-label="Minutes"
                    />
                    <Select value={g.parent} onValueChange={(v) => setGoal(g.key, { parent: v })}>
                      <SelectTrigger aria-label="Parent 90-day goal">
                        <span className="truncate">{g.parent === NONE ? "No parent goal" : goalTitle.get(g.parent) ?? "Parent goal"}</span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE} className="text-muted-foreground">No parent goal</SelectItem>
                        {ctx.goals.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.goalText}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
              <Button
                variant="outline" size="sm" className="gap-1"
                onClick={() => setNextGoals((prev) => [...prev, blankGoal(Math.max(...prev.map((x) => x.key)) + 1)])}
                data-testid="button-add-next-goal"
              >
                <Plus className="h-4 w-4" /> Add a goal
              </Button>
            </section>

            <div className="sticky bottom-0 bg-background pt-4 pb-2 space-y-2">
              {missingPillar && <p className="text-xs text-destructive text-center">Pick a pillar for each new goal.</p>}
              <Button
                className="w-full" size="lg"
                disabled={save.isPending || missingPillar}
                onClick={() => save.mutate()}
                data-testid="button-save-review"
              >
                {save.isPending ? "Saving..." : "Save review"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
