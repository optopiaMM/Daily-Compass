import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Target, X, Plus } from "lucide-react";
import { SIX_P_CATEGORIES, type WeeklyGoal } from "@shared/schema";
import { getWeekStartDate, getPreviousWeekStartDate } from "@/lib/dateUtils";

const MAX_GOALS_PER_CATEGORY = 10;

interface WeeklyGoalsStepProps { date: string; onNext: () => void; }

interface DraftGoal { id: string; goalText: string; carriedFromPrev?: boolean; }

export default function WeeklyGoalsStep({ date, onNext }: WeeklyGoalsStepProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const weekStartDate = getWeekStartDate(date);
  const previousWeekStartDate = getPreviousWeekStartDate(date);

  const { data: currentWeekGoals, isLoading: loadingCurrent } = useQuery<WeeklyGoal[]>({
    queryKey: ["/api/weekly-goals", weekStartDate],
  });
  const { data: previousGoals, isLoading: loadingPrev } = useQuery<WeeklyGoal[]>({
    queryKey: ["/api/weekly-goals", previousWeekStartDate],
  });

  const [draft, setDraft] = useState<Record<string, DraftGoal[]>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated || loadingCurrent || loadingPrev) return;
    const initial: Record<string, DraftGoal[]> = {};
    for (const cat of SIX_P_CATEGORIES) initial[cat] = [];

    for (const g of currentWeekGoals ?? []) {
      if (!initial[g.category]) initial[g.category] = [];
      initial[g.category].push({ id: `cur-${g.id}`, goalText: g.goalText });
    }
    for (const g of previousGoals ?? []) {
      if (g.completed) continue;
      if (!initial[g.category]) initial[g.category] = [];
      if (initial[g.category].length >= MAX_GOALS_PER_CATEGORY) continue;
      const exists = initial[g.category].some((x) => x.goalText.trim() === g.goalText.trim());
      if (exists) continue;
      initial[g.category].push({ id: `prev-${g.id}`, goalText: g.goalText, carriedFromPrev: true });
    }

    setDraft(initial);
    setHydrated(true);
  }, [currentWeekGoals, previousGoals, loadingCurrent, loadingPrev, hydrated]);

  const [newGoalText, setNewGoalText] = useState<Record<string, string>>({});

  const totalCount = useMemo(() => Object.values(draft).reduce((sum, v) => sum + v.length, 0), [draft]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const goals: { category: string; goalText: string; sortOrder: number }[] = [];
      for (const cat of SIX_P_CATEGORIES) {
        (draft[cat] ?? []).forEach((g, i) => {
          if (g.goalText.trim()) goals.push({ category: cat, goalText: g.goalText.trim(), sortOrder: i });
        });
      }
      await apiRequest("POST", "/api/weekly-goals", { weekStartDate, goals });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-goals", weekStartDate] });
      onNext();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function addGoal(category: string) {
    const text = (newGoalText[category] ?? "").trim();
    if (!text) return;
    if ((draft[category]?.length ?? 0) >= MAX_GOALS_PER_CATEGORY) {
      toast({ title: "Category full", description: `Max ${MAX_GOALS_PER_CATEGORY} goals per category.`, variant: "destructive" });
      return;
    }
    setDraft((prev) => ({
      ...prev,
      [category]: [...(prev[category] ?? []), { id: `new-${Date.now()}`, goalText: text }],
    }));
    setNewGoalText((prev) => ({ ...prev, [category]: "" }));
  }

  function removeGoal(category: string, id: string) {
    setDraft((prev) => ({ ...prev, [category]: (prev[category] ?? []).filter((g) => g.id !== id) }));
  }

  if (loadingCurrent || loadingPrev) {
    return <div className="text-muted-foreground text-sm">Loading goals...</div>;
  }

  return (
    <div className="space-y-6" data-testid="weekly-goals-step">
      <div className="flex items-center gap-3">
        <Target className="w-5 h-5 text-success" />
        <p className="text-muted-foreground text-sm">
          Set your Six P's goals for the week. Carried items from last week and LP actions are pre-filled.
        </p>
      </div>

      <div className="space-y-5">
        {SIX_P_CATEGORIES.map((category) => {
          const items = draft[category] ?? [];
          const full = items.length >= MAX_GOALS_PER_CATEGORY;
          return (
            <div key={category} className="bg-card rounded-lg p-4 border space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="font-serif text-lg">{category}</h3>
                <span className="text-xs text-muted-foreground">{items.length}/{MAX_GOALS_PER_CATEGORY}</span>
              </div>

              <div className="space-y-2">
                {items.map((g) => (
                  <div key={g.id} className="flex items-start gap-2 group">
                    <div className="flex-1 text-sm leading-snug">
                      {g.goalText}
                      {g.carriedFromPrev && (
                        <span className="ml-2 text-xs text-muted-foreground italic">carried over</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeGoal(category, g.id)}
                      className="text-muted-foreground hover:text-destructive p-1 rounded hover-elevate"
                      aria-label="Remove"
                      data-testid={`button-remove-${g.id}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {items.length === 0 && <p className="text-xs text-muted-foreground italic">No goals yet.</p>}
              </div>

              <div className="flex gap-2 pt-1">
                <Input
                  placeholder={full ? "Category full" : "Add a goal..."}
                  disabled={full}
                  value={newGoalText[category] ?? ""}
                  onChange={(e) => setNewGoalText((p) => ({ ...p, [category]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGoal(category); } }}
                  data-testid={`input-new-goal-${category}`}
                />
                <Button
                  variant="outline"
                  size="icon"
                  disabled={full || !(newGoalText[category] ?? "").trim()}
                  onClick={() => addGoal(category)}
                  data-testid={`button-add-goal-${category}`}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-0 pt-4 bg-background">
        <Button
          className="w-full"
          size="lg"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || totalCount === 0}
          data-testid="button-save-weekly-goals"
        >
          {saveMutation.isPending ? "Saving..." : "Continue"}
        </Button>
      </div>
    </div>
  );
}
