import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Check, ChevronDown, ChevronUp, Plus, Star } from "lucide-react";
import type { DailyItem, WeeklyGoal } from "@shared/schema";
import { formatDateNice, getDayOfWeek, getWeekStartDate } from "@/lib/dateUtils";

interface DayViewProps { date: string; }

export default function DayView({ date }: DayViewProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const weekStartDate = getWeekStartDate(date);

  const { data: items } = useQuery<DailyItem[]>({ queryKey: ["/api/daily-items", date] });
  const { data: weeklyGoals } = useQuery<WeeklyGoal[]>({ queryKey: ["/api/weekly-goals", weekStartDate] });

  const [goalsOpen, setGoalsOpen] = useState(false);
  const [newTodo, setNewTodo] = useState("");

  const toggle = useMutation({
    mutationFn: async (id: number) => apiRequest("PATCH", `/api/daily-items/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-items", date] });
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-goals", weekStartDate] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addTodo = useMutation({
    mutationFn: async (text: string) => {
      await apiRequest("POST", "/api/daily-items", {
        date, type: "todo", text, rank: null, completed: false, linkedWeeklyGoalId: null, scheduledReviewDate: null,
      });
    },
    onSuccess: () => {
      setNewTodo("");
      queryClient.invalidateQueries({ queryKey: ["/api/daily-items", date] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
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
                    {g.goalText}
                  </div>
                ))}
                {completedGoals.map((g) => (
                  <div key={g.id} className="text-sm py-1 flex items-center gap-2 text-muted-foreground">
                    <Check className="w-3 h-3 text-success" />
                    <span className="line-through">{g.goalText}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mainGoal && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-success" />
              <h3 className="font-serif text-base">Main Goal</h3>
            </div>
            <button
              onClick={() => toggle.mutate(mainGoal.id)}
              className={`w-full text-left bg-success/10 border border-success/30 rounded-lg p-4 flex items-start gap-3 hover-elevate ${mainGoal.completed ? "opacity-60" : ""}`}
              data-testid={`button-toggle-main-${mainGoal.id}`}
            >
              <Check className={`w-5 h-5 mt-0.5 ${mainGoal.completed ? "text-success" : "text-muted-foreground/30"}`} />
              <span className={`flex-1 ${mainGoal.completed ? "line-through" : ""}`}>{mainGoal.text}</span>
            </button>
          </div>
        )}

        {priorities.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-serif text-base">Priorities</h3>
            <div className="space-y-2">
              {priorities.map((p) => (
                <button
                  key={p.id}
                  onClick={() => toggle.mutate(p.id)}
                  className={`w-full text-left bg-card border rounded-lg p-3 flex items-start gap-3 hover-elevate ${p.completed ? "opacity-60" : ""}`}
                  data-testid={`button-toggle-priority-${p.id}`}
                >
                  <Check className={`w-4 h-4 mt-0.5 ${p.completed ? "text-success" : "text-muted-foreground/30"}`} />
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">P{p.rank ?? ""}</span>
                  <span className={`flex-1 text-sm ${p.completed ? "line-through" : ""}`}>{p.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="font-serif text-base">To-Do</h3>
          <div className="space-y-2">
            {todos.length === 0 && <p className="text-xs text-muted-foreground italic">Nothing on the list.</p>}
            {todos.map((t) => (
              <button
                key={t.id}
                onClick={() => toggle.mutate(t.id)}
                className={`w-full text-left bg-card border rounded-lg p-3 flex items-start gap-3 hover-elevate ${t.completed ? "opacity-60" : ""}`}
                data-testid={`button-toggle-todo-${t.id}`}
              >
                <Check className={`w-4 h-4 mt-0.5 ${t.completed ? "text-success" : "text-muted-foreground/30"}`} />
                <span className={`flex-1 text-sm ${t.completed ? "line-through" : ""}`}>{t.text}</span>
              </button>
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
            <Button variant="outline" size="icon" disabled={!newTodo.trim() || addTodo.isPending} onClick={() => addTodo.mutate(newTodo.trim())} data-testid="button-day-add">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
