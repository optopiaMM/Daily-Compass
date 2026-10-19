import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Check, ChevronDown, ChevronUp, Plus, Star, Sparkles, ExternalLink, ClipboardCheck, Sunrise } from "lucide-react";
import type { DailyItem, DailyItemTags, NinetyDayGoal, WeeklyGoal } from "@shared/schema";
import type { ScorePoint } from "@shared/weekly-review";
import type { WeeklyLookback } from "@shared/weekly-lookback";
import { formatDateNice, getDayOfWeek, getWeekStartDate } from "@/lib/dateUtils";
import OutlookConnect from "@/components/outlook-connect";
import HydrationBar from "@/components/hydration-bar";
import { NO_TAGS, TagToggle, TaskTagControl, TaskTagFields, hasTags } from "@/components/task-tags";

interface DayViewProps { date: string; }

export default function DayView({ date }: DayViewProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const weekStartDate = getWeekStartDate(date);

  const { data: items } = useQuery<DailyItem[]>({ queryKey: ["/api/daily-items", date] });
  const { data: weeklyGoals } = useQuery<WeeklyGoal[]>({ queryKey: ["/api/weekly-goals", weekStartDate] });
  const { data: goalTrends } = useQuery<(NinetyDayGoal & { history: ScorePoint[] })[]>({ queryKey: ["/api/ninety-day-goals/trends", date] });
  const { data: lookback } = useQuery<WeeklyLookback>({ queryKey: ["/api/weekly-lookback", weekStartDate] });
  const { data: fresh } = useQuery<{ freshStart: boolean }>({ queryKey: ["/api/fresh-start", date] });

  const [goalsOpen, setGoalsOpen] = useState(false);
  const [newTodo, setNewTodo] = useState("");
  const [newTags, setNewTags] = useState<DailyItemTags>(NO_TAGS);
  const [newTagsOpen, setNewTagsOpen] = useState(false);

  const toggle = useMutation({
    mutationFn: async (id: number) => apiRequest("PATCH", `/api/daily-items/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-items", date] });
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-goals", weekStartDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-lookback", weekStartDate] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addTodo = useMutation({
    mutationFn: async (text: string) => {
      await apiRequest("POST", "/api/daily-items", {
        date, type: "todo", text, rank: null, completed: false, linkedWeeklyGoalId: null, scheduledReviewDate: null, ...newTags,
      });
    },
    onSuccess: () => {
      setNewTodo("");
      setNewTags(NO_TAGS);
      setNewTagsOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/daily-items", date] });
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-lookback", weekStartDate] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  interface ScheduleResult {
    ok: boolean;
    lunch: { startTime: string; endTime: string; reasoning: string; eventId?: string; webLink?: string } | null;
    lunchRejected?: { block: { startTime: string; endTime: string }; reason: string };
    scheduled: Array<{ dailyItemId: number; eventTitle: string; startTime: string; endTime: string; reasoning: string; eventId?: string; webLink?: string }>;
    fitness: Array<{ dailyItemId: number; eventTitle: string; startTime: string; endTime: string; kind: string | null; eventId?: string; webLink?: string }>;
    alreadyScheduled: Array<{ dailyItemId: number; eventTitle: string; startTime: string; endTime: string }>;
    unscheduled: Array<{ dailyItemId: number; reason: string }>;
    rejected: Array<{ block: { eventTitle: string; startTime: string; endTime: string }; reason: string }>;
    notes: string;
  }
  const [scheduleResult, setScheduleResult] = useState<ScheduleResult | null>(null);

  const scheduleDay = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/agent/schedule-day", { date });
      return (await res.json()) as ScheduleResult;
    },
    onSuccess: (result) => {
      setScheduleResult(result);
      const count = result.scheduled.length;
      toast({
        title: count === 0 ? "Nothing scheduled" : `Scheduled ${count} block${count === 1 ? "" : "s"}`,
        description: result.notes || (count ? "Check your Outlook calendar." : "Claude couldn't fit anything today."),
      });
    },
    onError: (err: Error) => toast({ title: "Schedule failed", description: err.message, variant: "destructive" }),
  });

  const mainGoal = items?.find((it) => it.type === "main");
  const priorities = useMemo(() => {
    if (!items) return [];
    return items.filter((it) => it.type === "priority").sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  }, [items]);
  const todos = useMemo(() => (items ?? []).filter((it) => it.type === "todo"), [items]);

  const total = items?.length ?? 0;
  const done = items?.filter((it) => it.completed).length ?? 0;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const completedGoals = (weeklyGoals ?? []).filter((g) => g.completed);
  const openGoals = (weeklyGoals ?? []).filter((g) => !g.completed);
  const reviewGoal = (weeklyGoals ?? []).find((g) => g.source === "review");

  return (
    <div className="min-h-screen bg-background" data-testid="day-view">
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b px-4 py-3">
        <div className="max-w-lg mx-auto space-y-2">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="font-serif text-xl">{getDayOfWeek(date)}</p>
              <p className="text-xs text-muted-foreground">{formatDateNice(date)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-widest">Done</p>
              <p className="font-serif text-2xl tabular-nums">{done}/{total}</p>
            </div>
          </div>
          <Progress value={pct} className="h-1" data-testid="progress-day" />
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => scheduleDay.mutate()}
              disabled={scheduleDay.isPending}
              data-testid="button-schedule-day"
            >
              <Sparkles className="w-3 h-3" />
              {scheduleDay.isPending ? "Scheduling..." : "Schedule today with Claude"}
            </Button>
            <OutlookConnect />
          </div>
          {scheduleResult && (
            <div className="bg-card border rounded-lg p-3 mt-2 text-xs space-y-2" data-testid="schedule-result">
              {scheduleResult.notes && (
                <p className="italic text-muted-foreground">{scheduleResult.notes}</p>
              )}
              {(scheduleResult.scheduled.length > 0 || scheduleResult.lunch || (scheduleResult.fitness?.length ?? 0) > 0) && (
                <div className="space-y-1">
                  <p className="font-medium text-success">Scheduled in Outlook:</p>
                  {scheduleResult.fitness?.map((f, i) => (
                    <div key={`f-${i}`} className="flex items-baseline justify-between gap-2">
                      <span>
                        <span className="tabular-nums text-muted-foreground">{f.startTime.slice(11, 16)}–{f.endTime.slice(11, 16)}</span>{" "}
                        {f.eventTitle} <span className="text-[10px] italic text-muted-foreground">({f.kind === "chi_kung" ? "chi kung" : "fitness"}, no reminder)</span>
                      </span>
                      {f.webLink && (
                        <a href={f.webLink} target="_blank" rel="noreferrer" className="text-info inline-flex items-center gap-0.5">
                          open <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                  {scheduleResult.lunch && (
                    <div className="flex items-baseline justify-between gap-2">
                      <span>
                        <span className="tabular-nums text-muted-foreground">{scheduleResult.lunch.startTime.slice(11, 16)}–{scheduleResult.lunch.endTime.slice(11, 16)}</span>{" "}
                        Lunch
                      </span>
                      {scheduleResult.lunch.webLink && (
                        <a href={scheduleResult.lunch.webLink} target="_blank" rel="noreferrer" className="text-info inline-flex items-center gap-0.5">
                          open <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}
                  {scheduleResult.scheduled.map((s, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-2">
                      <span>
                        <span className="tabular-nums text-muted-foreground">{s.startTime.slice(11, 16)}–{s.endTime.slice(11, 16)}</span>{" "}
                        {s.eventTitle}
                      </span>
                      {s.webLink && (
                        <a href={s.webLink} target="_blank" rel="noreferrer" className="text-info inline-flex items-center gap-0.5">
                          open <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {scheduleResult.lunchRejected && (
                <div className="space-y-1">
                  <p className="font-medium text-destructive">Lunch rejected:</p>
                  <p className="text-destructive/80">{scheduleResult.lunchRejected.reason}</p>
                </div>
              )}
              {(scheduleResult.alreadyScheduled?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-info">Already on calendar:</p>
                  {scheduleResult.alreadyScheduled.map((a, i) => (
                    <p key={i} className="text-info/80">
                      <span className="tabular-nums">{a.startTime.slice(11, 16)}–{a.endTime.slice(11, 16)}</span>{" "}
                      {a.eventTitle}
                    </p>
                  ))}
                </div>
              )}
              {scheduleResult.unscheduled.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-muted-foreground">Didn't fit:</p>
                  {scheduleResult.unscheduled.map((u, i) => (
                    <p key={i} className="text-muted-foreground">id={u.dailyItemId}: {u.reason}</p>
                  ))}
                </div>
              )}
              {scheduleResult.rejected.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium text-destructive">Rejected by validator:</p>
                  {scheduleResult.rejected.map((r, i) => (
                    <p key={i} className="text-destructive/80">{r.block.eventTitle}: {r.reason}</p>
                  ))}
                </div>
              )}
              <button
                onClick={() => setScheduleResult(null)}
                className="text-muted-foreground hover:text-foreground underline text-xs"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        <HydrationBar date={date} />

        {fresh?.freshStart && (
          <div className="bg-success/10 border border-success/30 rounded-lg p-4 flex items-start gap-3" data-testid="banner-fresh-start">
            <Sunrise className="w-5 h-5 text-success mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-serif text-base">New week, fresh start</p>
              <p className="text-sm text-muted-foreground">
                A good moment to look at where your goals stand and pick this week's few things.
              </p>
              <Link href={`/review/${weekStartDate}`} className="text-sm text-success underline-offset-2 hover:underline">
                Start this week's review
              </Link>
            </div>
          </div>
        )}

        {reviewGoal && !reviewGoal.completed && (
          <Link
            href={`/review/${weekStartDate}`}
            className="w-full bg-card border rounded-lg p-3 flex items-center gap-3 hover-elevate"
            data-testid="link-weekly-review"
          >
            <ClipboardCheck className="w-4 h-4 text-success shrink-0" />
            <span className="flex-1 text-sm">{reviewGoal.goalText}</span>
            <span className="text-xs text-muted-foreground">Open</span>
          </Link>
        )}

        {(weeklyGoals && weeklyGoals.length > 0) && (
          <div className="bg-card rounded-lg border">
            <button
              type="button"
              onClick={() => setGoalsOpen(!goalsOpen)}
              className="w-full flex items-center justify-between p-3"
              data-testid="button-toggle-weekly-goals"
            >
              <span className="font-serif text-base">This week's goals</span>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{completedGoals.length}/{weeklyGoals.length} done</span>
                {goalsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </button>
            {goalsOpen && (
              <div className="px-3 pb-3 space-y-1">
                {openGoals.map((g) => (
                  <div key={g.id} className="text-sm py-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide mr-2">{g.category}</span>
                    {g.source === "review"
                      ? <Link href={`/review/${weekStartDate}`} className="text-success underline-offset-2 hover:underline">{g.goalText}</Link>
                      : g.goalText}
                  </div>
                ))}
                {completedGoals.map((g) => (
                  <div key={g.id} className="text-sm py-1 flex items-center gap-2 text-muted-foreground">
                    <Check className="w-3 h-3 text-success" />
                    {g.source === "review"
                      ? <Link href={`/review/${weekStartDate}`} className="line-through hover:text-foreground">{g.goalText}</Link>
                      : <span className="line-through">{g.goalText}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {(goalTrends && goalTrends.length > 0) && (
          <div className="bg-card rounded-lg border p-3 space-y-2" data-testid="ninety-day-trends">
            <p className="font-serif text-base">90-day goals</p>
            {goalTrends.map((g) => {
              // This week's tasks tagged to the goal. No tasks yet reads as unset, not 0%.
              const progress = lookback?.goals.find((x) => x.id === g.id);
              return (
                <div key={g.id} className="space-y-1.5 py-1" data-testid={`trend-${g.id}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm leading-snug min-w-0">{g.goalText}</span>
                    {progress && progress.total > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0" data-testid={`text-trend-${g.id}`}>
                        {progress.done}/{progress.total}
                      </span>
                    )}
                  </div>
                  {progress && progress.total > 0
                    ? <Progress value={progress.pct} className="h-2.5 bg-muted" aria-label={`${g.goalText}: ${progress.done} of ${progress.total} tasks done this week`} />
                    : lookback && <p className="text-xs text-muted-foreground" data-testid={`text-trend-empty-${g.id}`}>No tasks set this week</p>}
                </div>
              );
            })}
          </div>
        )}

        {mainGoal && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-success" />
              <h3 className="font-serif text-base">Main Goal</h3>
            </div>
            <div className="space-y-1">
              <button
                onClick={() => toggle.mutate(mainGoal.id)}
                className={`w-full text-left bg-success/10 border border-success/30 rounded-lg p-4 flex items-start gap-3 hover-elevate ${mainGoal.completed ? "opacity-60" : ""}`}
                data-testid={`button-toggle-main-${mainGoal.id}`}
              >
                <Check className={`w-5 h-5 mt-0.5 ${mainGoal.completed ? "text-success" : "text-muted-foreground/30"}`} />
                <span className={`flex-1 ${mainGoal.completed ? "line-through" : ""}`}>{mainGoal.text}</span>
              </button>
              <TaskTagControl item={mainGoal} goals={goalTrends} date={date} />
            </div>
          </div>
        )}

        {priorities.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-serif text-base">Priorities</h3>
            <div className="space-y-2">
              {priorities.map((p) => (
                <div key={p.id} className="space-y-1">
                  <button
                    onClick={() => toggle.mutate(p.id)}
                    className={`w-full text-left bg-card border rounded-lg p-3 flex items-start gap-3 hover-elevate ${p.completed ? "opacity-60" : ""}`}
                    data-testid={`button-toggle-priority-${p.id}`}
                  >
                    <Check className={`w-4 h-4 mt-0.5 ${p.completed ? "text-success" : "text-muted-foreground/30"}`} />
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">P{p.rank ?? ""}</span>
                    <span className={`flex-1 text-sm ${p.completed ? "line-through" : ""}`}>{p.text}</span>
                  </button>
                  <TaskTagControl item={p} goals={goalTrends} date={date} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="font-serif text-base">To-Do</h3>
          <div className="space-y-2">
            {todos.length === 0 && <p className="text-xs text-muted-foreground italic">Nothing on the list.</p>}
            {todos.map((t) => (
              <div key={t.id} className="space-y-1">
                <button
                  onClick={() => toggle.mutate(t.id)}
                  className={`w-full text-left bg-card border rounded-lg p-3 flex items-start gap-3 hover-elevate ${t.completed ? "opacity-60" : ""}`}
                  data-testid={`button-toggle-todo-${t.id}`}
                >
                  <Check className={`w-4 h-4 mt-0.5 ${t.completed ? "text-success" : "text-muted-foreground/30"}`} />
                  <span className={`flex-1 text-sm ${t.completed ? "line-through" : ""}`}>{t.text}</span>
                </button>
                <TaskTagControl item={t} goals={goalTrends} date={date} />
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-2">
            <Input
              placeholder="Add a to-do..."
              value={newTodo}
              onChange={(e) => setNewTodo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newTodo.trim()) addTodo.mutate(newTodo.trim()); } }}
              data-testid="input-day-add"
            />
            <TagToggle open={newTagsOpen} tagged={hasTags(newTags)} onClick={() => setNewTagsOpen(!newTagsOpen)} />
            <Button variant="outline" size="icon" disabled={!newTodo.trim() || addTodo.isPending} onClick={() => addTodo.mutate(newTodo.trim())} data-testid="button-day-add">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          {newTagsOpen && <TaskTagFields value={newTags} goals={goalTrends} onChange={setNewTags} />}
        </div>
      </div>
    </div>
  );
}
